/**
 * x.com/thsottiaux/status/2082317452755751098 — 2026-07-30 에 로그인된 실제 페이지에서
 * 태그 구조와 텍스트만 직렬화해 가져온 것. 속성·URL 은 전부 버렸다.
 *
 * 이 글이 중요한 이유: 빈 줄이 손자 span 여러 개에 흩어져 있고, 문단 하나가
 * span 경계를 넘어간다 (GC3 끝 → GC4 전체 → GC5 앞). 최상위만 보는 방식으로는
 * 경계가 하나도 안 보인다.
 */
export const GC1 = "Hello people of Sol! I've ";
export const GC2 = 'reset';
export const GC3 =
  ' usage limits for all ChatGPT Work and Codex users. Together with that, a quick update on GPT-5.6 Sol usage limits.\n\nOver the past few weeks, many of you have told us that Sol was using your Codex limits faster than expected. To be clear, we have not reduced usage on any subscription plans.\n\nWe’ve been digging into what was happening and have landed several improvements. ';
export const GC4 =
  'As a result, we expect your usage to last around 18% longer during typical use of Sol';
export const GC5 =
  '. Some of you should already see significantly larger improvements from today. Tomorrow, we’ll also restore the five-hour limit that we temporarily paused while investigating.\n\nHere’s what we found:\n- GPT-5.6 Sol is much more willing to work for longer, make additional tool calls, and coordinate complex workflows across tools and subagents. That makes it better at solving hard problems, but some tasks were using far more than we intended.\n- Sol also works harder at the same reasoning effort than previous models. High on Sol can use more tokens than High did on GPT-5.5.\n- Programmatic tool calling, also referred to as code mode, gives Sol much more flexibility to run tool calls in parallel or continue working while waiting. But it also led to more responses per turn, more cached input tokens, and higher usage than expected.\n- This was particularly noticeable when Sol was waiting for tool calls to finish or running many web searches. We’ve improved how we handle both cases and are continuing to make code mode more efficient.\n- The impact was also very uneven. The median user actually found Sol quite token efficient, while some power users working on harder tasks saw their usage drain much faster. We were very focused on average and median usage before launch and missed some cases where the long tail could use significantly more usage.\n\nSol is a significant step forward in what Codex can do, but capability and efficiency do not always improve at the same pace, and some issues only become clear once people are using the model at real-world scale. We should have recognized this sooner and been more upfront about it.\n\nYou keep pushing the frontier and we’ll keep improving efficiency and sharing updates as we go.';

export const GRANDCHILDREN = [GC1, GC2, GC3, GC4, GC5];

/** 작성자가 빈 줄로 끊어놓은 문단 6개의 첫 구절. */
export const PARAGRAPH_OPENINGS = [
  "Hello people of Sol! I've reset usage limits",
  'Over the past few weeks, many of you have told us',
  'We’ve been digging into what was happening',
  'Here’s what we found:',
  'Sol is a significant step forward in what Codex can do',
  'You keep pushing the frontier',
];

/** 실제 X 마크업 그대로 조립: div[tweetText] > span > span×5 */
export function buildRealXPost(): HTMLElement {
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'tweetText');
  div.style.whiteSpace = 'pre-wrap';
  const outer = document.createElement('span');
  outer.style.whiteSpace = 'pre-wrap';
  for (const text of GRANDCHILDREN) {
    const s = document.createElement('span');
    s.style.whiteSpace = 'pre-wrap';
    s.appendChild(document.createTextNode(text));
    outer.appendChild(s);
  }
  div.appendChild(outer);
  return div;
}
