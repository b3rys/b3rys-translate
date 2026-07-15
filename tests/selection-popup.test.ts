import { describe, it, expect } from 'vitest';
import {
  isLikelyEnglish,
  hasMinLength,
  isSingleWord,
  clamp,
  splitSentences,
  parseWordResponse,
  highlightWord,
} from '@/entrypoints/content/selection-popup';

describe('isLikelyEnglish', () => {
  it('returns true for English text', () => {
    expect(isLikelyEnglish('Hello world')).toBe(true);
    expect(isLikelyEnglish('The quick brown fox')).toBe(true);
  });

  it('returns false for Korean text', () => {
    expect(isLikelyEnglish('안녕하세요')).toBe(false);
    expect(isLikelyEnglish('한국어 텍스트')).toBe(false);
  });

  it('returns false for Japanese text', () => {
    expect(isLikelyEnglish('日本語テスト')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isLikelyEnglish('')).toBe(false);
  });

  it('handles mixed text (>60% English = true)', () => {
    expect(isLikelyEnglish('Hello 안녕')).toBe(true); // 5 ASCII / 7 total = 71%
  });
});

describe('hasMinLength', () => {
  it('returns true for length >= 2', () => {
    expect(hasMinLength('ab')).toBe(true);
    expect(hasMinLength('hello')).toBe(true);
  });

  it('returns false for single char', () => {
    expect(hasMinLength('a')).toBe(false);
  });

  it('trims whitespace', () => {
    expect(hasMinLength('  a  ')).toBe(false);
    expect(hasMinLength('  ab  ')).toBe(true);
  });
});

describe('isSingleWord', () => {
  it('returns true for single word', () => {
    expect(isSingleWord('hello')).toBe(true);
  });

  it('returns false for multiple words', () => {
    expect(isSingleWord('hello world')).toBe(false);
  });

  it('trims whitespace', () => {
    expect(isSingleWord('  hello  ')).toBe(true);
  });
});

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when value is below', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns max when value is above', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('splitSentences', () => {
  it('splits on period + space', () => {
    const result = splitSentences('First sentence. Second sentence.');
    expect(result).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('splits on question mark + space', () => {
    const result = splitSentences('How are you? I am fine.');
    expect(result).toEqual(['How are you?', 'I am fine.']);
  });

  it('returns single element for text without breaks', () => {
    const result = splitSentences('just one sentence');
    expect(result).toEqual(['just one sentence']);
  });

  it('filters empty segments', () => {
    const result = splitSentences('Hello.  ');
    expect(result.every((s) => s.trim().length > 0)).toBe(true);
  });
});

describe('parseWordResponse', () => {
  it('parses translation and examples', () => {
    const raw = `알고리즘
• The algorithm is efficient
→ 그 알고리즘은 효율적이다
• We need a better algorithm
→ 더 나은 알고리즘이 필요하다`;

    const { translation, examples } = parseWordResponse(raw);
    expect(translation).toBe('알고리즘');
    expect(examples).toHaveLength(2);
    expect(examples[0].en).toBe('The algorithm is efficient');
    expect(examples[0].ko).toBe('그 알고리즘은 효율적이다');
  });

  it('handles response with only translation (no examples)', () => {
    const { translation, examples } = parseWordResponse('번역');
    expect(translation).toBe('번역');
    expect(examples).toEqual([]);
  });

  it('handles malformed response (no arrow)', () => {
    const raw = `번역
• Some example without Korean`;
    const { examples } = parseWordResponse(raw);
    expect(examples).toEqual([]);
  });
});

describe('highlightWord', () => {
  it('wraps word in highlight span', () => {
    const result = highlightWord('The algorithm works', 'algorithm');
    expect(result).toBe('The <span class="b3rys-sel-highlight">algorithm</span> works');
  });

  it('is case insensitive', () => {
    const result = highlightWord('The Algorithm works', 'algorithm');
    expect(result).toContain('<span class="b3rys-sel-highlight">Algorithm</span>');
  });

  it('escapes regex special characters', () => {
    const result = highlightWord('Use c++ for speed', 'c++');
    expect(result).toContain('<span class="b3rys-sel-highlight">c++</span>');
  });

  it('highlights multiple occurrences', () => {
    const result = highlightWord('the cat sat on the mat', 'the');
    const count = (result.match(/b3rys-sel-highlight/g) || []).length;
    expect(count).toBe(2);
  });
});
