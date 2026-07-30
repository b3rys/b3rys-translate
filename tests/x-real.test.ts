import { describe, it, expect } from 'vitest';

function setHost(host: string) {
  // detectTextBlocks 는 인자가 아니라 location.hostname 을 읽는다.
  Object.defineProperty(window, 'location', {
    value: new URL(`https://${host}/thsottiaux`),
    writable: true,
    configurable: true,
  });
}
import { detectTextBlocks } from '../entrypoints/content/text-detector';

// 실제 x.com/thsottiaux 에서 2026-07-30 에 뜬 글의 DOM 구조 그대로.
// <br> 0개 · white-space:pre-wrap · 개행은 첫번째 자식 span 의 텍스트 노드 안에 있다.
function buildRealX() {
  document.body.innerHTML = '';
  const art = document.createElement('article');
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'tweetText');
  div.style.whiteSpace = 'pre-wrap';
  const s1 = document.createElement('span');
  s1.style.whiteSpace = 'pre-wrap';
  s1.appendChild(
    document.createTextNode(
      'Turns out GPT-5.6 Sol is actually SoTA on ARC-AGI-3. \n\nJust took two setting changes. You just have to allow it to reason and work over multiple context windows with the help of our canonical compaction implementation.\n\n',
    ),
  );
  const s2 = document.createElement('span');
  s2.style.whiteSpace = 'pre-wrap';
  s2.textContent = 'openai.com/index/how-two-settings-tripled-our-arc-agi-3-scores/…';
  div.append(s1, s2);
  art.appendChild(div);
  document.body.appendChild(art);
  return div;
}

describe('실제 X DOM', () => {
  it('x.com — 빈 줄이 살아서 나온다', () => {
    buildRealX();
    setHost('x.com');
    const blocks = detectTextBlocks(document.body);
    const hit = blocks.filter((b) => b.text.includes('SoTA'));
    console.log('  블록 수 :', hit.length);
    hit.forEach((b, i) =>
      console.log(
        `  [${i}] 빈줄=${/\n[ \t]*\n/.test(b.text)} :: ${JSON.stringify(b.text.slice(0, 90))}`,
      ),
    );
    expect(hit.some((b) => /\n[ \t]*\n/.test(b.text))).toBe(true);
  });

  it('다른 사이트 — 동일 DOM 이어도 이전과 똑같이 공백으로 붕괴', () => {
    buildRealX();
    setHost('example.com');
    const blocks = detectTextBlocks(document.body);
    const hit = blocks.filter((b) => b.text.includes('SoTA'));
    hit.forEach((b, i) =>
      console.log(`  [${i}] 빈줄=${/\n/.test(b.text)} :: ${JSON.stringify(b.text.slice(0, 90))}`),
    );
    expect(hit.every((b) => !/\n/.test(b.text))).toBe(true);
  });
});
