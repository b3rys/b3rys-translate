import { describe, expect, it } from 'vitest';
import { buildTranslationCachePrefix } from '@/utils/translation-context';

describe('translation context', () => {
  it('isolates cache entries by target language, mode, and model', () => {
    const pageNano = buildTranslationCachePrefix('ko', 'page', 'gpt-5.4-nano');
    const pageLuna = buildTranslationCachePrefix('ko', 'page', 'gpt-5.6-luna');
    const subtitleNano = buildTranslationCachePrefix('ko', 'subtitle', 'gpt-5.4-nano');

    expect(pageNano).not.toBe(pageLuna);
    expect(pageNano).not.toBe(subtitleNano);
    expect(pageNano).toBe('ko:page:gpt-5.4-nano:');
  });
});
