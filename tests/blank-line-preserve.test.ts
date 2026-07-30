import { describe, it, expect } from 'vitest';
import { buildTranslationPrompt } from '../utils/engines/llm-helpers';

// ★이 수정의 핵심 불변식★ — 빈 줄이 없는 글에는 아무 영향도 없어야 한다.
//   X 지원 때문에 다른 사이트가 깨지면 안 되므로, "사이트 목록" 이 아니라
//   "이 글에 빈 줄이 있는가" 라는 텍스트 성질로만 갈린다.
describe('빈 줄 보존 — 다른 사이트에 영향 없음', () => {
  const lang = { targetLang: 'ko' };

  it('빈 줄이 없으면 프롬프트가 기존과 완전히 같다 (지시가 안 붙는다)', () => {
    const prompt = buildTranslationPrompt(
      [{ id: 'a', text: 'A single paragraph with no blank line inside it.' }],
      lang,
    );
    expect(prompt).not.toContain('Keep blank lines');
  });

  it('여러 항목이어도 빈 줄이 없으면 지시가 안 붙는다', () => {
    const prompt = buildTranslationPrompt(
      [
        { id: 'a', text: 'First paragraph.' },
        { id: 'b', text: 'Second paragraph.' },
        { id: 'c', text: 'Third with\na single newline only.' },
      ],
      lang,
    );
    expect(prompt).not.toContain('Keep blank lines');
  });

  it('한 항목이라도 빈 줄이 있으면 지시가 붙는다', () => {
    const prompt = buildTranslationPrompt(
      [
        { id: 'a', text: 'Plain paragraph.' },
        { id: 'b', text: 'Has a blank line\n\ninside this one.' },
      ],
      lang,
    );
    expect(prompt).toContain('Keep blank lines');
  });

  it('지시가 붙어도 기존 지시문은 그대로 남는다', () => {
    const prompt = buildTranslationPrompt([{ id: 'a', text: 'x\n\ny' }], lang);
    expect(prompt).toContain('You are a professional translator');
    expect(prompt).toContain('Maintain the original meaning, tone, and paragraph structure');
    expect(prompt).toContain('Preserve all HTML tags');
    expect(prompt).toContain('Do not add explanations or notes');
  });
});

// ─────────────────────────────────────────────────────────────
// 텍스트 추출 단계 — 번역기로 보내는 글에 빈 줄이 남는가
// 원래 `\s+ → ' '` 라 개행까지 공백이 됐고, 그래서 번역기는 문단 구분을
// 애초에 받지 못했다(X 실측: 긴 글이 한 덩어리로 번역됨).
import { describe as d2, it as it2, expect as e2, beforeEach as be2 } from 'vitest';
import { detectTextBlocks } from '../entrypoints/content/text-detector';

function stubHost(h: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: h, href: `https://${h}/` },
    writable: true,
  });
}
function renderTweetLike(host: string): void {
  stubHost(host);
  document.body.innerHTML = '';
  const d = document.createElement('div');
  d.setAttribute('data-testid', 'tweetText');
  const s = document.createElement('span');
  s.style.whiteSpace = 'pre-wrap';
  s.innerHTML = '<span>First paragraph here.\n\nSecond paragraph here.\n\nThird one.</span>';
  d.appendChild(s);
  document.body.appendChild(d);
}

d2('텍스트 추출 — 빈 줄 보존 범위', () => {
  be2(() => {
    document.body.innerHTML = '';
  });

  it2('splitParagraphs 사이트(x.com)는 문단마다 별도 블록이 된다', () => {
    renderTweetLike('x.com');
    // 문단이 쪼개지므로 블록 하나에는 빈 줄이 남지 않는다. 빈 줄 보존은
    // 쪼개기가 거절될 때를 위한 안전망으로 남아 있다 (아래 단일 개행 테스트).
    const texts = detectTextBlocks(document.body).map((b) => b.text);
    e2(texts).toEqual(['First paragraph here.', 'Second paragraph here.', 'Third one.']);
  });

  it2('★규칙이 없는 사이트는 기존대로 모든 공백을 붕괴시킨다★', () => {
    renderTweetLike('example.com');
    const text = detectTextBlocks(document.body)[0]?.text ?? '';
    e2(/\n/.test(text)).toBe(false);
    e2(text).toBe('First paragraph here. Second paragraph here. Third one.');
  });

  it2('빈 줄이 아닌 단일 개행은 공백으로 접힌다 (문단이 아니므로)', () => {
    stubHost('x.com');
    document.body.innerHTML = '';
    const d = document.createElement('div');
    d.setAttribute('data-testid', 'tweetText');
    const s = document.createElement('span');
    s.style.whiteSpace = 'pre-wrap';
    s.innerHTML = '<span>One line\nstill the same sentence continues here.</span>';
    d.appendChild(s);
    document.body.appendChild(d);
    const text = detectTextBlocks(document.body)[0]?.text ?? '';
    e2(text).toBe('One line still the same sentence continues here.');
  });
});
