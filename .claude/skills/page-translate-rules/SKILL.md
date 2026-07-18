---
name: page-translate-rules
description: 페이지 번역 룰 (text detection, injection, batch, cache). text-detector.ts, translator.ts, constants.ts 수정 시 참조.
---

# 페이지 번역 룰

## Text Detection (text-detector.ts) — 아키텍처

```
detectTextBlocks()
  ├── Phase 0: translateSelectors       ← 사이트별 CSS 셀렉터 (Gmail 등)
  │
  ├── onlyWithin (whitelist)            ← 콘텐츠 영역만 감지 (GitHub 등)
  │   ├── 매칭 컨테이너 있으면 → 그 안에서만 Phase 1+2 실행
  │   └── 없으면 → fall through to Phase 1+2 (skipSelectors 적용)
  │
  ├── Phase 1: detectStandardBlocks()   ← 시맨틱 블록 태그
  │   ├── TreeWalker (rejectIfSkippable → TRANSLATABLE_TAGS 매칭)
  │   ├── shouldSkipText(phase=1) — 텍스트 필터 [F1-F2]
  │   └── filterAncestorBlocks()   ← 중복 제거
  │
  └── Phase 2: detectLeafTextBlocks()   ← 텍스트 컨테이너
      ├── TreeWalker (rejectIfSkippable → TABLE REJECT → DIV/SPAN/A/BUTTON + leaf or inline children)
      ├── 조상 BLOCK_ID 체크 → 이미 감지된 부모의 자식 제외
      └── shouldSkipText(phase=2) — 텍스트 필터 [F1-F2, F5]
```

**설계 철학: "Translate Everything by Default"**

- 기본값은 모든 보이는 텍스트를 번역
- 스킵은 명시적 규칙으로만: SKIP_TAGS, site-rule skipSelectors/onlyWithin, URL, 비소스언어, <2자
- 휴리스틱 필터(짧은 텍스트, 링크 비율 등) 제거 → 일관성 확보

**Phase 1: 시맨틱 블록 감지**

- `TRANSLATABLE_TAGS` (P, H1-H6, LI, TD, TH, BLOCKQUOTE 등) 매칭
- `getDirectText()`: 재귀적으로 boundary 자식(SKIP_TAGS/TRANSLATABLE_TAGS/TEXT_BOUNDARY_TAGS/**composite-cell 컨테이너**) 제외, inline 텍스트만 수집 (`isTextCollectionBoundary()`)
- `getDirectHTML()`: inline 마크업 보존 (a, code, strong 등), block/SKIP_TAGS/TEXT_BOUNDARY_TAGS 자식은 제외. `cleanForAPI()`로 비필수 속성(id, class, `data-*`, `aria-*`) 제거 → 깔끔한 HTML만 API에 전송
- `TEXT_BOUNDARY_TAGS`: BUTTON, FORM, DIALOG, DETAILS, TEMPLATE, NAV — TreeWalker는 진입하지만 `getDirectText`/`getDirectHTML`은 재귀하지 않음 (SKIP_TAGS와 다름)
- `filterAncestorBlocks()`: 자식 블록이 있는 부모 블록 제거 (중복 번역 방지)

**Phase 2: 텍스트 컨테이너 감지**

- Phase 1에서 못 잡는 nav 메뉴, 사이드바, 바이오 텍스트, 독립 링크 제목 감지
- DIV, SPAN, A, BUTTON, TIME 중:
  - `children.length === 0` (리프 요소), 또는
  - `hasOnlyInlineChildren()` — 재귀적 검사 (자식 + 손자까지 모두 인라인 태그: A, SPAN, STRONG, EM 등. 카드 wrapping `<a>` 내부에 DIV가 있으면 거부) **AND** `!isCompositeCells()`
- **`isCompositeCells()` — 복합 셀 컨테이너 분해**: 텍스트 가진 자식 ≥2 + 직속 loose 텍스트 없음일 때 두 신호 중 하나면 셀 분해 — ①**글루**(인접 자식 텍스트가 공백 없이 접합, anthropic.com/news `DateCategory`) ②**블록 셀**(인접 두 자식이 DIV/SECTION 등 `BLOCK_CELL_TAGS` — 카드의 title/desc div 쌍, claude.com TOC run-on 회귀). 한 단위로 수락하지 않고 SKIP → 하강해서 각 셀 개별 감지. Phase 1 `getDirectText`/`getDirectHTML`도 동일 술어로 composite 자식을 경계 처리 (LI가 행 전체를 흡수하는 경로 차단). 레이아웃 읽기 없음 — 순수 DOM 판정이라 happy-dom 테스트 가능
- Phase 1에서 이미 감지된 요소(`DATA_ATTRS.BLOCK_ID`)는 REJECT (중복 방지)
- **조상 중복 제거**: 부모가 이미 Phase 2에서 감지된 경우 자식은 제외 (`parentElement.closest([BLOCK_ID])`)
- HTML은 `textContent`(순수 텍스트)로 전송 — innerHTML 사용 안 함 (SVG 등 안전성)

## 공유 로직

**`rejectIfSkippable(el)` — TreeWalker 요소 거부 (Phase 1, 2 공통)**

| 라벨 | 조건                                                             | 동작   |
| ---- | ---------------------------------------------------------------- | ------ |
| [R1] | `DATA_ATTRS.TRANSLATED` 또는 `BLOCK_ID` 있음                     | REJECT |
| [R2] | `isElementHidden()` — 보이지 않는 요소                           | REJECT |
| [R3] | `SKIP_TAGS` (SCRIPT, STYLE, CODE, PRE, INPUT, FOOTER 등)         | REJECT |
| [R4] | Site-rule `skipSelectors` 매칭 (lazy 캐시, `getSkipSelectors()`) | REJECT |

**`shouldSkipText(el, text, phase)` — 텍스트 필터 파이프라인**

"Translate everything" — 최소 필터만 유지:

| 라벨 | Phase | 조건                                        | 설명                                           |
| ---- | ----- | ------------------------------------------- | ---------------------------------------------- |
| —    | 1, 2  | `text.length < 2`                           | 단일 문자 (X, ·, I 등)                         |
| [F1] | 1, 2  | `isUrlLike(text)`                           | URL 텍스트 (youtube.com/... 등)                |
| [F2] | 1, 2  | `!isLikelySourceLang(text)` (스크립트 비율) | 비소스언어 텍스트 (CJK/Cyrillic/Latin 감지)    |
| [F5] | 2     | `el.querySelector([BLOCK_ID])` 매칭         | Phase 1이 이미 처리한 자식이 있는 컨테이너     |
| [F7] | 2     | TreeWalker에서 TABLE → REJECT               | TABLE 내부는 Phase 2 감지 제외 (데이터 테이블) |

제거된 필터: [F3] isInsideSkippedAncestor, [F4] isMostlyLinks, [F6] 짧은 TD/TH, [F9] 짧은 텍스트

## Site Rules (site-rules.ts) — 사이트별 감지 제어

| 속성                 | 동작                                                                            | 사용 예                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `skipSelectors`      | 매칭 요소 + 자손 전부 REJECT (blacklist)                                        | Skilljar: `.clp__enroll-btn`, `header`                                                                                       |
| `onlyWithin`         | 매칭 컨테이너 안에서만 Phase 1+2 실행 (whitelist). 컨테이너 없으면 fall through | GitHub: `.markdown-body`; **Gmail: `[role="main"]`** (좌측 nav·챗 chrome churn 감지 제외 → circuit breaker 오작동·느림 방지) |
| `translateSelectors` | Phase 1+2 대체. 매칭 요소만 감지                                                | Gmail: `[role="main"]` 내부                                                                                                  |
| `injectAsSibling`    | 인라인 요소에 번역을 형제로 주입                                                | Substack                                                                                                                     |
| `forceReplace`       | translateSelectors와 함께 사용, 원문 교체                                       | —                                                                                                                            |

**`onlyWithin` + `skipSelectors` 조합 (GitHub 패턴):**

- 콘텐츠 영역(`.markdown-body` 등)이 있는 페이지 → `onlyWithin`만 적용, UI chrome 전부 스킵
- 콘텐츠 영역이 없는 페이지 (Settings 등) → `skipSelectors`로 fallback, 나머지 일반 감지

## 변경 체크리스트

**텍스트 필터 추가/수정 (예외 케이스):**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `content/text-detector.ts` | `shouldSkipText()` | `[Fn]` 라벨로 필터 블록 추가, `phase` 가드 지정 |
| 2 | 이 스킬 파일 | 텍스트 필터 파이프라인 테이블 | 라벨, Phase, 조건, 설명 행 추가 |

**TreeWalker 거부 조건 추가:**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `content/text-detector.ts` | `rejectIfSkippable()` | `[Rn]` 라벨로 조건 추가 |
| 2 | 이 스킬 파일 | `rejectIfSkippable` 테이블 | 라벨, 조건, 동작 행 추가 |

**스킵/번역 대상 태그 변경:**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `utils/constants.ts` | `SKIP_TAGS` 또는 `TRANSLATABLE_TAGS` | 태그 추가/제거 |
| 2 | 이 스킬 파일 | [R3] 설명 또는 Phase 1 설명 | 태그 목록 업데이트 |

**Phase 2 인라인 태그 확장:**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `content/text-detector.ts` | `PHASE2_INLINE_TAGS` | 태그 추가 |
| 2 | 이 스킬 파일 | Phase 2 설명 | 인라인 태그 목록 업데이트 |

**번역 주입 방식 변경 (inline/block, nav 처리 등):**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `content/translator.ts` | `injectTranslation()` | 로직 수정 |
| 2 | `content/translator.css` | 스타일 클래스 | 필요시 스타일 추가/수정 |
| 3 | 이 스킬 파일 | 번역 주입 섹션 | 규칙 업데이트 |

**번역 엔진 추가:**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `utils/engines/types.ts` | `EngineType`, `ENGINE_DISPLAY_NAMES` | 타입 + 표시명 추가 |
| 2 | `utils/engines/{name}.ts` | 신규 파일 | `TranslationEngine` 구현 |
| 3 | `utils/engines/index.ts` | `engines` 맵 | 엔진 등록 |
| 4 | `utils/constants.ts` | `ENGINE_ENDPOINTS`, `ENGINE_MODELS` | 엔드포인트/모델 추가 |
| 5 | `entrypoints/popup/index.html` | `#engine-select` | `<option>` 추가 |
| 6 | `wxt.config.ts` | `host_permissions` | API 도메인 추가 |

## Visibility 판단

- `offsetParent === null`만으로 판단 금지 — `position: fixed/sticky` 요소도 null 반환
- `isElementHidden()`: offsetParent가 null이면 `getClientRects().length === 0`으로 재확인
- `display: contents` 특수 처리: box가 없지만 (offsetParent=null, rects 없음) 자식은 보임

## 번역 주입 (translator.ts)

**일반 요소:**

- 짧은 텍스트 (≤ 60자): `b3rys-translation-inline` (같은 줄, margin-left)
- 긴 텍스트: `b3rys-translation` (블록, margin-top: 0.6em)
- **H1-H6 헤딩, P, BLOCKQUOTE, LABEL, LI**: 길이 무관 항상 블록 — 문단/리스트는 인라인 배치 시 원문과 번역이 붙어 보임

**Nav 요소 (`<nav>` 내부 짧은 LI ≤ 60자, LI 내부 A ≤ 60자):**

- `isNavItem()`: `element.closest('nav')` 필수 — `<nav>` 밖 LI는 일반 요소로 처리
- `b3rys-translation-inline` (인라인, 메뉴명 옆에 위치)
- LI: `<a>` 자식 내부에 번역 삽입 → 메뉴 텍스트 바로 옆에 표시
- 번역에서 wrapping `<a>` 태그 제거 (중복 링크 방지, textContent만 사용)
- **긴 LI (> 60자) 또는 `<nav>` 밖 LI**: 일반 요소와 동일하게 블록 처리
- **독립 `<a>` 요소** (LI 밖): 일반 요소와 동일하게 길이 기반 inline/block 처리

**스크롤 보존 (preserveScroll):**

- 번역 주입(`processBatch`) 및 제거(`removeAllTranslations`) 시 스크롤 위치 보존
- viewport 중앙 근처의 non-fixed 센티넬 요소를 찾아 DOM 변형 전후 위치 drift를 측정, `scrollBy`로 보정

**HTML Sanitization:**

- 허용 태그: A, CODE, STRONG, EM, B, I, BR, SPAN, SUB, SUP, MARK, SMALL, KBD
- A 태그: href, title만 허용, javascript:/data: 차단
- style 속성: 안전한 CSS만 허용 (color, text-decoration, font-weight 등)

## 배치 전략 (`runPipeline` — 우선순위 풀 + 워커)

- **Phase 0 — 캐시 선주입** (`injectCachedTranslations`): 배칭 전에 `CACHE_LOOKUP` 메시지(순수 캐시 읽기 — API·rate limit·통계 없음)로 전체 블록을 한 번에 조회, hit은 즉시 주입하고 **miss만** 파이프라인으로. 재방문 페이지가 즉시 렌더되는 이유. lookup 실패는 non-fatal (전량 일반 경로 폴백)
- **단일 우선순위 풀** (`runPipeline`): 옛 Phase 1a→1b→2 순차 배리어를 폐지. miss 블록을 하나의 `pending` 풀에 넣고 `PIPELINE_CONCURRENCY(=6)` 워커가 앞에서부터 `BATCH_SIZE(=15)`씩 뽑아 처리. 워커는 배치 끝나는 즉시 다음을 뽑음 → 배리어 idle 제거, 풀 saturation 유지
- **초기 순서**: main-viewport → side-viewport → remaining(거리순). 뷰포트가 먼저 그려짐
- **스크롤 팔로잉** (핵심): 스크롤 시 throttle(180ms)로 `pending`을 **현재 뷰포트 거리 기준 재정렬** → 사용자가 스크롤한 곳이 다음 배치가 됨(큐가 눈을 따라감). 거리는 블록당 1회만 측정해 Map 캐시 (comparator가 `getBoundingClientRect`를 O(n log n)회 호출하는 것 방지)
- **동시성 통일**: 옛 뷰포트 무제한(Promise.all→rate limit 버스트 위험) 제거, 전 구간 `PIPELINE_CONCURRENCY`로 bound. 정상 페이지는 총 호출이 rate limit(150/분) 훨씬 아래
- **drift 보정 공용화**: 모든 DOM 변이(로더 in/out·주입·에러·숨김)는 `withScrollCompensation(scroller, mutate)` 하나로 통일. scroller는 배치 요소에서 `getScrollContainer()`로 도출, 앵커는 `findContentAnchor()`가 스크롤러 내부를 탐침 (상세 규칙: safety-rules 스킬의 "스크롤 drift 보정")

## 번역 캐시 (background.ts + translation-cache.ts)

- LRU 캐시, `chrome.storage.local`에 영속 저장
- TTL: 7일, 최대 1000개 엔트리
- API 호출 전 캐시 조회 → 히트 시 즉시 반환, 미스만 엔진 호출
- 캐시 키 prefix는 `cacheKeyPrefix(targetLang, mode)` 단일 소스 — `CACHE_LOOKUP`과 `TRANSLATE_BATCH`가 공유 (어긋나면 선주입이 무력화되므로 반드시 이 함수만 사용)
- 캐시 클리어: 서비스워커 콘솔에서 `chrome.storage.local.remove('b3rys_translation_cache')`
