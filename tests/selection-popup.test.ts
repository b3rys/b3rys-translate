import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isLikelyEnglish,
  hasMinLength,
  isWithinMaxLength,
  isSingleWord,
  clamp,
  splitSentences,
  parseWordResponse,
  highlightWord,
  findEnglishVoice,
  speakWord,
  parseSentenceResponse,
  calculatePopupPlacement,
  initSelectionPopup,
  destroySelectionPopup,
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

describe('isWithinMaxLength', () => {
  it('allows selections up to and including 500 characters', () => {
    expect(isWithinMaxLength('a'.repeat(499))).toBe(true);
    expect(isWithinMaxLength('a'.repeat(500))).toBe(true);
  });

  it('blocks selections longer than 500 characters', () => {
    expect(isWithinMaxLength('a'.repeat(501))).toBe(false);
  });

  it('measures the trimmed selection text', () => {
    expect(isWithinMaxLength(`${' '.repeat(600)}${'a'.repeat(500)}${' '.repeat(600)}`)).toBe(true);
  });
});

describe('selection length guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    destroySelectionPopup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('returns before reading selection geometry when text exceeds 500 characters', () => {
    const getRangeAt = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'a'.repeat(501),
      getRangeAt,
    } as unknown as Selection);

    initSelectionPopup();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    vi.runAllTimers();

    expect(getRangeAt).not.toHaveBeenCalled();
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

describe('parseSentenceResponse', () => {
  it('번역과 펼쳐진 설명 줄을 분리한다', () => {
    const raw = `[1] 결국 중요한 것은 속도가 아니다.
Here are the notes:
※ matter | 명사 "문제"가 아니라 동사 "중요하다"

※ room | "방"이 아니라 "여지"
이 문장은 전반적으로 격식체입니다.`;

    expect(parseSentenceResponse(raw)).toEqual({
      translation: '결국 중요한 것은 속도가 아니다.',
      notes: ['matter | 명사 "문제"가 아니라 동사 "중요하다"', 'room | "방"이 아니라 "여지"'],
    });
  });

  it('설명이 없어도 번역을 반환한다', () => {
    expect(parseSentenceResponse('[1] 번역문')).toEqual({ translation: '번역문', notes: [] });
  });

  it('첫 설명 전의 여러 줄 번역을 모두 보존한다', () => {
    const raw = `[1] 첫 번째 문단 번역입니다.

두 번째 문단 번역입니다.
※ matter | 문맥에서는 중요하다`;

    expect(parseSentenceResponse(raw)).toEqual({
      translation: '첫 번째 문단 번역입니다.\n두 번째 문단 번역입니다.',
      notes: ['matter | 문맥에서는 중요하다'],
    });
  });
});

describe('calculatePopupPlacement', () => {
  it('아래 공간이 충분하면 선택 영역 아래에 둔다', () => {
    expect(calculatePopupPlacement(100, 80, 200, 800)).toEqual({
      top: 108,
      maxHeight: null,
      side: 'below',
    });
  });

  it('아래가 넘치고 위가 충분하면 위로 뒤집는다', () => {
    expect(calculatePopupPlacement(700, 650, 200, 800)).toEqual({
      top: 442,
      maxHeight: null,
      side: 'above',
    });
  });

  it('위아래 모두 부족하면 더 넓은 쪽에서 높이를 제한한다', () => {
    expect(calculatePopupPlacement(300, 280, 500, 600)).toEqual({
      top: 308,
      maxHeight: 284,
      side: 'below',
    });
  });

  it('위로 뒤집을 때 트리거가 아닌 선택 영역 top을 기준으로 한다', () => {
    expect(calculatePopupPlacement(700, 620, 200, 800).top).toBe(412);
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

// ── 발음(TTS) ────────────────────────────────────────────────────────────────
// 회귀 대상: `speechSynthesis.getVoices()` 는 첫 호출에 빈 배열을 준다(목록을 비동기로 채운다).
// 예전 코드는 클릭 시점에 그 값을 그대로 써서, ★첫 재생만 브라우저 기본 목소리★ 로 나갔다.
// 기본값이 한국어 음성인 기기에서는 한국어 엔진이 영어 단어를 읽어 발음이 뭉개진다.
describe('findEnglishVoice', () => {
  const v = (name: string, lang: string, localService = false) =>
    ({ name, lang, localService }) as SpeechSynthesisVoice;

  it('Google 영어 목소리를 가장 먼저 고른다', () => {
    const voices = [
      v('유나', 'ko-KR', true),
      v('Samantha', 'en-US', true),
      v('Google US English', 'en-US'),
    ];
    expect(findEnglishVoice(voices)?.name).toBe('Google US English');
  });

  it('Google 이 없으면 원격 en-US 를 고른다 (로컬은 건너뛴다)', () => {
    const voices = [v('Samantha', 'en-US', true), v('Alloy', 'en-US', false)];
    expect(findEnglishVoice(voices)?.name).toBe('Alloy');
  });

  it('영어 목소리가 없으면 null — 한국어를 영어 대신 쓰지 않는다', () => {
    expect(findEnglishVoice([v('유나', 'ko-KR', true)])).toBeNull();
  });

  it('빈 목록이면 null', () => {
    expect(findEnglishVoice([])).toBeNull();
  });
});

describe('speakWord — 목록이 비어 있는 첫 재생', () => {
  const GOOGLE = {
    name: 'Google US English',
    lang: 'en-US',
    localService: false,
  } as SpeechSynthesisVoice;
  let spoken: Array<{ text: string; voice: SpeechSynthesisVoice | null }>;
  let listeners: Array<() => void>;
  let voices: SpeechSynthesisVoice[];

  beforeEach(() => {
    spoken = [];
    listeners = [];
    voices = [];
    class FakeUtterance {
      voice: SpeechSynthesisVoice | null = null;
      lang = '';
      rate = 1;
      constructor(public text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      cancel: () => {},
      speak: (u: { text: string; voice: SpeechSynthesisVoice | null }) =>
        spoken.push({ text: u.text, voice: u.voice }),
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('★목록이 비면 즉시 말하지 않는다★ — 그대로 말하면 기본(한국어) 목소리로 나간다', () => {
    speakWord('annum');
    expect(spoken).toHaveLength(0);
  });

  it('★목록이 채워진 뒤 Google 목소리로 말한다★', async () => {
    speakWord('annum');
    voices = [{ name: '유나', lang: 'ko-KR', localService: true } as SpeechSynthesisVoice, GOOGLE];
    listeners.forEach((fn) => fn()); // voiceschanged
    await Promise.resolve();
    await Promise.resolve();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('annum');
    expect(spoken[0].voice?.name).toBe('Google US English');
  });

  it('목록이 이미 있으면 기다리지 않고 바로 말한다 (사용자 제스처 문맥 유지)', () => {
    voices = [GOOGLE];
    speakWord('annum');
    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice?.name).toBe('Google US English');
  });
});
