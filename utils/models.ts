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
  | 'claude-haiku-4-5-20251001';

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
] as const;

export const DEFAULT_MODEL_IDS: Record<EngineType, ModelId> = {
  gemini: 'gemini-3.1-flash-lite',
  openai: 'gpt-5.4-nano',
  anthropic: 'claude-haiku-4-5-20251001',
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
  };
}
