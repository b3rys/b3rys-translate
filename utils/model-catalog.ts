import bundledModels from '../config/models.json';
import type { EngineType } from './engines/types';

/** An id is usable only after lookup in a validated catalog. */
export type ModelId = string;

export interface ModelConfig {
  readonly id: ModelId;
  readonly engine: EngineType;
  readonly label: string;
  readonly pricing: Readonly<{ input: number; output: number }>;
  readonly default: boolean;
  readonly note?: string;
}

export interface ModelCatalog {
  readonly version: number;
  readonly models: readonly ModelConfig[];
  readonly defaultModelIds: Readonly<Record<EngineType, ModelId>>;
  /** Debug messages are returned as data; callers own logging, not the pure loader. */
  readonly diagnostics: readonly string[];
}

const ENGINES: readonly EngineType[] = ['gemini', 'openai', 'anthropic', 'upstage'];
const SCHEMA_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseModels(raw: unknown, diagnostics: string[]): ModelConfig[] {
  if (!isRecord(raw) || raw.version !== SCHEMA_VERSION || !Array.isArray(raw.models)) {
    diagnostics.push('catalog: invalid schema/version/models; using bundled defaults');
    return [];
  }

  // Reject every occurrence of a duplicate rather than trusting array order.
  const counts = new Map<string, number>();
  for (const item of raw.models) {
    if (isRecord(item) && typeof item.id === 'string') {
      counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
    }
  }

  const models: ModelConfig[] = [];
  raw.models.forEach((item: unknown, index: number) => {
    const reject = (reason: string) => diagnostics.push(`models[${index}]: ${reason}`);
    if (!isRecord(item)) {
      reject('invalid item');
      return;
    }
    if (typeof item.engine !== 'string' || !ENGINES.includes(item.engine as EngineType)) {
      reject('unknown engine');
      return;
    }
    if (typeof item.id !== 'string' || item.id.trim().length === 0) {
      reject('missing id');
      return;
    }
    if (counts.get(item.id)! > 1) {
      reject('duplicate id');
      return;
    }
    // Reserve bundled ids for their own engines so partial fallback stays unique.
    if (
      bundledModels.models.some((model) => model.id === item.id && model.engine !== item.engine)
    ) {
      reject('bundled id belongs to another engine');
      return;
    }
    if (typeof item.label !== 'string' || item.label.trim().length === 0) {
      reject('missing label');
      return;
    }
    if (!isRecord(item.pricing) || !isPrice(item.pricing.input) || !isPrice(item.pricing.output)) {
      reject('missing, negative or non-finite price');
      return;
    }
    if (typeof item.default !== 'boolean') {
      reject('default must be boolean');
      return;
    }
    models.push(
      Object.freeze({
        id: item.id,
        engine: item.engine as EngineType,
        label: item.label,
        pricing: Object.freeze({ input: item.pricing.input, output: item.pricing.output }),
        default: item.default,
        ...(typeof item.note === 'string' ? { note: item.note } : {}),
      }),
    );
  });
  return models;
}

const bundleDiagnostics: string[] = [];
const bundle = parseModels(bundledModels, bundleDiagnostics);
if (
  bundleDiagnostics.length ||
  ENGINES.some((engine) => bundle.filter((m) => m.engine === engine && m.default).length !== 1)
) {
  throw new Error('Invalid bundled model catalog');
}

/** Source-independent validation: no fetch, storage, logging or input mutation. */
export function loadModelCatalog(raw: unknown): ModelCatalog {
  const diagnostics: string[] = [];
  const candidates = parseModels(raw, diagnostics);
  const models: ModelConfig[] = [];
  const defaults = {} as Record<EngineType, ModelId>;
  for (const engine of ENGINES) {
    let group = candidates.filter((model) => model.engine === engine);
    const defaultCount = group.filter((model) => model.default).length;
    if (group.length === 0 || defaultCount !== 1) {
      diagnostics.push(
        `${engine}: ${group.length === 0 ? 'no valid models' : `expected 1 default, got ${defaultCount}`}; using bundled defaults`,
      );
      group = bundle.filter((model) => model.engine === engine);
    }
    models.push(...group);
    defaults[engine] = group.find((model) => model.default)!.id;
  }
  return Object.freeze({
    version: SCHEMA_VERSION,
    models: Object.freeze(models),
    defaultModelIds: Object.freeze(defaults),
    diagnostics: Object.freeze(diagnostics),
  });
}
