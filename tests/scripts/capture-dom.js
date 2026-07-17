/* eslint-disable no-undef */
/**
 * b3rys DOM Capture — 브라우저 콘솔에서 실행
 *
 * 사용법:
 *   1. 대상 페이지를 Chrome에서 열기
 *   2. DevTools → Console 에 이 스크립트 전체를 복붙
 *   3. 콘솔 출력에서 fixture HTML을 복사 → tests/fixtures/{name}.html 로 저장
 *
 * 옵션:
 *   b3rysCaptureDOM()                    — 자동 선택 (article > main > body)
 *   b3rysCaptureDOM('article.post-content')  — 특정 selector 지정
 */
(() => {
  const REMOVE_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'IFRAME',
    'NOSCRIPT',
    'SVG',
    'IMG',
    'VIDEO',
    'AUDIO',
    'CANVAS',
    'TEMPLATE',
  ]);
  const REMOVE_ATTRS = /^(on\w+|data-(?!b3rys)\S+|jsaction|jscontroller|jsmodel|jsname)$/i;
  const MAX_SIZE = 50 * 1024;

  function clean(el) {
    const clone = el.cloneNode(true);
    // Remove unwanted tags
    for (const tag of REMOVE_TAGS) {
      clone.querySelectorAll(tag).forEach((n) => n.remove());
    }
    // Remove noisy attributes
    clone.querySelectorAll('*').forEach((n) => {
      for (const attr of Array.from(n.attributes)) {
        if (REMOVE_ATTRS.test(attr.name)) {
          n.removeAttribute(attr.name);
        }
      }
      // Remove empty class/style
      if (n.getAttribute('class') === '') n.removeAttribute('class');
      if (n.getAttribute('style') === '') n.removeAttribute('style');
    });
    return clone;
  }

  function findContentRoot(selector) {
    if (selector) return document.querySelector(selector);
    // Auto-detect: try common content containers
    const candidates = [
      'article',
      'main',
      '[role="main"]',
      '[role="article"]',
      '.post-content',
      '.entry-content',
      '.article-body',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 100) return el;
    }
    return document.body;
  }

  function analyze(root) {
    // Quick text block analysis
    const BLOCK_TAGS = new Set([
      'P',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'LI',
      'TD',
      'TH',
      'BLOCKQUOTE',
    ]);
    const blocks = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const el = node;
      const text = el.textContent?.trim() ?? '';
      if (!text || text.length < 5) continue;

      const isBlock = BLOCK_TAGS.has(el.tagName);
      const isLeafDiv =
        (el.tagName === 'DIV' || el.tagName === 'SPAN') &&
        (el.children.length === 0 ||
          Array.from(el.children).every((c) =>
            ['A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'CODE', 'BR'].includes(c.tagName),
          ));

      if (isBlock || isLeafDiv) {
        const preview = text.substring(0, 80) + (text.length > 80 ? '...' : '');
        blocks.push({ tag: el.tagName, classes: el.className, len: text.length, preview });
      }
    }
    return blocks;
  }

  window.b3rysCaptureDOM = function (selector) {
    const root = findContentRoot(selector);
    if (!root) {
      console.error('Content root not found');
      return;
    }

    const cleaned = clean(root);
    let html = cleaned.innerHTML;

    // Collapse whitespace
    html = html.replace(/\n{3,}/g, '\n\n');

    if (html.length > MAX_SIZE) {
      console.warn(
        `HTML is ${(html.length / 1024).toFixed(1)}KB, truncating to ${MAX_SIZE / 1024}KB`,
      );
      const cutoff = html.lastIndexOf('>', MAX_SIZE);
      html = html.substring(0, cutoff > 0 ? cutoff + 1 : MAX_SIZE);
    }

    // Header
    const date = new Date().toISOString().split('T')[0];
    const header = `<!-- Fixture captured from: ${location.href}\n     Date: ${date}\n     Selector: ${selector || 'auto (' + root.tagName + '.' + (root.className || '').split(' ')[0] + ')'} -->\n`;

    const fixture = header + html.trim() + '\n';

    // Analysis
    const blocks = analyze(root);

    console.log(
      '%c=== b3rys DOM Capture ===',
      'color: #22c55e; font-weight: bold; font-size: 14px',
    );
    console.log(`Root: <${root.tagName}> class="${root.className}"`);
    console.log(`Size: ${(fixture.length / 1024).toFixed(1)}KB`);
    console.log(`\n%cDetectable text blocks: ${blocks.length}`, 'font-weight: bold');
    console.table(
      blocks.map((b, i) => ({
        '#': i + 1,
        tag: b.tag,
        class: (b.classes || '').substring(0, 30),
        len: b.len,
        preview: b.preview,
      })),
    );

    console.log('\n%cFixture HTML (copy below):', 'font-weight: bold; color: #22c55e');
    console.log(fixture);

    // Also copy to clipboard if possible
    try {
      navigator.clipboard.writeText(fixture);
      console.log('%c✓ Copied to clipboard!', 'color: #22c55e');
    } catch {
      console.log('(clipboard copy failed — manually copy the text above)');
    }

    return { fixture, blocks, root: root.tagName + '.' + (root.className || '').split(' ')[0] };
  };

  console.log('%cb3rysCaptureDOM() ready', 'color: #22c55e; font-weight: bold');
  console.log('Usage: b3rysCaptureDOM()  or  b3rysCaptureDOM("selector")');
})();
