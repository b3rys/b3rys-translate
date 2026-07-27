# b3rys-translate 코드베이스 아키텍처 분석

- 분석 대상: `/Users/gd452/Development/b3rys-translate`
- 분석 방식: 읽기 전용 정적 추적(소스·설정 수정 없음)
- 기준 브랜치: `main`
- 분석 초점: 기술 스택, 엔트리포인트, 웹페이지/YouTube 번역 E2E, 메시징, 엔진 추상화, 상태·캐시·스토리지 경계, 기존 문서-코드 대조

## 1. 확인한 소스/파일

### 프로젝트 규칙·설정·문서

- `CLAUDE.md`
- `.claude/skills/safety-rules/SKILL.md`
- `.claude/skills/page-translate-rules/SKILL.md`
- `.claude/skills/youtube-subtitle-rules/SKILL.md`
- `package.json`, `wxt.config.ts`, `types/index.ts`
- `README.md`, `docs/pipeline.md`, `docs/safety.md`, `docs/decisions.md`

### 런타임·공유 계층

- `entrypoints/background.ts`
- `entrypoints/content.ts`
- `entrypoints/popup/main.ts`
- `utils/messaging.ts`, `utils/storage.ts`, `utils/constants.ts`
- `utils/translation-state.ts`, `utils/translation-cache.ts`, `utils/site-rules.ts`
- `utils/engines/{types,index,llm-helpers,gemini,openai,anthropic}.ts`

### 웹페이지 번역

- `entrypoints/content/text-detector.ts`
- `entrypoints/content/translator.ts`
- `entrypoints/content/observer.ts`
- `entrypoints/content/floating-button.ts`

### YouTube 자막 번역

- `entrypoints/youtube-bridge.content.ts`
- `entrypoints/content/youtube/{youtube-controller,subtitle-fetcher,cue-merger,subtitle-translator,subtitle-cache,subtitle-overlay,yt-player-button}.ts`
- `utils/youtube-helpers.ts`

## 2. 기술 스택과 엔트리포인트

### 기술 스택

- WXT `0.20.13` 기반 Chrome Manifest V3 확장, TypeScript `5.7`, UI 프레임워크 없는 vanilla DOM 코드다. 빌드/개발은 WXT(Vite 계열), 테스트는 Vitest `4.0.18` + happy-dom `20.4.0`이다 (`package.json:15-39`).
- 확장 권한은 `storage`, `activeTab`; Gemini/OpenAI/Anthropic/YouTube 및 `<all_urls>` host permission을 갖는다 (`wxt.config.ts:7-20`).
- 외부 번역 SDK 없이 background service worker에서 각 공급자 HTTP API를 `fetch`로 직접 호출한다 (`utils/engines/gemini.ts:26-45`, `utils/engines/openai.ts:55-68`, `utils/engines/anthropic.ts:57-72`).

### 실제 엔트리포인트

1. **Background service worker** — `entrypoints/background.ts`
   - `defineBackground()`에서 영속 캐시 로드와 storage 마이그레이션을 시작하고 runtime message listener를 등록한다 (`entrypoints/background.ts:60-79`).
2. **일반 isolated-world content script** — `entrypoints/content.ts`
   - `<all_urls>`, `document_idle`에서 실행된다 (`entrypoints/content.ts:38-42`).
   - YouTube에서는 controller를 동적 import한 뒤에도 일반 페이지 기능을 계속 초기화한다. 다만 `SKIP_HOSTS`면 YouTube 초기화 이후 일반 페이지 경로만 조기 종료한다 (`entrypoints/content.ts:45-56`).
3. **YouTube MAIN-world bridge** — `entrypoints/youtube-bridge.content.ts`
   - `www.youtube.com`, `world: 'MAIN'`, `document_start`에서 가장 먼저 실행되어 page-owned player/fetch/XHR에 접근한다 (`entrypoints/youtube-bridge.content.ts:9-14`).
4. **Popup UI** — `entrypoints/popup/index.html` + `entrypoints/popup/main.ts`
   - WXT 디렉터리 엔트리포인트이며 엔진/키/언어/버튼/자동번역/비용/캐시 설정을 담당한다. DOMContentLoaded에서 `storage.local`을 읽는다 (`entrypoints/popup/main.ts:63-96`).

## 3. 전체 아키텍처 및 경계

```text
Popup UI
  ├─ chrome.storage.local ───────────────┐
  ├─ chrome.tabs.sendMessage ──> Content│
  └─ chrome.runtime.sendMessage ─> BG   │
                                        │
Isolated Content (일반 페이지 + YT controller)
  ├─ DOM 감지/상태 머신/주입            │
  ├─ runtime.sendMessage ───────> Background SW
  │                                  ├─ 설정/비용/캐시: storage.local
  │                                  ├─ rate limit + engine dispatch
  │                                  └─ fetch ─> Gemini/OpenAI/Anthropic
  └─ window.postMessage <──────> YouTube MAIN bridge
                                      ├─ live player response
                                      ├─ fetch/XHR timedtext intercept
                                      └─ credentialed direct fetch
```

핵심은 **DOM 소유권은 content**, **비밀키·외부 API·영속 번역 캐시·비용 집계는 background**, **YouTube page JS 접근은 MAIN bridge**, **사용자 설정은 popup/storage.local**로 분리된 구조다.

## 4. 웹페이지 번역 end-to-end 데이터 흐름

### 4.1 시작과 상태 머신

1. content script가 source-script 설정, 선택 번역 UI, FAB, 상태 머신을 초기화한다 (`entrypoints/content.ts:55-69`).
2. 번역 시작 원천은 FAB 클릭, popup toggle, auto-translate, MutationObserver다 (`entrypoints/content.ts:115-131`, `entrypoints/content.ts:198-224`, `entrypoints/content.ts:236-264`, `entrypoints/content.ts:284-289`).
3. `TranslationStateMachine`이 `idle/loading/done/error`, `startGen`, `pendingRestart`, 최근 생산적 시작 횟수를 소유한다 (`utils/translation-state.ts:40-47`). 시작 전 API 키와 30회/60초 circuit breaker를 확인하고 상태/진행률/`translationEnabled`를 갱신한다 (`utils/translation-state.ts:134-165`).
4. Observer가 이미 감지한 원본 블록 제거를 `replaced`, 일반 노드 추가를 `added`로 판정하고 500ms debounce한다 (`entrypoints/content/observer.ts:20-35`, `entrypoints/content/observer.ts:37-73`). loading 중 `added`는 현재 요청을 취소하지 않고 후속 증분 패스만 예약하며, `replaced`만 cancel한다 (`utils/translation-state.ts:88-106`).

### 4.2 텍스트 감지와 번역 단위 생성

1. `translatePage()`가 `translateGen`을 증가시키고 `detectTextBlocks()`를 호출한다 (`entrypoints/content/translator.ts:379-388`).
2. 감지는 다음 우선순위다.
   - 사이트 `translateSelectors`가 있으면 해당 selector만 처리 (`entrypoints/content/text-detector.ts:28-33`).
   - `onlyWithin` container가 실제 존재하면 그 내부에서 Phase 1+2 실행 (`entrypoints/content/text-detector.ts:35-49`).
   - 그 외 Phase 1 semantic tags + Phase 2 leaf/inline container (`entrypoints/content/text-detector.ts:53-60`).
3. Phase 1은 semantic tag를 TreeWalker로 찾고 직접 텍스트/정리된 inline HTML을 만들며 원본 요소에 `data-b3rys-id`를 찍는다 (`entrypoints/content/text-detector.ts:157-180`, `entrypoints/content/text-detector.ts:378-405`).
4. Phase 2는 `DIV/SPAN/A/BUTTON/TIME` 중 leaf 또는 순수 inline child container를 찾고 plain text를 번역 payload로 만든다 (`entrypoints/content/text-detector.ts:283-324`).
5. 감지 단계의 `BLOCK_ID`가 중복 방지용 DOM claim이다. 취소 시 번역이 착지하지 않은 claim만 해제해 재감지 가능하게 한다 (`entrypoints/content/translator.ts:280-304`).

### 4.3 캐시 선주입과 우선순위 worker pool

1. 모든 블록을 한 번에 `CACHE_LOOKUP`으로 보내고 hit를 즉시 DOM에 주입한다. lookup 실패는 전체 miss로 폴백한다 (`entrypoints/content/translator.ts:393-405`, `entrypoints/content/translator.ts:607-704`).
2. miss를 main viewport → side viewport → 나머지 거리순으로 정렬한다 (`entrypoints/content/translator.ts:408-416`, `entrypoints/content/translator.ts:557-605`).
3. 고정 배열 phase가 아니라 단일 mutable pending pool을 concurrency 6 worker가 batch 15개씩 drain한다. 스크롤 때 미dispatch 블록을 현재 viewport 거리로 180ms throttle 재정렬한다 (`entrypoints/content/translator.ts:477-555`; 상수 `utils/constants.ts:18-24`).
4. 각 batch는 loader를 넣고 `TRANSLATE_BATCH` `{id,text: block.html}`을 runtime message로 background에 보낸다 (`entrypoints/content/translator.ts:803-827`). 모든 주요 번역 DOM 변이는 실제 scroll container 기준 보정 wrapper 안에서 실행된다 (`entrypoints/content/translator.ts:235-278`, `entrypoints/content/translator.ts:808-875`).

### 4.4 Background 처리와 엔진 호출

1. background는 message에서 `paragraphs/mode/context/sourceLang/targetLang`을 `handleTranslateBatch`로 넘긴다 (`entrypoints/background.ts:79-130`).
2. 선택 엔진과 엔진별 API 키는 `storage.local`, 타겟 언어는 message override → local language pair → 기본 KO 순으로 해석한다 (`entrypoints/background.ts:238-244`, `entrypoints/background.ts:270-300`).
3. 비용 한도를 먼저 검사한다 (`entrypoints/background.ts:302-314`). 일반 mode는 paragraph별 LRU cache를 확인해 miss만 남기고, 실제 miss가 있을 때만 전역 150 API call/분 limiter를 소비한다 (`entrypoints/background.ts:333-358`).
4. `getEngine(selectedEngine)`으로 공통 `TranslationEngine.translate()` 구현을 얻어 호출한다 (`entrypoints/background.ts:360-362`, `utils/engines/index.ts:9-17`).
5. 공급자 구현은 mode에 따라 공통 prompt builder(page/subtitle/word/segment)를 선택하고, 공급자별 인증·응답·usage 형태만 어댑트한다 (`utils/engines/types.ts:13-20`, `utils/engines/gemini.ts:67-89`, `utils/engines/openai.ts:18-91`, `utils/engines/anthropic.ts:18-95`). 429/5xx와 네트워크 예외는 공통 exponential backoff retry를 탄다 (`utils/engines/llm-helpers.ts:112-140`).
6. 새 결과를 cache Map에 넣고 storage persist를 시작하며 usage를 메모리 누적 후 debounce flush한다 (`entrypoints/background.ts:364-380`, `entrypoints/background.ts:144-210`).

### 4.5 응답 주입과 토글

1. content는 batch id로 원래 `TextBlock`을 찾아 sanitizer를 거쳐 nav / sibling / forceReplace / 일반 block 경로 중 하나로 주입한다 (`entrypoints/content/translator.ts:861-875`, `entrypoints/content/translator.ts:937-952`).
2. 허용 태그/속성/CSS만 남기고 `javascript:`/`data:` href를 제거한다 (`entrypoints/content/translator.ts:1309-1384`).
3. 취소 또는 새 generation이면 오래된 응답의 DOM 주입과 상태 갱신이 차단된다 (`entrypoints/content/translator.ts:805-806`, `entrypoints/content/translator.ts:829-836`; `utils/translation-state.ts:167-178`).
4. OFF는 번역 DOM을 즉시 삭제하지 않고 body hiding class로 숨긴다. 같은 타겟 언어로 다시 ON하면 reveal-in-place하고 새 콘텐츠만 증분 감지한다 (`entrypoints/content/translator.ts:328-362`, `entrypoints/content/translator.ts:723-765`). 실제 purge는 stale hidden/language-change 경로다 (`entrypoints/content/translator.ts:767-801`).

## 5. YouTube 자막 번역 end-to-end 데이터 흐름

### 5.1 MAIN bridge 준비와 isolated-world 통신

1. MAIN bridge가 `document_start`에 원래 `fetch`와 XHR prototype을 잡아 `/api/timedtext` 성공 응답을 clone/기록 후 `window.postMessage`로 isolated world에 전달한다 (`entrypoints/youtube-bridge.content.ts:48-68`, `entrypoints/youtube-bridge.content.ts:70-102`).
2. bridge는 live `movie_player.getPlayerResponse()`를 우선하고 `ytInitialPlayerResponse`는 fallback으로만 사용한다 (`entrypoints/youtube-bridge.content.ts:17-34`).
3. isolated world는 `window.postMessage` request/response로 player response와 credentialed direct fetch를 요청한다 (`entrypoints/youtube-bridge.content.ts:36-46`, `entrypoints/youtube-bridge.content.ts:104-128`; `entrypoints/content/youtube/subtitle-fetcher.ts:367-461`).
4. b3rys 버튼 클릭 시 bridge에 `__b3rys_trigger_captions`를 보내 YouTube CC를 필요할 때 켜 timedtext 요청을 유도하고, 종료 시 b3rys가 켠 경우에만 복원한다 (`entrypoints/content/youtube/youtube-controller.ts:270-273`, `entrypoints/youtube-bridge.content.ts:130-212`).

### 5.2 트랙 선택과 자막 취득

1. controller는 player response의 `captionTracks`를 추출한다 (`entrypoints/content/youtube/subtitle-fetcher.ts:8-33`). 설정 source language의 manual track을 ASR보다 우선하며, 없으면 전체 track 중 manual 우선 fallback한다 (`entrypoints/content/youtube/subtitle-fetcher.ts:43-81`).
2. 실제 다운로드는 다음 4단계다 (`entrypoints/content/youtube/subtitle-fetcher.ts:87-160`).
   - 현재 `videoId + language/kind`와 일치하는 intercepted payload
   - 같은 video의 `pot` 포함 URL을 문자열 치환해 원하는 lang/kind로 retarget
   - YouTube가 CC를 load할 때까지 최대 5초 기다린 뒤 1·2 재시도
   - track `baseUrl`을 bridge direct fetch
3. intercepted Map은 URL에서만 `videoId/lang/kind`를 태깅하고 `tlang` 응답은 배제한다 (`entrypoints/content/youtube/subtitle-fetcher.ts:174-237`). locale exact/base와 caption kind를 rank하며 SPA 전환 시 다른 video payload를 prune한다 (`entrypoints/content/youtube/subtitle-fetcher.ts:239-272`; `entrypoints/content/youtube/youtube-controller.ts:48-55`).
4. player response의 bridge/inline-script/page-fetch 세 출처 모두 현재 `videoId` 일치를 검증한다 (`entrypoints/content/youtube/subtitle-fetcher.ts:393-445`). timedtext는 json3 우선, XML fallback으로 `SubtitleCue`로 파싱한다 (`entrypoints/content/youtube/subtitle-fetcher.ts:534-578`).

### 5.3 cue 정규화·병합·오버레이

1. 실제 받은 payload의 `isAsr`에 따라 manual은 `postProcessCues`, ASR은 `mergeCues`/`mergeCuesTwoLine`을 사용한다 (`entrypoints/content/youtube/youtube-controller.ts:289-314`).
2. ASR merge 전에 overlap 제거와 문장 경계 split을 수행하고, 문자/시간/접속사 경계 및 forced-break refiner를 적용한다 (`entrypoints/content/youtube/cue-merger.ts:448-568`). 이후 orphan 흡수, oversized split, gap-aware LEAD를 적용한다 (`entrypoints/content/youtube/cue-merger.ts:278-445`).
3. 원문 track의 base language가 target과 같으면 translation API를 건너뛰고 source-only overlay를 쓴다 (`entrypoints/content/youtube/youtube-controller.ts:283-328`).
4. 그 외 native CC를 CSS로 숨기고 `movie_player` 안에 원문/번역 overlay를 만든다 (`entrypoints/content/youtube/subtitle-overlay.ts:26-80`, `entrypoints/content/youtube/subtitle-overlay.ts:314-329`). rAF loop가 binary search로 현재 cue를 찾고 in-memory translation cache 결과 또는 `...`를 표시한다 (`entrypoints/content/youtube/subtitle-overlay.ts:146-229`, `entrypoints/content/youtube/subtitle-overlay.ts:231-259`). 현재 URL videoId가 다르면 이전 cue를 그리지 않는 안전망도 있다 (`entrypoints/content/youtube/subtitle-overlay.ts:155-180`).

### 5.4 Rolling translation과 선택적 semantic refinement

1. rolling translator는 video의 `timeupdate`, `seeked`, `play` 이벤트 기반이며 250ms throttle이다 (`entrypoints/content/youtube/subtitle-translator.ts:11-21`, `entrypoints/content/youtube/subtitle-translator.ts:124-168`).
2. 현재 시점부터 120초 ahead window를 잡고 seek 시 3 cue 뒤까지 포함한다. 미번역·비-in-flight cue 중 첫 5개를 priority micro-batch, 나머지는 최대 20개 batch로 보낸다 (`entrypoints/content/youtube/subtitle-translator.ts:46-85`; `utils/constants.ts:76-79`).
3. 직전 최대 3개 번역을 context로 붙여 `TRANSLATE_BATCH mode:'subtitle'`을 background에 보내고, 결과를 `videoId -> original -> translated` 인메모리 cache에 저장한다 (`entrypoints/content/youtube/subtitle-translator.ts:67-115`, `entrypoints/content/youtube/subtitle-cache.ts:1-26`). background의 영속 LRU도 같은 요청에 자동 적용된다.
4. ASR이고 `ytAiSubtitleEnabled !== false`면 원 cue 최대 80개씩 `mode:'segment'` 요청으로 구두점을 추가한다. segment는 background cache를 우회하지만 rate limit/비용 집계는 적용된다 (`entrypoints/content/youtube/youtube-controller.ts:150-232`, `entrypoints/content/youtube/youtube-controller.ts:342-375`; `entrypoints/background.ts:316-331`). 성공 시 overlay cue를 hot-swap하고 rolling translator를 재시작한다 (`entrypoints/content/youtube/youtube-controller.ts:352-368`).
5. target language 변경 시 현재 video의 인메모리 cache를 비우고 rolling translator만 재시작한다 (`entrypoints/content/youtube/youtube-controller.ts:70-85`).

## 6. Content / Background / Bridge 메시징

### Chrome runtime 메시지

| 방향                    | 타입                                                                  | 목적                                              | 근거                                                               |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| Content → Background    | `TRANSLATE_BATCH`                                                     | page/subtitle/word/segment 번역                   | `utils/messaging.ts:1-16`, `entrypoints/background.ts:108-130`     |
| Content → Background    | `CACHE_LOOKUP`                                                        | API·rate limit·usage 없이 페이지 cache hit 선조회 | `utils/messaging.ts:43-56`, `entrypoints/background.ts:101-105`    |
| Content → Background    | `OPEN_POPUP`                                                          | API key/비용 오류 및 onboarding                   | `utils/messaging.ts:58-60`, `entrypoints/background.ts:87-92`      |
| Popup → Background      | `CLEAR_CACHE`                                                         | 영속 LRU 제거                                     | `utils/messaging.ts:62-68`, `entrypoints/popup/main.ts:305-329`    |
| Popup → Content         | `TOGGLE_FLOATING_BUTTON`, `TOGGLE_YT_BUTTON`, `TOGGLE_AUTO_TRANSLATE` | 현재 active tab UI/동작 변경                      | `utils/messaging.ts:23-41`, `entrypoints/popup/main.ts:219-262`    |
| Popup → Content(정의됨) | `TOGGLE_TRANSLATION`, `TOGGLE_TRANSLATION_MODE`                       | 상태 머신·표시 모드 제어                          | `utils/messaging.ts:18-21,33-36`, `entrypoints/content.ts:198-208` |

메시지 type union은 Background용과 Content용으로 분리돼 있다 (`utils/messaging.ts:70-80`). 설정의 탭 간 전파는 message만이 아니라 `chrome.storage.onChanged`도 함께 쓴다 (`entrypoints/content.ts:170-196`).

### YouTube `window.postMessage` bridge

- isolated → MAIN: `__b3rys_get_player_response`, `__b3rys_fetch_request`, `__b3rys_trigger_captions`, `__b3rys_restore_captions`.
- MAIN → isolated: `__b3rys_player_response`, `__b3rys_fetch_response`, `__b3rys_timedtext_intercepted`.
- 근거: `entrypoints/youtube-bridge.content.ts:36-46,48-68,104-128,130-212`; `entrypoints/content/youtube/subtitle-fetcher.ts:328-385,448-461`.

## 7. 엔진 추상화

- 추상화 중심은 `TranslationEngine.translate(apiKey, paragraphs, mode, subtitleContext?, lang?) -> TranslateResult`다 (`utils/engines/types.ts:8-20`).
- `EngineType`은 실제로 `gemini | openai | anthropic` 세 개뿐이고 registry가 구현을 연결한다 (`utils/engines/types.ts:1-1`, `utils/engines/index.ts:9-17`).
- 공통 책임: page/subtitle/word/segment prompt 생성, numbered response parsing, retry (`utils/engines/llm-helpers.ts:12-109,112-140`).
- 공급자 adapter 책임: endpoint/auth/body/response/usage token shape (`utils/engines/gemini.ts:26-64`, `utils/engines/openai.ts:55-89`, `utils/engines/anthropic.ts:57-93`).
- 엔진 선택은 요청마다 background가 `storage.local.selectedEngine`과 해당 key를 다시 읽는다 (`entrypoints/background.ts:277-300`). 따라서 content는 공급자 구현을 모르며 engine 전환은 중앙 dispatch 경계에서 이뤄진다.

## 8. 상태·캐시·스토리지 경계

### 상태 경계

- **페이지 content 메모리**: `TranslationStateMachine`의 UI state/mode/start generation/pending restart/circuit timestamps (`utils/translation-state.ts:40-47`), translator의 DOM-injection generation (`entrypoints/content/translator.ts:17,280-304`), DOM의 `data-b3rys-id/original/translated/loader` marker (`utils/constants.ts:69-74`). 탭/frame 생명주기 경계다.
- **Background 메모리**: API call sliding window (`entrypoints/background.ts:37-58`), LRU Map (`utils/translation-cache.ts:8-9`), usage accumulator와 flush timers (`entrypoints/background.ts:153-160`). MV3 service-worker 재시작 시 메모리는 재구성되고 cache/settings는 local storage에서 복구된다.
- **YouTube content 메모리**: controller active state/AbortController/current video/cues (`entrypoints/content/youtube/youtube-controller.ts:35-46`), intercepted timedtext Map (`entrypoints/content/youtube/subtitle-fetcher.ts:174-191`), `videoId`별 번역 Map (`entrypoints/content/youtube/subtitle-cache.ts:1-8`), overlay/rAF 상태 (`entrypoints/content/youtube/subtitle-overlay.ts:13-24`). 페이지 reload 시 사라지고 SPA 내에서는 살아남는다.

### 캐시 경계

- **영속 background LRU**: `Map<string,{translatedText,timestamp}>`, TTL 7일, 최대 4000, `chrome.storage.local['b3rys_translation_cache']` 저장 (`utils/translation-cache.ts:1-20,30-69`; `utils/constants.ts:91-98`).
- **페이지 선조회**: `CACHE_LOOKUP`은 page key만 읽고 side effect가 없다 (`entrypoints/background.ts:251-268`).
- **YouTube 표시 cache**: `videoId -> original text -> translation` in-memory map이며 현재 overlay와 duplicate request 방지에 쓰인다 (`entrypoints/content/youtube/subtitle-cache.ts:1-26`, `entrypoints/content/youtube/subtitle-translator.ts:59-65`).
- **실제 background cache key**: `${targetLang}:` + (`word`일 때만 `w:`) + 원문이다 (`entrypoints/background.ts:246-249,335-369`). 즉 page와 subtitle은 mode가 달라도 같은 target+원문 key 공간을 공유하고, subtitleContext/videoId/source language/engine/model은 키에 들어가지 않는다.
- `segment` mode는 cache를 완전히 우회한다 (`entrypoints/background.ts:316-331`).

### 스토리지 경계

- 현재 설정·API 키·비용·캐시는 모두 `chrome.storage.local`이다. `utils/storage.ts`는 API 키와 selected engine을 local에서 읽고 쓴다 (`utils/storage.ts:9-44`).
- `chrome.storage.sync`는 과거 key를 local로 1회 이관한 뒤 남은 sync 데이터를 전부 지우는 마이그레이션 용도뿐이다 (`utils/storage.ts:46-97`).
- 주요 local key 범주:
  - 엔진/키: `selectedEngine`, `engineApiKeys` (`entrypoints/background.ts:277-282`)
  - 사용자 UI/동작: `translationEnabled`, `translationMode`, `floatingButtonVisible`, `ytButtonVisible`, `autoTranslate`, `ytAiSubtitleEnabled` (`entrypoints/content.ts:95-98,133-157,259-264`; `entrypoints/popup/main.ts:82-94`; `entrypoints/content/youtube/youtube-controller.ts:342-347`)
  - 언어: `b3rys_language_pair` (`utils/constants.ts:131-134`)
  - 비용: `b3rys_usage_stats`, `b3rys_cost_limit`, `b3rys_usage_ratio` (`utils/constants.ts:107-110`)
  - 번역 cache: `b3rys_translation_cache` (`utils/constants.ts:96-98`)

## 9. 기존 문서 주장과 코드 대조

| 문서 주장                                                                                                                                 | 코드 대조                                                                                                                                                                                     | 판정                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| WXT + MV3, vanilla TypeScript, Vitest + happy-dom (`CLAUDE.md:26-32`, `README.md:197-201`)                                                | package/config와 일치 (`package.json:27-39`, `wxt.config.ts:1-20`)                                                                                                                            | 일치                 |
| API 키를 `chrome.storage.sync`에 저장 (`CLAUDE.md:121-125`)                                                                               | 현재 local 저장, sync는 migration 후 clear (`utils/storage.ts:9-44,46-97`)                                                                                                                    | **불일치/구식**      |
| 번역 방향 EN→KO 고정 (`CLAUDE.md:121-124`)                                                                                                | 10개 target 정의 및 popup target 선택 (`utils/constants.ts:112-134`, `entrypoints/popup/main.ts:133-155`); source는 기본 EN이며 prompt는 target만 명시 (`utils/engines/llm-helpers.ts:12-25`) | **불일치/구식**      |
| Background→Gemini 단일 구조 (`CLAUDE.md:34-42`)                                                                                           | registry에서 3개 엔진 dispatch (`utils/engines/index.ts:9-17`)                                                                                                                                | 지나친 단순화        |
| `utils/engines`에 google-translate 포함 (`CLAUDE.md:64-68`)                                                                               | `EngineType`과 registry는 Gemini/OpenAI/Anthropic만 (`utils/engines/types.ts:1`, `utils/engines/index.ts:9-13`)                                                                               | **불일치**           |
| README LRU 최대 1000 (`README.md:43`)                                                                                                     | 최대 4000 (`utils/constants.ts:91-98`)                                                                                                                                                        | **불일치/구식**      |
| `docs/pipeline.md` circuit 15/분, background 50/분 (`docs/pipeline.md:15-18,29-34`)                                                       | 실제 30 생산적 pass/분, 150 API calls/분 (`utils/translation-state.ts:12-18,175-178`; `entrypoints/background.ts:37-58`)                                                                      | **불일치/구식**      |
| `docs/safety.md` diagram rate limiter 50/분 및 Google 엔진 (`docs/safety.md:30-52,156-176`)                                               | actual 150, Google 엔진 없음 (`entrypoints/background.ts:45-58`; `utils/engines/types.ts:1`)                                                                                                  | **부분 불일치**      |
| `docs/pipeline.md` Phase 1a→1b→2 barrier 및 viewport batch 5 병렬 (`docs/pipeline.md:256-276`)                                            | 단일 pending pool + concurrency 6 + batch 15 + scroll resort (`entrypoints/content/translator.ts:477-555`)                                                                                    | **불일치/구식**      |
| `docs/pipeline.md` F3/F4/F6 유지 (`docs/pipeline.md:112-138`)                                                                             | 실제 filter는 길이/F1/F2/F5, TABLE reject이며 제거 사실이 코드에 명시 (`entrypoints/content/text-detector.ts:134-148,283-319,463-464`)                                                        | **불일치/구식**      |
| `docs/pipeline.md` Gmail `translateSelectors [.bqe,.y2]` + `forceReplace` (`docs/pipeline.md:190-202`)                                    | 현재 Gmail은 `onlyWithin:['[role="main"]']`만 사용 (`utils/site-rules.ts:49-56`)                                                                                                              | **불일치/구식**      |
| `docs/pipeline.md` loading 중 Observer가 무조건 cancel (`docs/pipeline.md:224-247`)                                                       | `added`는 cancel 없이 pendingRestart, `replaced`만 cancel (`utils/translation-state.ts:88-106`)                                                                                               | **불일치/구식**      |
| page skill의 새 cache 선주입/단일 pool/reveal-in-place/LRU 4000 (`.claude/skills/page-translate-rules/SKILL.md:171-187`)                  | translator/background/constants와 일치                                                                                                                                                        | 대체로 최신          |
| page skill의 H1-H6/P/BLOCKQUOTE/LABEL/**LI**는 항상 block (`.claude/skills/page-translate-rules/SKILL.md:143-150`)                        | actual `alwaysBlock` regex에는 LI가 없어 nav 밖 짧은 LI도 inline 가능 (`entrypoints/content/translator.ts:1055-1064`)                                                                         | **세부 불일치**      |
| YouTube skill: 이벤트 기반, throttle 0.5초, 앞으로 10 cue (`.claude/skills/youtube-subtitle-rules/SKILL.md:77-85`)                        | actual throttle 250ms, 시간 기준 120초 window, priority 5 + batch 20 (`entrypoints/content/youtube/subtitle-translator.ts:11-13,46-85`)                                                       | **부분 불일치/구식** |
| YouTube player response·intercept videoId 검증, retarget, 실제 payload kind 기준 (`.claude/skills/youtube-subtitle-rules/SKILL.md:17-43`) | fetcher/controller 구현과 일치 (`subtitle-fetcher.ts:94-171,183-325,393-445`; `youtube-controller.ts:289-314`)                                                                                | 일치                 |
| README “원문+번역→원문→번역→끄기” (`README.md:162-167`)                                                                                   | controller의 both→en→ko→off와 일치 (`entrypoints/content/youtube/youtube-controller.ts:235-255`)                                                                                              | 일치                 |

## 10. 핵심 발견

1. **실제 아키텍처는 단일 Gemini 확장이 아니라 세 엔진을 background에서 전략 dispatch하는 MV3 구조**다. content는 DOM과 UX만 소유하고 외부 API를 직접 알지 않는다.
2. **페이지 파이프라인은 문서 일부가 묘사하는 phase barrier 구조가 아니라 cache-first + scroll-following bounded worker pool**이다. 성능/비용/스크롤 안정성 보호가 translator에 집중돼 있다.
3. **상태 보호가 두 층**이다. state-machine의 `startGen`은 stale 상태 변경을 막고 translator의 `translateGen`은 stale DOM 주입을 막는다. Observer는 `added`/`replaced`를 구분해 이미 지불한 in-flight 작업을 보존한다.
4. **YouTube는 별도 MAIN-world bridge가 필수 경계**다. player response, YouTube 자체 timedtext 요청, proof-of-origin token을 isolated content만으로 얻지 않고 `window.postMessage` RPC로 넘긴다.
5. **YouTube E2E에는 번역 이전 데이터 정제 파이프라인이 상당히 크다.** 실제 payload kind 판정 → overlap 제거 → cue merge/LEAD → overlay와 rolling translation → 선택적 LLM punctuation hot-swap 순이다.
6. **현재 영속 cache key는 문서 주석과 달리 mode 전체를 분리하지 않는다.** word만 별도 namespace이고 page/subtitle은 공유한다. engine/model/context/video/source language도 key에 없다 (`entrypoints/background.ts:246-249`).
7. **현재 storage의 단일 진실은 local**이며 CLAUDE.md의 sync 주장은 명백히 낡았다. sync는 오히려 migration 후 clear된다.
8. 문서 신뢰도는 `.claude/skills/page-translate-rules`와 YouTube의 token/video 안전 규칙이 비교적 높고, `docs/pipeline.md`, `docs/safety.md`, CLAUDE/README의 일부 수치·구조가 뒤처져 있다.

## 11. 위험/미확인

### 코드에서 확인한 위험

1. **cache 의미 충돌 위험**
   - key가 target + (`word` 여부) + 원문뿐이라 같은 문장이 page/subtitle, 다른 영상, 다른 subtitleContext, 다른 engine/model에서 동일 결과를 재사용한다 (`entrypoints/background.ts:246-249,335-369`). YouTube skill도 다른 영상의 같은 문장 context 충돌을 제한사항으로 인정한다 (`.claude/skills/youtube-subtitle-rules/SKILL.md:93-100`).
2. **source language cache 분리 부재**
   - language pair 구조와 detector/track preference에는 source가 존재하지만 cache key에는 target만 있다 (`utils/constants.ts:131-134`, `entrypoints/background.ts:246-249`). 동일 철자라도 source 언어가 다르면 충돌할 수 있다.
3. **비동기 cache persistence 순서 위험**
   - batch마다 `persistCache()`를 await하지 않는다 (`entrypoints/background.ts:364-372`). 동시 worker가 만든 여러 storage write의 완료 순서가 보장되지 않으면 오래된 snapshot이 마지막에 저장될 가능성을 별도 검증할 필요가 있다.
4. **MAIN bridge의 전역 monkey patch 취약성**
   - page `fetch`/XHR prototype을 교체하므로 YouTube 내부 변경 및 다른 monkey patch와의 상호작용에 취약하다 (`entrypoints/youtube-bridge.content.ts:48-102`). 로컬 YouTube skill도 이를 알려진 제한으로 적는다.
5. **문서 기반 유지보수 위험**
   - 임계값(50↔150), cache 크기(1000↔4000), storage(sync↔local), Gmail rule, pipeline 모델이 문서마다 달라 문서만 보고 수정하면 보호 장치/성능 설계를 되돌릴 수 있다.
6. **LI 주입 규칙의 문서-코드 차이**
   - skill은 일반 LI를 항상 block이라 하지만 코드 regex는 LI를 제외한다. 의도된 UX인지 회귀인지 테스트/결정 기록 확인이 필요하다.

### 이번 분석에서 미확인

- 실제 브라우저에서 MAIN/isolated bridge 및 YouTube timedtext token flow를 라이브 실행하지 않았다. 본 보고서는 코드와 fixture/test 구조에 근거한 정적 분석이다.
- MV3 service worker suspend/resume 중 usage debounce flush 및 fire-and-forget cache persist의 실제 유실 여부는 브라우저 통합 측정이 필요하다.
- `source` language를 popup에서 설정하는 UI는 확인되지 않았다. 저장 schema와 코드 소비 경로는 있으나 현재 사용자 노출 여부는 별도 제품 결정 확인이 필요하다.
- 전체 테스트 실행은 소스 아키텍처 분석 범위 밖이라 수행하지 않았다.

## 12. 후속 수정 포인트

1. **권위 문서 정리**
   - `CLAUDE.md`: sync→local, 고정 EN→KO→다중 target, Gemini 단일 diagram→engine registry, google-translate 제거.
   - `README.md`: cache 1000→4000.
   - `docs/pipeline.md`: 단일 priority pool/concurrency 6/cache preinject/current detector filter/current Gmail rule/current Observer 정책으로 재작성.
   - `docs/safety.md`: background 50→150, Google 엔진 제거, 보호 장치 개수·최신 상태와 동기화.
   - YouTube skill: 0.5초/10 cue→250ms/120초 window/priority 5+batch 20.
2. **cache key 정책 명문화·검토**
   - 최소한 target/source/mode namespace 의도를 결정하고, subtitle context·video·engine/model까지 분리할지 비용/품질 trade-off를 ADR로 남길 것.
   - 주석 `include target lang + mode` (`entrypoints/background.ts:335`)와 실제 key 구현을 일치시킬 것.
3. **cache persistence 직렬화 검증**
   - concurrent `persistCache()` 호출을 coalesce/debounce/serialize할 필요가 있는지 MV3 통합 테스트로 확인할 것.
4. **LI injection 규칙 확정**
   - 일반 짧은 LI가 inline이어야 하는지 block이어야 하는지 테스트와 UX 기준으로 결정한 뒤 skill 또는 코드 중 하나를 갱신할 것.
5. **문서 자동 검증 후보**
   - constants에서 rate limit/cache size/concurrency/version을 문서에 직접 복제하지 않거나, CI에서 숫자/엔진 목록/storage 정책의 drift를 검사하는 간단한 검증을 추가할 것.
