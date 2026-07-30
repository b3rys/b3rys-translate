import { describe, it, expect } from 'vitest';
import { detectTextBlocks } from '../entrypoints/content/text-detector';
import {
  buildRealXPost,
  GRANDCHILDREN,
  PARAGRAPH_OPENINGS,
} from './fixtures/x-status-2082317452755751098';

function setHost(host: string) {
  // detectTextBlocks 는 인자가 아니라 location.hostname 을 읽는다.
  Object.defineProperty(window, 'location', {
    value: new URL(`https://${host}/thsottiaux`),
    writable: true,
    configurable: true,
  });
}

function span(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.style.whiteSpace = 'pre-wrap';
  s.appendChild(document.createTextNode(text));
  return s;
}

function mount(el: HTMLElement): void {
  document.body.innerHTML = '';
  const art = document.createElement('article');
  art.appendChild(el);
  document.body.appendChild(art);
}

function blocksOn(host: string): string[] {
  setHost(host);
  return detectTextBlocks(document.body).map((b) => b.text);
}

// ── 형태 A ───────────────────────────────────────────────────────────────────
// 프로필 목록의 짧은 글. 글 전체가 자식 span 하나에 들어가고 뒤에 링크 span 이 붙는다.
const A1 = 'Turns out GPT-5.6 Sol is actually SoTA on ARC-AGI-3. ';
const A2 = 'Just took two setting changes. You just have to allow it to reason.';
const A3 = 'We should have recognized this sooner.';

function buildShapeA(): void {
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'tweetText');
  div.style.whiteSpace = 'pre-wrap';
  div.append(span(`${A1}\n\n${A2}\n\n${A3}\n\n`), span('openai.com/index/…'));
  mount(div);
}

describe('형태 A — 프로필 목록의 짧은 글', () => {
  it('x.com — 문단 3개가 각각 별도 블록', () => {
    buildShapeA();
    expect(blocksOn('x.com')).toEqual([A1.trim(), A2, A3]);
  });

  it('다른 사이트 — 한 덩어리, 개행 없음', () => {
    buildShapeA();
    const got = blocksOn('example.com');
    expect(got).toHaveLength(1);
    expect(got[0]).not.toMatch(/\n/);
  });
});

// ── 형태 B ───────────────────────────────────────────────────────────────────
// 팀장님이 실제로 보고 계신 글 (status/2082317452755751098) 을 그대로 조립한 것.
describe('형태 B — 실제 글 상세 (빈 줄이 손자에 흩어지고 문단이 span 경계를 넘음)', () => {
  it('픽스처가 실제 구조 그대로인지', () => {
    // 이 전제가 깨지면 아래 두 테스트는 다른 것을 재고 있는 셈이다.
    const div = buildRealXPost();
    expect(div.children).toHaveLength(1);
    expect(div.children[0].children).toHaveLength(5);
    expect(div.querySelectorAll('br')).toHaveLength(0);
    // 빈 줄을 가진 손자가 둘 이상 — 하나만 골라 내려가는 방식이 통하지 않는 이유.
    expect(GRANDCHILDREN.filter((t) => /\n[ \t]*\n/.test(t))).toHaveLength(2);
    // 문단 하나가 손자 3개(GC3 끝·GC4 전체·GC5 앞)에 걸쳐 있다.
    expect(GRANDCHILDREN[3]).not.toMatch(/\n/);
  });

  it('x.com — 작성자가 끊어놓은 문단 6개가 각각 별도 블록', () => {
    mount(buildRealXPost());
    const got = blocksOn('x.com');
    got.forEach((t, i) => console.log(`  [${i}] ${JSON.stringify(t.slice(0, 60))}`));
    expect(got).toHaveLength(PARAGRAPH_OPENINGS.length);
    PARAGRAPH_OPENINGS.forEach((opening, i) => expect(got[i]).toContain(opening));
  });

  it('다른 사이트 — 쪼개지지 않고 개행도 남지 않는다 (변경 전 동작)', () => {
    mount(buildRealXPost());
    const got = blocksOn('example.com');
    expect(got).toHaveLength(1);
    expect(got[0]).not.toMatch(/\n/);
    expect(got[0]).toContain('Hello people of Sol');
    expect(got[0]).toContain('sharing updates as we go.');
  });
});
