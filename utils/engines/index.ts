import type { EngineType, TranslationEngine } from './types';
import { geminiEngine } from './gemini';
import { openaiEngine } from './openai';
import { anthropicEngine } from './anthropic';

export type { EngineType, TranslationEngine } from './types';
export { ENGINE_DISPLAY_NAMES } from './types';

const engines: Record<EngineType, TranslationEngine> = {
  gemini: geminiEngine,
  openai: openaiEngine,
  anthropic: anthropicEngine,
};

export function getEngine(type: EngineType): TranslationEngine {
  return engines[type];
}
