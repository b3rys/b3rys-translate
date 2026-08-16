import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isLikelyEnglish,
  hasMinLength,
  isSingleWord,
  clamp,
  clampPopupPosition,
  isDragHandle,
  parseWordResponse,
  highlightWord,
  findEnglishVoice,
  speakWord,
  stopSpeaking,
  toggleSpeakState,
  parseSentenceResponse,
  calculatePopupPlacement,
  topOfRects,
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

describe('clampPopupPosition', () => {
  it('범위 안의 위치는 그대로 둔다', () => {
    expect(clampPopupPosition(100, 120, 320, 200, 1000, 800)).toEqual({ x: 100, y: 120 });
  });

  it('왼쪽·위로 나가도 60px은 화면에 남긴다', () => {
    expect(clampPopupPosition(-500, -400, 320, 200, 1000, 800)).toEqual({
      x: -260,
      y: -140,
    });
  });

  it('오른쪽·아래로 나가도 60px은 화면에 남긴다', () => {
    expect(clampPopupPosition(1200, 900, 320, 200, 1000, 800)).toEqual({
      x: 940,
      y: 740,
    });
  });

  it('뷰포트나 팝업이 60px보다 작아도 유효한 범위를 만든다', () => {
    expect(clampPopupPosition(-50, 100, 40, 80, 30, 50)).toEqual({ x: -10, y: 0 });
  });
});

describe('isDragHandle', () => {
  const popup = (content: string) => {
    const el = document.createElement('div');
    el.className = 'b3rys-sel-popup';
    el.innerHTML = content;
    document.body.appendChild(el);
    return el;
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('팝업 배경에서 시작할 수 있다', () => {
    const el = popup('<div class="b3rys-sel-popup-inner"></div>');
    expect(isDragHandle(el)).toBe(true);
    expect(isDragHandle(el.firstElementChild)).toBe(true);
  });

  it('문장 번역문과 그 자식에서는 시작하지 않는다', () => {
    const el = popup('<div class="b3rys-sel-text"><span>번역문</span></div>');
    expect(isDragHandle(el.querySelector('.b3rys-sel-text'))).toBe(false);
    expect(isDragHandle(el.querySelector('span'))).toBe(false);
  });

  it('단어 번역문에서는 시작하지 않는다', () => {
    const el = popup('<span class="b3rys-sel-word-translation">번역</span>');
    expect(isDragHandle(el.firstElementChild)).toBe(false);
  });

  it('스피커·복사 버튼과 SVG 자식에서는 시작하지 않는다', () => {
    const el = popup('<button class="b3rys-sel-speak"><svg><path /></svg></button>');
    expect(isDragHandle(el.querySelector('button'))).toBe(false);
    expect(isDragHandle(el.querySelector('path'))).toBe(false);
  });

  it('팝업 밖과 Element가 아닌 target은 시작하지 않는다', () => {
    expect(isDragHandle(document.body)).toBe(false);
    expect(isDragHandle(document.createTextNode('text'))).toBe(false);
    expect(isDragHandle(null)).toBe(false);
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
  it('[N] 접두를 제거해 번역만 반환한다', () => {
    expect(parseSentenceResponse('[1] 번역문')).toBe('번역문');
  });

  it('여러 줄 번역을 모두 보존한다', () => {
    const raw = `[1] 첫 번째 문단 번역입니다.

두 번째 문단 번역입니다.`;

    expect(parseSentenceResponse(raw)).toBe('첫 번째 문단 번역입니다.\n두 번째 문단 번역입니다.');
  });

  it('번역에서 마크다운 별표를 제거한다', () => {
    expect(parseSentenceResponse('[1] **번역**')).toBe('번역');
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

describe('topOfRects', () => {
  const rect = (top: number, height = 20, width = 300): DOMRect =>
    ({ top, height, width, bottom: top + height, left: 0, right: width }) as DOMRect;

  it('여러 줄이면 첫 줄의 top 을 쓴다', () => {
    expect(topOfRects([rect(760), rect(786), rect(812)])).toBe(760);
  });

  it('rect 순서가 뒤집혀 있어도 가장 위를 고른다', () => {
    expect(topOfRects([rect(812), rect(760), rect(786)])).toBe(760);
  });

  it('한 줄이면 그 줄의 top 이다', () => {
    expect(topOfRects([rect(500)])).toBe(500);
  });

  it('폭·높이가 0 인 빈 rect 는 무시한다', () => {
    expect(topOfRects([rect(10, 0, 0), rect(760)])).toBe(760);
  });

  it('쓸 수 있는 rect 가 하나도 없으면 0 이다', () => {
    expect(topOfRects([])).toBe(0);
    expect(topOfRects([rect(10, 0, 0)])).toBe(0);
  });

  it('마지막 줄 top 을 쓰면 위로 뒤집힌 팝업이 첫 줄을 덮는다 — 그래서 첫 줄을 쓴다', () => {
    const lines = [rect(760), rect(786)];
    const popupHeight = 120;
    const withFirst = calculatePopupPlacement(806, topOfRects(lines), popupHeight, 878);
    const withLast = calculatePopupPlacement(806, lines[lines.length - 1].top, popupHeight, 878);

    expect(withFirst.side).toBe('above');
    expect(withFirst.top + popupHeight).toBeLessThanOrEqual(760);
    expect(withLast.top + popupHeight).toBeGreaterThan(760);
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
  let cancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spoken = [];
    listeners = [];
    voices = [];
    cancel = vi.fn();
    class FakeUtterance {
      voice: SpeechSynthesisVoice | null = null;
      lang = '';
      rate = 1;
      constructor(public text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => voices,
      cancel,
      speak: (u: { text: string; voice: SpeechSynthesisVoice | null }) =>
        spoken.push({ text: u.text, voice: u.voice }),
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    });
  });

  afterEach(() => {
    stopSpeaking();
    vi.unstubAllGlobals();
  });

  it('상태를 재생과 정지 사이에서 토글한다', () => {
    expect(toggleSpeakState('idle')).toBe('speaking');
    expect(toggleSpeakState('speaking')).toBe('idle');
  });

  it('재생 중 다시 누르면 정지하고 버튼 상태를 직접 해제한다', () => {
    voices = [GOOGLE];
    const button = document.createElement('button');

    speakWord('annum', button);
    expect(button.classList.contains('speaking')).toBe(true);
    speakWord('annum', button);

    expect(cancel).toHaveBeenCalled();
    expect(button.classList.contains('speaking')).toBe(false);
    expect(spoken).toHaveLength(1);
  });

  it('팝업을 닫으면 재생을 멈추고 버튼 상태를 해제한다', () => {
    voices = [GOOGLE];
    const button = document.createElement('button');
    initSelectionPopup();
    speakWord('annum', button);
    cancel.mockClear();

    destroySelectionPopup();

    expect(cancel).toHaveBeenCalledOnce();
    expect(button.classList.contains('speaking')).toBe(false);
  });

  it('말하지 않은 상태에서 팝업을 닫아도 페이지 음성을 취소하지 않는다', () => {
    initSelectionPopup();

    destroySelectionPopup();

    expect(cancel).not.toHaveBeenCalled();
  });

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
