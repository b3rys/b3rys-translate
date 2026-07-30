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
