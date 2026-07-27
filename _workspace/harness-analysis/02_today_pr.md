# 2026-07-27 KST 당일 merge PR 분석 — `b3rys/b3rys-translate`

- 조사 시각: **2026-07-27 14:25~14:27 KST**
- 적용 경계: **2026-07-27 00:00:00 KST (`2026-07-26T15:00:00Z`) ~ 조사 시점**
- 조사 방식: GitHub closed PR API 전체(17건)에서 `merged_at`을 UTC 절대시각으로 필터링하고, 후보 검색 결과·PR/파일/커밋 API·`gh pr diff`를 로컬 `main` 이력 및 `git diff <base> <merge>`와 교차검증했다.
- 저장소 상태: 로컬 `main`, 로컬 `origin/main`, GitHub `main`이 모두 `db0a10e872280e41d7cd0b2600111ec8869d8756`으로 일치했다. 작업 시작 시 working tree는 clean이었다.

## 결론

오늘 KST 경계 안에서 merge된 PR은 **2건: #17, #18**이다.

검색 후보에는 #15와 #16도 포함됐지만 실제 `merged_at`은 각각 **2026-07-26 23:20:53 KST**, **23:33:18 KST**라 오늘 목록에서 제외했다. #17은 **00:48:19 KST**, #18은 **08:50:44 KST**로 경계 안이다.

## 오늘 merge PR 목록

|                                                    번호 | 제목                                                    | 작성자  | merge KST           | URL                                              |
| ------------------------------------------------------: | ------------------------------------------------------- | ------- | ------------------- | ------------------------------------------------ |
| [#17](https://github.com/b3rys/b3rys-translate/pull/17) | fix: 자막 종류·locale 매칭 정밀화 + SPA 잔여 누수 정리  | `gd452` | 2026-07-27 00:48:19 | https://github.com/b3rys/b3rys-translate/pull/17 |
| [#18](https://github.com/b3rys/b3rys-translate/pull/18) | fix: pot 토큰 게이팅으로 이중자막이 아예 안 나오던 버그 | `gd452` | 2026-07-27 08:50:44 | https://github.com/b3rys/b3rys-translate/pull/18 |

---

## PR #17 — 자막 종류·locale 매칭 정밀화 + SPA 잔여 누수 정리

### 메타데이터와 merge commit 대조

- GitHub PR head: `c3cdefe45838eab35d277a7ed324a65246821cb1` (PR 커밋 1개)
- GitHub merge commit / 로컬 `main` 커밋: `c7f77d39012957f694e77989cdff19bca9ba0f05`
- 부모: `5e8a8a380ca4a51edf9c16946fd945d42d70ed59` 단일 부모
- 방식: **squash merge**. PR head와 merge commit의 tree가 모두 `18378801f09a4768ade6b41400c8e1e1f313857b`로 동일하다.
- API 집계와 로컬 diff: **12 files, +298/-58**, 완전 일치.
- `gh pr diff`와 `git diff 5e8a8a3 c7f77d3`의 SHA-256이 모두 `03081e56d66b68446bf9845cf593757ed4902c41c98e837a0b8195b01068d637`로 byte-for-byte 일치했다.
- GitHub Actions `check`: **pass** (1m33s).

### 변경 파일

| 파일                                                 | 상태 |    증감 | 실제 핵심 변경                                                                                          |
| ---------------------------------------------------- | ---- | ------: | ------------------------------------------------------------------------------------------------------- |
| `.claude/skills/youtube-subtitle-rules/SKILL.md`     | 수정 |  +12/-1 | player response의 videoId 검증, kind/locale 매칭 불변식 문서화                                          |
| `TODO.md`                                            | 수정 |   +1/-0 | 완료 항목 기록                                                                                          |
| `entrypoints/content/youtube/subtitle-cache.ts`      | 수정 |   +3/-1 | 캐시 수명 주석을 실제 동작에 맞게 정정                                                                  |
| `entrypoints/content/youtube/subtitle-fetcher.ts`    | 수정 | +93/-35 | 다운로드 반환형에 `isAsr` 추가, 인터셉트 항목에 `kind` 저장, video/lang/kind 랭킹, 무-videoId 항목 거부 |
| `entrypoints/content/youtube/subtitle-overlay.ts`    | 수정 |   +2/-0 | stop 시 잔존 notice 제거                                                                                |
| `entrypoints/content/youtube/subtitle-translator.ts` | 수정 |   +4/-0 | storage await 뒤 abort 재검사로 리스너 누수 차단                                                        |
| `entrypoints/content/youtube/youtube-controller.ts`  | 수정 |   +8/-3 | 언어 변경 시 현재 videoId 재검증, 실제 payload의 `isAsr`로 병합 결정                                    |
| `entrypoints/youtube-bridge.content.ts`              | 수정 |  +12/-1 | 지연 중인 CC toggle 타이머 추적·취소                                                                    |
| `tests/.DS_Store`                                    | 삭제 |  binary | 불필요한 macOS 메타파일 추적 해제                                                                       |
| `tests/youtube-intercept-cache.test.ts`              | 수정 | +56/-13 | videoId/kind/locale/무태그/tlang/최신 payload 회귀 테스트 보강                                          |
| `tests/youtube-mode-sync.test.ts`                    | 수정 |   +7/-4 | 새 `{ cues, isAsr }` 반환 계약 반영                                                                     |
| `tests/youtube-player-response.test.ts`              | 추가 | +100/-0 | stale bridge/script 거부 및 현재 영상 응답 사용 테스트 3개                                              |

### 핵심 diff와 기능 영향

1. **실제 받은 자막 종류를 기준으로 후처리**
   - `downloadSubtitles()`가 `SubtitleCue[]` 대신 `{ cues, isAsr }`를 반환한다.
   - 요청한 `track.kind`가 아니라 인터셉트 payload URL의 `kind`로 ASR/manual을 판정한다.
   - manual을 요청했지만 ASR payload가 잡힌 경우에도 ASR 병합·문장부호 보정을 적용하므로 2~3단어 조각 자막 노출을 줄인다.

2. **인터셉트 캐시 매칭 정밀화**
   - 항목에 `videoId`, `lang`, `kind`, `text`를 기록하고, 현재 videoId가 없거나 일치하지 않으면 사용하지 않는다.
   - exact locale/base locale 및 same-kind/other-kind를 점수화해 최선 항목을 선택하며, 동점이면 최신 payload가 이긴다.
   - `tlang` 자동번역 응답은 계속 제외한다.
   - URL에 `v=`가 없을 때 현재 페이지 videoId를 임의로 붙이던 폴백을 삭제해 prefetch payload 오태깅을 차단한다.

3. **SPA 전환 잔여 상태 정리**
   - 언어 변경 이벤트가 떠난 영상의 번역을 재시작하지 않게 현재 videoId를 확인한다.
   - 비동기 storage 조회 중 abort된 rolling translation이 video 리스너를 뒤늦게 붙이지 않도록 재검사한다.
   - overlay stop 때 notice를 제거하고, restore 때 예약된 CC toggle을 취소한다.

### 회귀 위험 / 검토 소견

- **중요: locale 오매칭이 완전히 차단된 것은 아니다.** `rankTrack()`은 base-language fallback을 여전히 허용한다. `zh-Hant` 요청 시 `zh-Hans`만 캐시에 있으면 그대로 선택된다. 추가된 테스트도 Hant/Hans가 **둘 다 있을 때 exact가 이기는 경우만** 검증한다. PR 설명의 “zh-Hant↔zh-Hans 오매칭 차단”을 일반적으로 보장하지 않는다.
- **랭킹 우선순위가 주석과 다를 수 있다.** 점수는 same-kind base locale(1)이 exact locale other-kind(2)보다 우선한다. 코드 주석의 “Locale-exact beats base-language”와 불일치하며, 스크립트/지역 변형 정확성과 ASR/manual 후처리 중 무엇을 우선할지 명시적 결정과 테스트가 필요하다.
- other-kind payload도 사용하도록 한 것은 가용성에는 유리하지만, manual/ASR의 cue 의미 차이를 `kind` 한 값으로만 보정하므로 새로운 YouTube kind 값 또는 URL에 kind가 누락된 ASR 응답에는 취약할 수 있다.
- notice 제거는 첫 번째 `.b3rys-yt-notice`만 제거한다. 중복 notice가 생길 수 있는 호출 구조라면 잔존 가능성이 있다.

---

## PR #18 — `pot` 토큰 게이팅 대응

### 메타데이터와 merge commit 대조

- GitHub PR head: `c35bccf83d670a0c3415c291b77dc19c6b9f4d56` (PR 커밋 2개)
  1. `bd09a8b71e834c16c0cb1b5441095cd6a9b70da7` — 토큰 차용 도입
  2. `c35bccf83d670a0c3415c291b77dc19c6b9f4d56` — 자막 도착 후 재시도하도록 순서 수정
- GitHub merge commit / 로컬 `main` HEAD: `db0a10e872280e41d7cd0b2600111ec8869d8756`
- 부모: `c7f77d39012957f694e77989cdff19bca9ba0f05` 단일 부모
- 방식: **2개 PR 커밋을 1개로 squash merge**. PR head와 merge commit의 tree가 모두 `d6098a19349b7583ac0de7d063e208c658c8829f`로 동일하다.
- API 집계와 로컬 diff: **5 files, +183/-36**, 완전 일치.
- `gh pr diff`와 `git diff c7f77d3 db0a10e`의 SHA-256이 모두 `910f8c04a968fdbf8b3d55767ed3c187ff4bf7d79e3cfee3affeeda530106f65`로 byte-for-byte 일치했다.
- GitHub Actions `check`: **pass** (1m33s).

### 변경 파일

| 파일                                              | 상태 |     증감 | 실제 핵심 변경                                                                     |
| ------------------------------------------------- | ---- | -------: | ---------------------------------------------------------------------------------- |
| `.claude/skills/youtube-subtitle-rules/SKILL.md`  | 수정 |   +14/-3 | 4단계 다운로드, `pot`, URL 서명 보존, live player response 규칙 문서화             |
| `TODO.md`                                         | 수정 |    +1/-0 | 완료 항목 기록                                                                     |
| `entrypoints/content/youtube/subtitle-fetcher.ts` | 수정 | +106/-32 | 토큰 URL 재타게팅 전략, 아무 언어 인터셉트 대기, 전략 재시도, URL 문자열 치환 구현 |
| `entrypoints/youtube-bridge.content.ts`           | 수정 |   +20/-1 | `movie_player.getPlayerResponse()` 우선, `ytInitialPlayerResponse` fallback        |
| `tests/youtube-intercept-cache.test.ts`           | 수정 |   +42/-0 | lang/kind/fmt/tlang 변경 및 signed parameter byte 보존 테스트 3개                  |

### 핵심 diff와 기능 영향

1. **토큰화된 timedtext URL 재타게팅**
   - 같은 videoId의 인터셉트 URL 중 `pot=`가 있는 최신 URL을 찾는다.
   - URL 전체를 파싱·재직렬화하지 않고 문자열 치환으로 `lang`, `kind`, `fmt=json3`를 바꾸고 `tlang`을 제거한다.
   - `sparams`, `signature`, `pot` 등의 인코딩된 바이트는 그대로 보존한다.
   - 공식 한국어 자막 때문에 YouTube가 `ko`만 요청한 영상에서도 그 영상의 토큰을 빌려 `en` 자막을 재요청할 수 있게 된다.

2. **실제 비동기 순서에 맞춘 4단계 전략**
   - 원하는 트랙의 기존 인터셉트 확인 → 다른 트랙의 토큰 URL 재타게팅 → 이 영상의 **아무 언어 자막** 도착을 최대 5초 대기 후 앞 전략 재시도 → baseUrl 직접 fetch 순서다.
   - `triedUrls`로 동일 재타게팅 URL 중복 요청을 막는다.
   - 두 번째 PR 커밋이 첫 구현의 “토큰 URL이 도착하기 전에 검사해 재타게팅이 실행되지 않음” 문제를 바로잡은 것이 실제 squash commit에도 포함되어 있다.

3. **live player response 우선**
   - MAIN-world bridge가 `movie_player.getPlayerResponse()`를 먼저 호출하고, 실패/부재 시에만 stale 가능성이 있는 `ytInitialPlayerResponse`를 사용한다.
   - 이후 fetcher 측의 videoId 검증과 결합해 SPA 전환 후 이전 영상 트랙 사용 가능성을 낮춘다.

### 회귀 위험 / 검토 소견

- **핵심 orchestration 테스트 공백:** 추가된 3개 테스트는 `retargetTimedtextUrl()`의 문자열 변환만 확인한다. 이번 PR의 두 번째 커밋에서 실제로 고친 “자막 도착 전 검사 → 아무 언어 payload 대기 → 재시도” 흐름, `bridgeFetch` 호출, `triedUrls`, timeout/fallback은 테스트하지 않는다. 실사용 핵심 경로에 비해 자동 회귀 방어가 약하다.
- `waitForAnyInterception()`은 같은 videoId payload의 존재만 보고 즉시 성공하며 `pot` 보유 여부를 확인하지 않는다. 원하는 트랙도 아니고 토큰도 없는 payload가 캐시에 있으면 5초 동안 유효 토큰 URL을 기다리지 않고 곧바로 baseUrl fallback으로 진행할 수 있다.
- `tokenizedUrlFor()`는 같은 영상의 최신 `pot` URL 하나만 사용한다. 토큰 만료, 클라이언트/세션 차이, 첫 URL만 실패하는 경우 다른 토큰 URL을 순회하지 않는다.
- URL 조작 헬퍼는 timedtext URL의 현재 형태를 전제한다. `setParam()`은 파라미터가 없으면 항상 `&key=`를 붙이고, `dropParam()`은 선두 `?key=`를 지우지 않는다. 현재 YouTube URL에서는 성립할 가능성이 높지만 URL shape 변경 시 깨질 수 있다.
- live `getPlayerResponse()` 우선 동작 자체는 이 PR에서 실제 bridge content script를 대상으로 새로 테스트되지 않았다. 기존 fetcher 레벨 player-response 테스트는 bridge 응답을 stub할 뿐 `readPlayerResponse()` 구현을 실행하지 않는다.
- 토큰이 영상별이라는 가정과 실제 200/바이트 수치는 PR 본문·merge commit 메시지에 기록된 라이브 관측이며, 이번 읽기 전용 분석에서는 YouTube 네트워크를 재현하지 않았다.

---

## 종합 기능 영향

- 오늘 두 PR은 모두 YouTube 이중자막 파이프라인의 안정화다.
- #17은 **잘못된 영상/locale/kind payload 선택과 SPA 잔여 상태**를 줄이고, 실제 payload 종류에 맞게 cue 후처리를 한다.
- #18은 YouTube의 `pot` 게이팅 때문에 baseUrl 직접 fetch가 빈 본문을 반환하는 환경에서 **같은 영상의 토큰화된 다른 언어 요청을 재사용**해 영어 원문 자막 확보 경로를 추가한다.
- 로컬 `main`에는 두 PR이 순서대로 반영됐고, GitHub API의 merge SHA·tree·파일 증감 및 GitHub diff가 로컬 history/diff와 일치한다.

## 미확인 / 제한

1. 읽기 전용 조건에 따라 코드를 checkout·수정하지 않았고, 로컬 테스트/빌드도 새로 실행하지 않았다. 확인 가능한 사실은 두 PR의 GitHub Actions `check`가 각각 pass했다는 점이다. PR 설명의 “302/305 passed” 숫자를 독립 재실행으로 검증하지는 않았다.
2. `pot` 토큰의 실제 유효성, 언어 간 재사용, 200/0-byte 및 52,460/103,696-byte 관측은 라이브 YouTube 요청을 재현하지 않아 미확인이다.
3. 조사 컷오프 이후(2026-07-27 14:27 KST 이후) 당일 추가 merge가 발생하면 이 보고서에는 포함되지 않는다.
