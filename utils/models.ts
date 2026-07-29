import type { EngineType } from './engines/types';

/**
 * 씽킹(추론) 모델은 넣지 않는다 — 팀 결정 2026-07-27.
 *
 * 번역은 추론이 필요한 작업이 아니라 지연과 토큰만 늘린다. 그래서 후보는
 * "씽킹을 하지 않거나 요청에서 확실히 끌 수 있는" 모델로 제한한다.
 *
 * 제외된 예: gemini-3.5-flash-lite 는 씽킹이 기본 on(minimal)이고 레벨에
 * off 가 없어 끌 방법이 없다. thinkingConfig 를 생략하는 것은 비활성화가
 * 아니라 기본값으로 도는 것이다.
 *
 * 모델을 추가할 때는 씽킹을 끌 수 있는지 공급사 문서로 먼저 확인할 것.
 *
 * 비용도 기준이다 — claude-sonnet-4-6 은 Haiku 대비 3배($3/$15 vs $1/$5)라
 * 번역 품질 차이가 그 값을 정당화하지 못한다고 보고 뺐다(팀 결정 2026-07-27).
 */
export type ModelId =
  | 'gemini-3.1-flash-lite'
  | 'gpt-5.4-nano'
  | 'gpt-5.6-luna'
  | 'claude-haiku-4-5-20251001'
  | 'solar-mini';

export interface ModelConfig {
  id: ModelId;
  engine: EngineType;
  label: string;
  pricing: { input: number; output: number };
}

export type SelectedModels = Partial<Record<EngineType, ModelId>>;
export type NormalizedSelectedModels = Record<EngineType, ModelId>;

export const SELECTED_MODELS_KEY = 'selectedModels';

export const MODEL_CATALOG: readonly ModelConfig[] = [
  {
    id: 'gemini-3.1-flash-lite',
    engine: 'gemini',
    label: 'Gemini 3.1 Flash Lite',
    pricing: { input: 0.25, output: 1.5 },
  },
  {
    id: 'gpt-5.4-nano',
    engine: 'openai',
    label: 'GPT-5.4 Nano',
    pricing: { input: 0.2, output: 1.25 },
  },
  {
    id: 'gpt-5.6-luna',
    engine: 'openai',
    label: 'GPT-5.6 Luna',
    pricing: { input: 1, output: 6 },
  },
  {
    id: 'claude-haiku-4-5-20251001',
    engine: 'anthropic',
    label: 'Claude Haiku 4.5',
    pricing: { input: 1, output: 5 },
  },
  {
    // Upstage 문서 확인(2026-07-29): `solar-mini` 는 별칭이고 실제로는
    // solar-mini-250422 를 가리킨다. ★reasoning 을 지원하지 않는다★ —
    // reasoning_effort 파라미터 자체가 무시된다. 위의 씽킹 배제 기준을
    // 공급사 문서로 확인한 유일한 모델이다.
    //
    // 가격은 Upstage 공개 요금표의 chat 모델 단가($0.15/$0.60)를 쓴다.
    // 외부 PR(#14)은 $0.05/$0.20 이라고 적어 왔지만 어느 출처에서도 그 숫자를
    // 확인하지 못했다. 비용은 어차피 추정치이고, 틀린다면 ★과대 추정★ 쪽이
    // 안전하다 — 실제보다 싸게 보여주면 사용자가 모르는 새 더 쓴다.
    id: 'solar-mini',
    engine: 'upstage',
    label: 'Upstage Solar Mini',
    pricing: { input: 0.15, output: 0.6 },
  },
] as const;

export const DEFAULT_MODEL_IDS: Record<EngineType, ModelId> = {
  gemini: 'gemini-3.1-flash-lite',
  openai: 'gpt-5.4-nano',
  anthropic: 'claude-haiku-4-5-20251001',
  upstage: 'solar-mini',
};

const modelsById = new Map(MODEL_CATALOG.map((model) => [model.id, model]));

export function getModelsForEngine(engine: EngineType): ModelConfig[] {
  return MODEL_CATALOG.filter((model) => model.engine === engine);
}

export function getModelConfig(modelId: ModelId): ModelConfig {
  const model = modelsById.get(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

export function calculateModelCost(
  modelId: ModelId,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const { input, output } = getModelConfig(modelId).pricing;
  return (usage.inputTokens / 1_000_000) * input + (usage.outputTokens / 1_000_000) * output;
}

export function resolveSelectedModel(engine: EngineType, savedModel?: string): ModelId {
  const model = savedModel ? modelsById.get(savedModel as ModelId) : undefined;
  return model?.engine === engine ? model.id : DEFAULT_MODEL_IDS[engine];
}

export function normalizeSelectedModels(
  savedModels: SelectedModels | undefined,
): NormalizedSelectedModels {
  return {
    gemini: resolveSelectedModel('gemini', savedModels?.gemini),
    openai: resolveSelectedModel('openai', savedModels?.openai),
    anthropic: resolveSelectedModel('anthropic', savedModels?.anthropic),
    upstage: resolveSelectedModel('upstage', savedModels?.upstage),
  };
}
