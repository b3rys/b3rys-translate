import type { ModelId } from '../models';
import type { TranslationRequestMode } from '../translation-types';

export type EngineType = 'gemini' | 'openai' | 'anthropic' | 'upstage';

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
}

export interface TranslateResult {
  translations: { id: string; translatedText: string }[];
  usage?: UsageData;
}

export interface TranslationEngine {
  translate(
    apiKey: string,
    paragraphs: { id: string; text: string }[],
    mode: TranslationRequestMode,
    subtitleContext?: { original: string; translated: string }[],
    lang?: { sourceLang?: string; targetLang?: string },
    modelId?: ModelId,
  ): Promise<TranslateResult>;
}

export const ENGINE_DISPLAY_NAMES: Record<EngineType, string> = {
  gemini: 'Gemini 3.1 Flash Lite',
  openai: 'GPT-4.1 Nano',
  anthropic: 'Claude Haiku 4.5',
  upstage: 'Upstage Solar Mini',
};
