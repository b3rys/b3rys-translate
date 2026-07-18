import type { EngineType } from '@/utils/engines/types';
import { ENGINE_DISPLAY_NAMES } from '@/utils/engines/types';
import {
  USAGE_STATS_KEY,
  COST_LIMIT_KEY,
  USAGE_RATIO_KEY,
  LANGUAGES,
  LANG_STORAGE_KEY,
  DEFAULT_TARGET_LANG,
  ENGINE_PRICING,
} from '@/utils/constants';

// Key issuance pages — the first-run path. (Usage dashboards live one click
// away from these; issuance is what a new user actually needs.)
const ENGINE_KEY_URLS: Record<EngineType, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
};

// 엔진 비교 툴팁용 한줄 설명 (가격은 ENGINE_PRICING 단일 출처에서 파생)
const ENGINE_NOTES: Record<EngineType, string> = {
  gemini: '무료 할당량·권장',
  openai: '최저가·비추론',
  anthropic: '품질 우선',
};

/** 팝업 엔진 목록/툴팁을 ENGINE_DISPLAY_NAMES + ENGINE_PRICING에서 생성 (엔진 추가 시 이 데이터만 갱신) */
function populateEngineUI(engineSelect: HTMLSelectElement, tooltip: HTMLElement) {
  const entries = Object.entries(ENGINE_DISPLAY_NAMES) as [EngineType, string][];

  engineSelect.innerHTML = '';
  for (const [type, name] of entries) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = name;
    engineSelect.appendChild(opt);
  }

  const rows = entries
    .map(([type, name]) => {
      const p = ENGINE_PRICING[type];
      const price = p ? `$${p.input.toFixed(2)}/${p.output.toFixed(2)}` : '—';
      return `<tr><td>${name}</td><td class="tt-price">${price}</td><td class="tt-note">${ENGINE_NOTES[type] ?? ''}</td></tr>`;
    })
    .join('');
  tooltip.innerHTML =
    '<div class="info-tooltip-title">번역 엔진 비교</div>' +
    '<table><thead><tr><th>엔진</th><th>가격</th><th>특징</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>` +
    '<div class="info-tooltip-foot">가격 = 1M 토큰당 입력/출력 (USD). 비용대비 품질 기준.</div>';
}

interface EngineUsageStats {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  requestCount: number;
}

type UsageStats = Partial<Record<EngineType, EngineUsageStats>>;

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

  // Load saved settings (API keys from local, rest from sync)
  const { selectedEngine, floatingButtonVisible, ytButtonVisible, autoTranslate } =
    await chrome.storage.sync.get<{
      selectedEngine?: EngineType;
      floatingButtonVisible?: boolean;
      ytButtonVisible?: boolean;
      autoTranslate?: boolean;
    }>(['selectedEngine', 'floatingButtonVisible', 'ytButtonVisible', 'autoTranslate']);

  const { engineApiKeys } = await chrome.storage.local.get<{
    engineApiKeys?: Partial<Record<EngineType, string>>;
  }>('engineApiKeys');

  const currentEngine: EngineType = selectedEngine || 'gemini';
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

  // Build engine dropdown + comparison tooltip from single-source metadata
  const engineTooltip = document.getElementById('engine-tooltip') as HTMLSpanElement;
  populateEngineUI(engineSelect, engineTooltip);

  engineSelect.value = currentEngine;
  loadKeyForEngine(currentEngine);
  updateBadge(currentEngine);

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
  const langData = await chrome.storage.sync.get(LANG_STORAGE_KEY);
  const savedLang = langData[LANG_STORAGE_KEY] as { target?: string } | undefined;
  targetLangSelect.value = savedLang?.target || DEFAULT_TARGET_LANG;
  updateLangBadge();

  targetLangSelect.addEventListener('change', async () => {
    const target = targetLangSelect.value;
    await chrome.storage.sync.set({ [LANG_STORAGE_KEY]: { target } });
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

  // Engine selection change
  engineSelect.addEventListener('change', async () => {
    const engine = engineSelect.value as EngineType;
    await chrome.storage.sync.set({ selectedEngine: engine });
    loadKeyForEngine(engine);
    updateBadge(engine);
  });

  // Save API key
  saveButton.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key || key.startsWith('••••')) return;

    const engine = engineSelect.value as EngineType;
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
    const engine = engineSelect.value as EngineType;
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
    await chrome.storage.sync.set({ floatingButtonVisible: visible });
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
    await chrome.storage.sync.set({ ytButtonVisible: visible });
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
    await chrome.storage.sync.set({ autoTranslate: enabled });
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
    apiKeyInput.placeholder = `${ENGINE_DISPLAY_NAMES[engine]} API key`;
  }

  function updateBadge(engine: EngineType) {
    badgeModel.textContent = ENGINE_DISPLAY_NAMES[engine];
    badgeLink.href = ENGINE_KEY_URLS[engine];
    keyIssueLink.href = ENGINE_KEY_URLS[engine];
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
    const engines = Object.keys(stats) as EngineType[];
    if (engines.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML =
        '<td colspan="3" style="text-align:center;color:var(--text-muted)">No usage data</td>';
      costTableBody.appendChild(row);
      return;
    }
    for (const eng of engines) {
      const s = stats[eng];
      if (!s) continue;
      const usage = `${formatNumber(s.inputTokens + s.outputTokens)} tokens`;
      const row = document.createElement('tr');
      row.innerHTML = `<td>${ENGINE_DISPLAY_NAMES[eng] ?? eng}</td><td>${usage}</td><td>$${s.estimatedCost.toFixed(4)}</td>`;
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
