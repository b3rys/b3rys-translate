import type { EngineType } from './engines/types';

export type ModelId =
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.5-flash-lite'
  | 'gpt-5.4-nano'
  | 'gpt-5.6-luna'
  | 'claude-haiku-4-5-20251001'
  | 'claude-sonnet-4-6';

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
    id: 'gemini-3.5-flash-lite',
    engine: 'gemini',
    label: 'Gemini 3.5 Flash Lite',
    pricing: { input: 0.3, output: 2.5 },
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
    id: 'claude-sonnet-4-6',
    engine: 'anthropic',
    label: 'Claude Sonnet 4.6',
    pricing: { input: 3, output: 15 },
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
