# antirez site-scoped PRE 변경 독립 검증 보고서

## verdict

**CHANGES REQUESTED (회귀 위험 있음)**

`antirez.com/news/169`의 현재 DOM에서는 제목과 본문 `<pre>`가 정확히 검출되고, 다른 도메인에서는 전역 PRE 제외가 유지되며, 관련/전체 자동 테스트도 모두 통과했다. 그러나 규칙이 URL 169에 한정되지 않고 `antirez.com` 도메인 전체에 적용되며, 같은 selector가 현재 홈페이지의 100개 글 본문/미리보기 `<pre>` 전부와 제목 100개를 매치한다. 그 결과 홈페이지 번역 1회가 200개 블록, 약 78,166자를 검출하는 실측 가능한 범위 확장을 만든다. 수정 목적이 `news/169` 문제 해결이라면 selector가 충분히 좁지 않아 비용·지연·대량 DOM 주입 회귀를 초래할 수 있다.

## severity별 발견

### HIGH

#### H1. `news/169` 수정이 도메인 전체의 100개 PRE를 opt-in한다

- **근거**
  - `utils/site-rules.ts:57-61`: hostname `antirez.com`에 URL/path 조건 없이 `translateSelectors`를 등록한다.
  - `utils/site-rules.ts:72-83`: exact hostname뿐 아니라 parent-domain 방식으로도 동일 rule을 반환한다.
  - `entrypoints/content/text-detector.ts:28-33`: `translateSelectors`가 있으면 표준 Phase 1/2를 완전히 대체하고 selector 결과를 즉시 반환한다.
  - `entrypoints/content/text-detector.ts:67-83`: 매치된 모든 요소를 각각 번역 블록으로 claim하며 PRE/코드 안전 필터를 거치지 않는다.
  - 실제 `https://antirez.com/` HTML 실측: `#newslist article h2` 100개 + `topcomment article.comment > pre` 100개, 총 200개 매치; 합계 78,166자(그중 PRE 74,600자).
  - 비교: 실제 `https://antirez.com/news/169`은 2개 매치, 합계 7,473자(본문 PRE 7,442자).
- **영향**
  - 기존에는 `SKIP_TAGS`의 PRE 제외 때문에 홈페이지의 100개 PRE가 번역되지 않았으나, 변경 후 한 번의 페이지 번역에서 모두 API 배치 대상으로 들어간다.
  - API 비용/지연, 로더 및 번역 span 100개 추가, 스크롤 높이 급증, MutationObserver가 잦은 사이트 재렌더와 결합될 경우 재번역 압력이 커질 수 있다.
  - `translateSelectors`는 표준 검출을 대체하므로 antirez 도메인의 selector 밖 일반 본문/UI는 이전과 달리 검출되지 않는 부수 효과도 생긴다.
- **판정**: 수정 목적이 특정 `/news/169` 본문이라면 blocking. path-aware rule 또는 해당 기사 식별자(`article[data-news-id="169"]`, `data-comment-id` 등)까지 범위를 좁히는 설계가 필요하다. 사이트 전체 PRE 번역이 의도라면 제품 요구로 명시하고 홈페이지 대량 검출/비용 회귀 테스트가 필요하다.

### MEDIUM

#### M1. Phase 0 selector가 PRE 내부 CODE 안전 경계를 우회한다

- **근거**
  - `entrypoints/content/text-detector.ts:116-119`: 전역 표준 검출은 `SKIP_TAGS`의 PRE/CODE를 subtree 단위로 제외한다.
  - 반면 `entrypoints/content/text-detector.ts:67-83`의 selector 경로는 `rejectIfSkippable`, `SKIP_TAGS`, `cleanForAPI`를 호출하지 않고 매치된 PRE 전체의 `textContent`를 번역 입력으로 만든다.
  - `utils/site-rules.ts:60`의 selector는 `topcomment article.comment > pre`라는 구조만 확인하며, PRE 안에 CODE가 있는지는 확인하지 않는다.
- **영향**
  - 현재 live `/news/169` PRE에는 `<code>`가 없고 `<a>` 1개만 있어 현재 페이지에서는 재현되지 않았다.
  - 그러나 antirez가 같은 article PRE 안에 코드 예제를 추가하거나 과거/향후 글이 `<code>`를 포함하면 코드도 prose와 함께 번역된다. fixture의 코드 반증은 `<aside><pre><code>`라 selector 밖이어서 이 경계를 검증하지 못한다.
- **판정**: 구조 drift 시 코드블록 회귀 가능. 매치된 PRE 내부 CODE 제외/분리 여부를 명시하고 adversarial test를 추가해야 한다.

### LOW

#### L1. 새 테스트가 주입 성공만 검증하고 PRE 복구·replace mode·observer 무반응을 검증하지 않는다

- **근거**
  - `tests/antirez-site-rule.test.ts:47-59`: PRE 번역 span의 `whiteSpace === 'pre-wrap'`만 확인한다.
  - `entrypoints/content/translator.ts:1066-1073`: PRE에 block span과 inline `white-space: pre-wrap`을 적용한다.
  - `entrypoints/content/translator.ts:1139-1140`: PRE 원문 내부에 번역 span을 append한다.
  - `entrypoints/content/translator.ts:773-800`: purge가 번역 및 ORIGINAL/BLOCK_ID를 복구하지만 antirez PRE roundtrip test는 없다.
  - `entrypoints/content/observer.ts:42-73`: childList observer는 b3rys 요소를 무시하도록 되어 있으나 PRE 주입과 observer를 결합한 테스트는 없다.
- **검토 결과**
  - 코드상 번역 span은 `data-b3rys-translated`와 `b3rys-translation`을 가져 observer에서 무시된다(`observer.ts:11-18,52-56`). ORIGINAL 변경은 attribute observation 대상이 아니다.
  - purge는 번역 span 제거 후 PRE의 anchor 등에 붙은 ORIGINAL attribute를 제거하므로 통상 복구 가능하다.
  - replace mode에서는 PRE의 긴 loose text node들을 wrapper span으로 재부모화했다가 해제한다(`translator.ts:1282-1317`). 정적 antirez 페이지에서는 framework 충돌 가능성이 낮지만 실제 roundtrip/serialization 검증은 없다.
- **판정**: 현재 코드에서 즉시 확인되는 observer 무한 루프는 없으나, 회귀 방지를 위해 PRE inject→replace/parallel→purge와 observer callback 0회 테스트가 필요하다.

### INFO / 확인된 안전성

- `entrypoints/content/text-detector.ts`는 HEAD와 SHA-256이 동일(`d3cd3931...babc9db5ea`)하고 git diff가 없어 전역 detector 로직 자체는 변경되지 않았다.
- 비-antirez 도메인은 계속 `SKIP_TAGS` PRE/CODE 제외를 거친다(`text-detector.ts:107-125`). 신규 테스트도 동일 fixture를 `example.com`으로 실행해 prose PRE와 code PRE 모두 미검출임을 확인한다(`tests/antirez-site-rule.test.ts:39-45`).
- `/news/169` live DOM은 현재 selector와 일치한다: 제목 1개, 직접 자식 본문 PRE 1개; 본문 PRE에는 anchor 1개, CODE 0개.
- PRE 주입은 nowrap 보정용 추가 `<br>` 경로에서 명시적으로 제외된다(`translator.ts:1121-1137`). 따라서 PRE에서는 중복 줄바꿈용 b3rys BR이 추가되지 않는다.
- translation span 자체는 `pre-wrap`이므로 번역 결과의 `\n\n` 문단 구분은 렌더링된다(`translator.ts:1069-1072`).

## 파일:라인 근거

| 파일:라인                                            | 근거                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `utils/site-rules.ts:57-61`                          | antirez 도메인 전체에 두 selector 등록                              |
| `utils/site-rules.ts:72-83`                          | exact/parent-domain hostname 매칭, path 분기 없음                   |
| `entrypoints/content/text-detector.ts:28-33`         | site selector가 있으면 표준 검출을 대체                             |
| `entrypoints/content/text-detector.ts:67-83`         | selector 매치 직접 claim; SKIP_TAGS 미적용                          |
| `entrypoints/content/text-detector.ts:107-125`       | 표준 경로의 PRE/CODE 전역 제외                                      |
| `entrypoints/content/translator.ts:937-952`          | 번역 주입 dispatch                                                  |
| `entrypoints/content/translator.ts:954-958`          | 재주입 시 선행 번역 제거                                            |
| `entrypoints/content/translator.ts:1066-1073`        | 모든 PRE 주입 span을 block/pre-wrap 처리                            |
| `entrypoints/content/translator.ts:1121-1140`        | PRE는 nowrap BR 보정 제외 후 내부 append                            |
| `entrypoints/content/translator.ts:735-800`          | CSS hide와 실제 purge/원문 복구                                     |
| `entrypoints/content/translator.ts:1282-1317`        | replace mode loose text wrapper 생성/해제                           |
| `entrypoints/content/observer.ts:11-18,42-73`        | b3rys 주입 노드 무시 및 childList-only observer                     |
| `tests/antirez-site-rule.test.ts:31-59`              | 현재 테스트의 검출/타 도메인/PRE 줄바꿈 범위                        |
| `tests/fixtures/antirez-article.html:1-18`           | 축약 fixture; live 7,442자 본문·홈페이지 100개 구조를 대표하지 않음 |
| `tests/acceptance/detect-and-inject.test.ts:142-149` | 기존 일반 웹 코드 PRE 제외 회귀 테스트                              |

## 재현 명령/결과

### 관련 웹 번역 테스트

```bash
npm run test -- --run tests/antirez-site-rule.test.ts tests/site-rules.test.ts tests/text-detector.test.ts tests/translator.test.ts tests/observer.test.ts tests/acceptance/detect-and-inject.test.ts
```

결과: **PASS, 98/98 tests**, 6 files, 약 518ms. Node의 localStorage experimental warning만 있었고 실패는 없었다.

### 전체 테스트

```bash
npm run test -- --run
```

결과: **PASS, 321/321 tests**, 29 files, 약 36.3s.

### 타입 검사

```bash
npm run typecheck
```

결과: **PASS**, `tsc --noEmit` exit 0.

### detector 전역 변경 여부

```bash
git show HEAD:entrypoints/content/text-detector.ts | shasum -a 256
shasum -a 256 entrypoints/content/text-detector.ts
git diff --exit-code -- entrypoints/content/text-detector.ts
```

결과: 두 hash 모두 `d3cd3931d12439a1a2952dc4eaff85debb225c57c403bff82f6a08babc9db5ea`, diff exit 0.

### live DOM 구조/범위 실측

외부 API나 자격증명 없이 공개 HTML을 GET하고 happy-dom selector로 계수했다.

```text
https://antirez.com/          status=200, h2=100, top-level article PRE=100
selector union               matched=200, totalChars=78,166, preChars=74,600
https://antirez.com/news/169 status=200, h2=1,   top-level article PRE=1
selector union               matched=2, totalChars=7,473, preChars=7,442
/news/169 PRE                direct child tags=A, links=1, codes=0
```

## 반증 시도

1. **전역 PRE 제외가 깨졌는가?**
   - `text-detector.ts` HEAD/worktree hash 동일 및 diff 없음.
   - `example.com` fixture 테스트와 기존 GitHub code-PRE acceptance test 모두 통과.
   - 결론: 일반 도메인의 전역 PRE 제외는 유지된다.
2. **selector가 live `/news/169`에서 drift했는가?**
   - 공개 HTML을 직접 가져와 두 selector 모두 정확히 1개씩 매치함을 확인.
   - 결론: 현재 해당 URL에서는 drift 없음.
3. **selector가 목적 URL에만 좁혀졌는가?**
   - 홈페이지와 `/news/168`을 동일 방식으로 확인. 홈페이지 200개 매치, `/news/168`도 제목/PRE 각 1개 매치.
   - 결론: 반증 실패; 규칙은 `/news/169` 전용이 아니라 모든 동일 구조 글과 홈페이지 100개 PRE에 적용된다.
4. **현재 `/news/169` 코드가 오번역되는가?**
   - live PRE의 CODE count 0 확인.
   - 결론: 현재 169에서는 발생하지 않지만 selector 경로가 CODE 필터를 우회하므로 drift 위험은 남는다.
5. **주입이 observer 재호출을 직접 유발하는가?**
   - observer 구현상 data/class b3rys 노드를 무시하고 관련 observer 단위 테스트 10개 통과.
   - 결론: 일반 주입 span으로 인한 직접 callback/무한 루프 근거는 찾지 못했다. 다만 PRE와 observer를 결합한 전용 테스트는 없다.

## unverified scope

- Chrome 실브라우저에서 `/news/169` 실제 번역 API 응답을 사용한 시각적 레이아웃, 스크롤 안정성, 긴 7,442자 단일 블록의 번역 완결성은 검증하지 않았다.
- 외부 번역 API 및 자격증명에는 접근하지 않았다. 따라서 모델별 최대 입력/출력 토큰, 비용, 긴 본문 truncation 여부는 미검증이다.
- 홈페이지 200블록을 실제 API로 번역해 비용/시간/MutationObserver 횟수를 계측하지 않았다. DOM selector 및 문자 수만 실측했다.
- antirez 전체 과거 글을 전수 조사해 PRE 내부 CODE 존재 여부를 확인하지 않았다. `/news/168`, `/news/169`, 홈페이지 구조만 표본 확인했다.
- replace mode에서 live PRE를 실제 Chrome DOM으로 toggle하고 원문 HTML byte-equivalent 복구를 확인하지 않았다.
- 네트워크 응답 당시 live 구조는 확인했지만 향후 사이트 markup 변경에 대한 보장은 없다.
