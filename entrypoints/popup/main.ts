import type { EngineType } from '@/utils/engines/types';
import { ENGINE_DISPLAY_NAMES } from '@/utils/engines/types';
import {
  SELECTED_MODELS_KEY,
  getModelConfig,
  normalizeSelectedModels,
  resolveSelectedModel,
  type ModelId,
  type SelectedModels,
} from '@/utils/models';
import { populateModelSelect, renderModelPricingTable } from './model-ui';
import {
  USAGE_STATS_KEY,
  COST_LIMIT_KEY,
  USAGE_RATIO_KEY,
  LANGUAGES,
  LANG_STORAGE_KEY,
  DEFAULT_TARGET_LANG,
} from '@/utils/constants';

// Key issuance pages — the first-run path. (Usage dashboards live one click
// away from these; issuance is what a new user actually needs.)
const ENGINE_KEY_URLS: Record<EngineType, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
};

interface EngineUsageStats {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  requestCount: number;
}

type UsageStats = Partial<Record<string, EngineUsageStats>>;

document.addEventListener('DOMContentLoaded', async () => {
  const engineSelect = document.getElementById('engine-select') as HTMLSelectElement;
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const saveButton = document.getElementById('save-key') as HTMLButtonElement;
  const deleteButton = document.getElementById('delete-key') as HTMLButtonElement;
  const keyStatus = document.getElementById('key-status') as HTMLSpanElement;
  const fabToggle = document.getElementById('fab-toggle') as HTMLInputElement;
  const fabStatusText = document.getElementById('fab-status') as HTMLSpanElement;
  const ytBtnToggle = document.getElementById('yt-btn-toggle') as HTMLInputElement;
  const ytBtnStatusText = document.getElementById('yt-btn-status') as HTMLSpanElement;
  const autoToggle = document.getElementById('auto-toggle') as HTMLInputElement;
  const autoStatusText = document.getElementById('auto-status') as HTMLSpanElement;
  const badgeModel = document.querySelector('.badge-model') as HTMLSpanElement;
  const badgeLink = document.getElementById('badge-link') as HTMLAnchorElement;
  const keyIssueLink = document.getElementById('key-issue-link') as HTMLAnchorElement;
  const errorBanner = document.getElementById('api-error-banner') as HTMLDivElement;
  const errorMessage = document.getElementById('api-error-message') as HTMLSpanElement;
  const dismissError = document.getElementById('dismiss-error') as HTMLButtonElement;

  // Load saved settings (all in storage.local — sync is no longer used; see
  // migrateStorage note on why every setting moved off sync)
  const { selectedEngine, selectedModels, floatingButtonVisible, ytButtonVisible, autoTranslate } =
    await chrome.storage.local.get<{
      selectedEngine?: EngineType;
      selectedModels?: SelectedModels;
      floatingButtonVisible?: boolean;
      ytButtonVisible?: boolean;
      autoTranslate?: boolean;
    }>([
      'selectedEngine',
      SELECTED_MODELS_KEY,
      'floatingButtonVisible',
      'ytButtonVisible',
      'autoTranslate',
    ]);

  const { engineApiKeys } = await chrome.storage.local.get<{
    engineApiKeys?: Partial<Record<EngineType, string>>;
  }>('engineApiKeys');

  const currentEngine: EngineType = selectedEngine || 'gemini';
  const modelSelections = normalizeSelectedModels(selectedModels);
  let currentModel = resolveSelectedModel(currentEngine, modelSelections[currentEngine]);
  const keys: Partial<Record<EngineType, string>> = engineApiKeys || {};

  // Check for API key error message from content script
  const { apiKeyErrorMessage } = await chrome.storage.local.get<{
    apiKeyErrorMessage?: string;
  }>('apiKeyErrorMessage');
  if (apiKeyErrorMessage) {
    errorMessage.textContent = apiKeyErrorMessage;
    errorBanner.style.display = 'flex';
    await chrome.storage.local.remove('apiKeyErrorMessage');
  } else {
    // First-run onboarding: FAB was clicked with no API key saved
    const { onboardingNotice } = await chrome.storage.local.get<{
      onboardingNotice?: boolean;
    }>('onboardingNotice');
    if (onboardingNotice) {
      errorMessage.textContent =
        'API 키를 입력하면 바로 번역이 시작됩니다. "키 발급 ↗"에서 무료로 만들 수 있어요 (Gemini는 무료 할당량 제공).';
      errorBanner.classList.add('info');
      errorBanner.style.display = 'flex';
      await chrome.storage.local.remove('onboardingNotice');
    }
  }

  dismissError.addEventListener('click', () => {
    errorBanner.style.display = 'none';
  });

  // Build model dropdown + price-only tooltip from single-source metadata.
  const engineTooltip = document.getElementById('engine-tooltip') as HTMLSpanElement;
  populateModelSelect(engineSelect);
  renderModelPricingTable(engineTooltip);

  engineSelect.value = currentModel;
  loadKeyForEngine(currentEngine);
  updateBadge(currentModel);

  // --- Language selection ---
  const targetLangSelect = document.getElementById('target-lang') as HTMLSelectElement;
  const badgeDirection = document.getElementById('badge-direction') as HTMLSpanElement;

  // Populate target language options
  for (const [code, info] of Object.entries(LANGUAGES)) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${info.nativeName} (${info.name})`;
    targetLangSelect.appendChild(opt);
  }

  // Load saved target language
  const langData = await chrome.storage.local.get(LANG_STORAGE_KEY);
  const savedLang = langData[LANG_STORAGE_KEY] as { target?: string } | undefined;
  targetLangSelect.value = savedLang?.target || DEFAULT_TARGET_LANG;
  updateLangBadge();

  targetLangSelect.addEventListener('change', async () => {
    const target = targetLangSelect.value;
    await chrome.storage.local.set({ [LANG_STORAGE_KEY]: { target } });
    updateLangBadge();
  });

  function updateLangBadge() {
    const tgt = targetLangSelect.value.toUpperCase();
    badgeDirection.textContent = `→ ${tgt}`;
  }

  const isFabVisible = floatingButtonVisible !== false;
  fabToggle.checked = isFabVisible;
  updateFabStatus(isFabVisible);

  const isYtBtnVisible = ytButtonVisible !== false;
  ytBtnToggle.checked = isYtBtnVisible;
  updateYtBtnStatus(isYtBtnVisible);

  const isAutoOn = autoTranslate === true;
  autoToggle.checked = isAutoOn;
  updateAutoStatus(isAutoOn);

  // Model selection change. Provider-scoped API keys remain unchanged.
  engineSelect.addEventListener('change', async () => {
    const model = getModelConfig(engineSelect.value as ModelId);
    const engine = model.engine;
    currentModel = model.id;
    modelSelections[engine] = model.id;
    await chrome.storage.local.set({
      selectedEngine: engine,
      [SELECTED_MODELS_KEY]: { ...modelSelections },
    });
    loadKeyForEngine(engine);
    updateBadge(model.id);
  });

  // Save API key
  saveButton.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key || key.startsWith('••••')) return;

    const engine = getModelConfig(engineSelect.value as ModelId).engine;
    try {
      keys[engine] = key;
      await chrome.storage.local.set({ engineApiKeys: { ...keys } });
      apiKeyInput.value = '••••••••' + key.slice(-4);
      showStatus('saved', 'success');
    } catch {
      showStatus('error', 'error');
    }
  });

  // Delete API key
  deleteButton.addEventListener('click', async () => {
    const engine = getModelConfig(engineSelect.value as ModelId).engine;
    delete keys[engine];
    await chrome.storage.local.set({ engineApiKeys: { ...keys } });
    apiKeyInput.value = '';
    showStatus('deleted', 'error');
  });

  // Enter key saves
  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveButton.click();
  });

  // Clear masked value on focus
  apiKeyInput.addEventListener('focus', () => {
    if (apiKeyInput.value.startsWith('••••')) {
      apiKeyInput.value = '';
    }
  });

  // Toggle floating button
  fabToggle.addEventListener('change', async () => {
    const visible = fabToggle.checked;
    await chrome.storage.local.set({ floatingButtonVisible: visible });
    updateFabStatus(visible);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_FLOATING_BUTTON',
        visible,
      });
    }
  });

  // Toggle YouTube button
  ytBtnToggle.addEventListener('change', async () => {
    const visible = ytBtnToggle.checked;
    await chrome.storage.local.set({ ytButtonVisible: visible });
    updateYtBtnStatus(visible);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_YT_BUTTON',
        visible,
      });
    }
  });

  // Toggle auto-translate (translate every page automatically)
  autoToggle.addEventListener('change', async () => {
    const enabled = autoToggle.checked;
    await chrome.storage.local.set({ autoTranslate: enabled });
    updateAutoStatus(enabled);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_AUTO_TRANSLATE',
        enabled,
      });
    }
  });

  function loadKeyForEngine(engine: EngineType) {
    const savedKey = keys[engine];
    if (savedKey) {
      apiKeyInput.value = '••••••••' + savedKey.slice(-4);
      showStatus('saved', 'success');
    } else {
      apiKeyInput.value = '';
      keyStatus.className = 'status';
    }
    apiKeyInput.placeholder = `${getModelConfig(currentModel).label} API key`;
  }

  function updateBadge(modelId: ModelId) {
    const model = getModelConfig(modelId);
    badgeModel.textContent = model.label;
    badgeLink.href = ENGINE_KEY_URLS[model.engine];
    keyIssueLink.href = ENGINE_KEY_URLS[model.engine];
  }

  function showStatus(text: string, type: 'success' | 'error') {
    keyStatus.textContent = text;
    keyStatus.className = `status visible ${type}`;
    setTimeout(() => {
      keyStatus.className = 'status';
    }, 2500);
  }

  function updateFabStatus(visible: boolean) {
    fabStatusText.textContent = visible ? 'Visible' : 'Hidden';
    fabStatusText.className = visible ? 'toggle-status-text' : 'toggle-status-text inactive';
  }

  function updateYtBtnStatus(visible: boolean) {
    ytBtnStatusText.textContent = visible ? 'Visible' : 'Hidden';
    ytBtnStatusText.className = visible ? 'toggle-status-text' : 'toggle-status-text inactive';
  }

  function updateAutoStatus(on: boolean) {
    autoStatusText.textContent = on ? 'On' : 'Off';
    autoStatusText.className = on ? 'toggle-status-text' : 'toggle-status-text inactive';
  }

  // --- Cache section ---
  const cacheClearBtn = document.getElementById('cache-clear') as HTMLButtonElement;
  const cacheStatus = document.getElementById('cache-status') as HTMLSpanElement;

  cacheClearBtn.addEventListener('click', async () => {
    cacheClearBtn.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
      if (response?.success) {
        cacheStatus.textContent = 'Cache cleared';
        cacheStatus.className = 'cache-status success';
      } else {
        cacheStatus.textContent = 'Failed to clear';
        cacheStatus.className = 'cache-status error';
      }
    } catch {
      cacheStatus.textContent = 'Failed to clear';
      cacheStatus.className = 'cache-status error';
    }
    cacheClearBtn.disabled = false;
    setTimeout(() => {
      cacheStatus.textContent = '';
      cacheStatus.className = 'cache-status';
    }, 3000);
  });

  // --- Cost tracking section ---
  const totalCostEl = document.getElementById('total-cost') as HTMLSpanElement;
  const costDetailToggle = document.getElementById('cost-detail-toggle') as HTMLButtonElement;
  const costReset = document.getElementById('cost-reset') as HTMLButtonElement;
  const costDetails = document.getElementById('cost-details') as HTMLDivElement;
  const costTableBody = document.getElementById('cost-table-body') as HTMLTableSectionElement;
  const costLimitInput = document.getElementById('cost-limit') as HTMLInputElement;
  const limitStatus = document.getElementById('limit-status') as HTMLSpanElement;
  const costGauge = document.getElementById('cost-gauge') as HTMLDivElement;

  let costDetailsOpen = false;

  // Load cost data (usage/cost lives in storage.local — sync's per-minute /
  // per-hour write quota can't absorb the per-batch usage writes, and once it
  // trips every sync write silently fails, incl. unrelated settings)
  const costData = await chrome.storage.local.get([USAGE_STATS_KEY, COST_LIMIT_KEY]);
  const usageStats: UsageStats = (costData[USAGE_STATS_KEY] as UsageStats) || {};
  const savedLimit = costData[COST_LIMIT_KEY] as number | undefined; // undefined = no limit

  function calcTotalCost(stats: UsageStats): number {
    return Object.values(stats).reduce((sum, s) => sum + (s?.estimatedCost ?? 0), 0);
  }

  function formatNumber(n: number): string {
    return n.toLocaleString();
  }

  function updateCostGauge(total: number) {
    const limitVal = parseFloat(costLimitInput.value);
    if (!costLimitInput.value || isNaN(limitVal)) {
      // No limit → hide gauge
      costGauge.style.width = '0%';
      return;
    }
    const ratio = limitVal === 0 ? 1 : Math.min(total / limitVal, 1);
    costGauge.style.width = `${ratio * 100}%`;
    let color: string;
    if (ratio <= 0.5) color = '#7ee787';
    else if (ratio <= 0.8) color = '#d29922';
    else color = '#f85149';
    costGauge.style.backgroundColor = color;
  }

  function renderCostDisplay(stats: UsageStats) {
    const total = calcTotalCost(stats);
    totalCostEl.textContent = `$${total.toFixed(4)}`;
    updateCostGauge(total);
    renderCostTable(stats);
  }

  function renderCostTable(stats: UsageStats) {
    costTableBody.innerHTML = '';
    const usageKeys = Object.keys(stats);
    if (usageKeys.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML =
        '<td colspan="3" style="text-align:center;color:var(--text-muted)">No usage data</td>';
      costTableBody.appendChild(row);
      return;
    }
    for (const usageKey of usageKeys) {
      const s = stats[usageKey];
      if (!s) continue;
      const usage = `${formatNumber(s.inputTokens + s.outputTokens)} tokens`;
      const row = document.createElement('tr');
      let label: string;
      try {
        label = getModelConfig(usageKey as ModelId).label;
      } catch {
        label = ENGINE_DISPLAY_NAMES[usageKey as EngineType] ?? usageKey;
      }
      for (const text of [label, usage, `$${s.estimatedCost.toFixed(4)}`]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      }
      costTableBody.appendChild(row);
    }
  }

  if (savedLimit !== undefined) {
    costLimitInput.value = savedLimit.toString();
  }

  renderCostDisplay(usageStats);

  // Toggle details
  costDetailToggle.addEventListener('click', () => {
    costDetailsOpen = !costDetailsOpen;
    costDetails.style.display = costDetailsOpen ? '' : 'none';
    costDetailToggle.classList.toggle('rotated', costDetailsOpen);
  });

  // Reset usage
  costReset.addEventListener('click', async () => {
    if (!confirm('Reset all usage stats?')) return;
    await chrome.storage.local.remove(USAGE_STATS_KEY);
    // Recalculate ratio
    const hasLimit = costLimitInput.value !== '';
    const limitVal = parseFloat(costLimitInput.value);
    let ratio: number;
    if (!hasLimit) {
      ratio = -1; // no limit
    } else if (limitVal === 0) {
      ratio = 1; // $0 limit → full
    } else {
      ratio = 0; // usage reset to 0
    }
    await chrome.storage.local.set({ [USAGE_RATIO_KEY]: ratio });
    renderCostDisplay({});
  });

  // Limit input with debounce
  let limitTimer: ReturnType<typeof setTimeout>;
  costLimitInput.addEventListener('input', () => {
    clearTimeout(limitTimer);
    limitTimer = setTimeout(async () => {
      const raw = costLimitInput.value.trim();
      if (raw === '') {
        // Empty = no limit
        await chrome.storage.local.remove(COST_LIMIT_KEY);
        await chrome.storage.local.set({ [USAGE_RATIO_KEY]: -1 });
      } else {
        const val = parseFloat(raw) || 0;
        await chrome.storage.local.set({ [COST_LIMIT_KEY]: val });
        // Update ratio
        const data = await chrome.storage.local.get(USAGE_STATS_KEY);
        const stats: UsageStats = (data[USAGE_STATS_KEY] as UsageStats) || {};
        const total = calcTotalCost(stats);
        let ratio: number;
        if (val === 0) {
          ratio = 1; // $0 limit → always full
        } else {
          ratio = Math.min(total / val, 1);
        }
        await chrome.storage.local.set({ [USAGE_RATIO_KEY]: ratio });
        updateCostGauge(total);
      }
      if (raw === '') updateCostGauge(0);
      limitStatus.textContent = 'saved';
      limitStatus.classList.add('visible');
      setTimeout(() => limitStatus.classList.remove('visible'), 1500);
    }, 500);
  });
});
