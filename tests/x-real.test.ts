import { describe, it, expect } from 'vitest';
import { detectTextBlocks } from '../entrypoints/content/text-detector';

function setHost(host: string) {
  // detectTextBlocks 는 인자가 아니라 location.hostname 을 읽는다.
  Object.defineProperty(window, 'location', {
    value: new URL(`https://${host}/thsottiaux`),
    writable: true,
    configurable: true,
  });
}

// 실제 x.com/thsottiaux 에서 2026-07-30 에 뜬 글의 DOM 구조 그대로 떠온 것.
// <br> 0개 · white-space:pre-wrap · 개행은 ★첫번째 자식 span 의 텍스트 노드 안★ 에 있고
// 최상위(div)에는 텍스트 노드가 아예 없다. 두번째 span 은 뒤에 붙는 링크다.
const P1 = 'Turns out GPT-5.6 Sol is actually SoTA on ARC-AGI-3. ';
const P2 =
  'Just took two setting changes. You just have to allow it to reason and work over multiple context windows with the help of our canonical compaction implementation.';
const P3 = 'We should have recognized this sooner and been more upfront about it.';

function buildRealX() {
  document.body.innerHTML = '';
  const art = document.createElement('article');
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'tweetText');
  div.style.whiteSpace = 'pre-wrap';
  const s1 = document.createElement('span');
  s1.style.whiteSpace = 'pre-wrap';
  s1.appendChild(document.createTextNode(`${P1}\n\n${P2}\n\n${P3}\n\n`));
  const s2 = document.createElement('span');
  s2.style.whiteSpace = 'pre-wrap';
  s2.textContent = 'openai.com/index/how-two-settings-tripled-our-arc-agi-3-scores/…';
  div.append(s1, s2);
  art.appendChild(div);
  document.body.appendChild(art);
  return div;
}

describe('실제 X DOM', () => {
  it('x.com — 문단 3개가 각각 별도 블록이 된다', () => {
    buildRealX();
    setHost('x.com');
    const hit = detectTextBlocks(document.body).filter((b) =>
      /Sol|setting changes|sooner/.test(b.text),
    );
    hit.forEach((b, i) =>
      console.log(`  [${i}] <${b.element.tagName}> ${JSON.stringify(b.text.slice(0, 70))}`),
    );
    // 번역문이 문단마다 그 문단 바로 밑에 붙으려면 블록이 문단 수만큼 나와야 한다.
    expect(hit.map((b) => b.text)).toEqual([P1.trim(), P2, P3]);
  });

  it('다른 사이트 — 동일 DOM 이어도 이전과 똑같이 한 덩어리로 붕괴', () => {
    buildRealX();
    setHost('example.com');
    const hit = detectTextBlocks(document.body).filter((b) => b.text.includes('SoTA'));
    hit.forEach((b, i) => console.log(`  [${i}] ${JSON.stringify(b.text.slice(0, 70))}`));
    // 쪼개지지도, 개행이 남지도 않는다 — 이 변경 전과 글자 단위로 같다.
    expect(hit).toHaveLength(1);
    expect(hit[0].text).toBe(
      `${P1}${P2} ${P3} openai.com/index/how-two-settings-tripled-our-arc-agi-3-scores/…`
        .replace(/\s+/g, ' ')
        .trim(),
    );
  });
});
