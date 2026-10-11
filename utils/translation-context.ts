import type { ModelId } from './model-catalog';
import type { TranslationRequestMode } from './translation-types';

export function buildTranslationCachePrefix(
  targetLang: string,
  mode: TranslationRequestMode | undefined,
  modelId: ModelId,
): string {
  return `${targetLang}:${mode ?? 'page'}:${modelId}:`;
}
