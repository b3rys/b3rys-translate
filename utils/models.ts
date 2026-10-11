import bundledModels from '../config/models.json';
import { dbg } from './debug';
import {
  loadModelCatalog,
  type ModelCatalog,
  type ModelConfig,
  type ModelId,
} from './model-catalog';
import type { EngineType } from './engines/types';

export type SelectedModels = Partial<Record<EngineType, ModelId>>;
export type NormalizedSelectedModels = Record<EngineType, ModelId>;
export const SELECTED_MODELS_KEY = 'selectedModels';

export const modelCatalog = loadModelCatalog(bundledModels);
for (const message of modelCatalog.diagnostics) dbg('model-catalog', message);

// Compatibility views; all data and defaults come from the validated catalog.
export const MODEL_CATALOG = modelCatalog.models;
export const DEFAULT_MODEL_IDS = modelCatalog.defaultModelIds;

export function getModelsForEngine(
  engine: EngineType,
  catalog: ModelCatalog = modelCatalog,
): ModelConfig[] {
  return catalog.models.filter((model) => model.engine === engine);
}

export function getModelConfig(
  modelId: ModelId,
  catalog: ModelCatalog = modelCatalog,
): ModelConfig {
  const model = catalog.models.find((model) => model.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

export function calculateModelCost(
  modelId: ModelId,
  usage: { inputTokens: number; outputTokens: number },
  catalog: ModelCatalog = modelCatalog,
): number {
  const { input, output } = getModelConfig(modelId, catalog).pricing;
  return (usage.inputTokens / 1_000_000) * input + (usage.outputTokens / 1_000_000) * output;
}

export function resolveSelectedModel(
  engine: EngineType,
  savedModel?: string,
  catalog: ModelCatalog = modelCatalog,
): ModelId {
  const model = catalog.models.find((model) => model.id === savedModel);
  return model?.engine === engine ? model.id : catalog.defaultModelIds[engine];
}

export function normalizeSelectedModels(
  savedModels: SelectedModels | undefined,
  catalog: ModelCatalog = modelCatalog,
): NormalizedSelectedModels {
  return {
    gemini: resolveSelectedModel('gemini', savedModels?.gemini, catalog),
    openai: resolveSelectedModel('openai', savedModels?.openai, catalog),
    anthropic: resolveSelectedModel('anthropic', savedModels?.anthropic, catalog),
    upstage: resolveSelectedModel('upstage', savedModels?.upstage, catalog),
  };
}
