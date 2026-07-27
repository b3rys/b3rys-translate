# b3rys-translate Harness 종합 분석

- 기준일: 2026-07-27 KST
- 저장소: `b3rys/b3rys-translate`
- 로컬 경로: `/Users/gd452/Development/b3rys-translate`
- 기준 SHA: `db0a10e872280e41d7cd0b2600111ec8869d8756`
- Harness: limited, 3 agents, 코드 구조 / 당일 PR / QA 분리
- Owner 검증: GitHub diff 교차검증, 적대 테스트, clean bootstrap 재현, 전체 test/lint/typecheck/build, npm audit

## 1. 결론 요약

이 프로젝트는 WXT 0.20.13 기반 Chrome Manifest V3 확장으로, 일반 웹페이지 번역과 YouTube 이중자막 번역을 한 확장 안에서 제공한다. DOM/UI는 isolated content script, API 키·번역 엔진·영속 캐시는 background service worker, YouTube page-owned API와 timedtext 네트워크 접근은 MAIN-world bridge가 담당한다.

현재 main은 전체 305개 테스트, typecheck, lint(경고 8), production build를 통과한다. 다만 clean checkout에서 `npm ci → test`를 바로 실행하면 `.wxt/tsconfig.json` 부재로 테스트가 시작되지 않는 bootstrap 결함이 재현됐다.

오늘 KST 기준 merge된 PR은 #17과 #18 두 건이며 모두 YouTube 자막 안정화 변경이다. 구현 방향은 타당하지만 locale/kind 랭킹과 `pot` 토큰 대기 orchestration에 실제 회귀 위험 및 테스트 공백이 있다.

## 2. 아키텍처

### 실행 경계

- `entrypoints/background.ts`: MV3 service worker, 엔진 dispatch, rate limit, 비용, 영속 LRU cache
- `entrypoints/content.ts`: 일반 페이지 번역, 상태 머신, observer, DOM 감지·주입
- `entrypoints/youtube-bridge.content.ts`: YouTube MAIN world, live player response, fetch/XHR timedtext intercept, credentialed fetch
- `entrypoints/content/youtube/*`: 트랙 선택, 자막 취득, cue 병합, overlay, rolling translation
- `entrypoints/popup/*`: 엔진/API 키/언어/UI 설정

### 일반 웹페이지 번역 흐름

1. DOM 텍스트 블록 감지
2. background cache 선조회 및 hit 즉시 주입
3. viewport 우선순위 pending pool을 concurrency 6, batch 15로 처리
4. `TRANSLATE_BATCH` 메시지를 background로 전송
5. Gemini/OpenAI/Anthropic 공통 인터페이스로 dispatch
6. sanitizer 후 DOM 주입
7. generation/state guard로 stale 응답 차단

### YouTube 자막 흐름

1. MAIN bridge가 live `getPlayerResponse()` 및 timedtext 요청을 관찰
2. manual 우선, ASR fallback으로 source track 선택
3. 원하는 payload intercept → 같은 영상 token URL retarget → 아무 자막 도착 대기 후 재시도 → baseUrl 직접 fetch
4. 실제 payload의 `isAsr` 기준으로 cue 후처리
5. native CC를 숨기고 원문+번역 overlay 표시
6. 재생 위치 기준 120초 ahead rolling translation, priority 5 + batch 20
7. 선택적으로 ASR semantic refinement 수행

### 엔진·스토리지

- 엔진: Gemini, OpenAI, Anthropic 3종
- 설정/API 키/비용/cache: `chrome.storage.local`
- `storage.sync`: 과거 데이터 migration 후 제거하는 용도
- 영속 cache: TTL 7일, 최대 4000개
- cache key는 사실상 target language + word 여부 + 원문이며 page/subtitle, source language, 영상, context, engine/model을 분리하지 않는다.

## 3. 오늘 merge PR

### #17 — 자막 종류·locale 매칭 정밀화 + SPA 잔여 누수 정리

- merge: 2026-07-27 00:48:19 KST
- merge SHA: `c7f77d39012957f694e77989cdff19bca9ba0f05`
- 12 files, +298/-58
- GitHub Actions check: success

주요 변경:

- 요청 track이 아니라 실제 payload의 kind로 ASR/manual 판정
- intercepted payload를 videoId/lang/kind로 기록·랭킹
- `v=` 없는 timedtext URL을 현재 영상으로 오태깅하지 않음
- 언어 변경, rolling translation abort, notice, CC timer의 SPA 잔여 상태 정리
- player response 회귀 테스트 추가

Owner 확인 위험:

1. `zh-Hant` exact payload가 없고 `zh-Hans`만 있으면 base-language fallback으로 `zh-Hans`를 반환한다. 문서의 “zh-Hant↔zh-Hans 금지”를 완전히 보장하지 않는다.
2. 점수식상 same-kind base locale이 exact-locale other-kind보다 우선한다. 코드 주석의 “locale exact 우선”과 다르다.
3. 기존 테스트는 exact와 base가 모두 있을 때 exact가 이기는 경우만 검사해 위 두 동작을 잡지 못한다.

Owner가 임시 Vitest 2개로 현재 동작을 직접 재현했으며 테스트는 통과했다. 임시 파일은 삭제했다.

### #18 — `pot` 토큰 게이팅 대응

- merge: 2026-07-27 08:50:44 KST
- merge SHA: `db0a10e872280e41d7cd0b2600111ec8869d8756`
- 5 files, +183/-36
- GitHub Actions check: success

주요 변경:

- 같은 video의 intercepted timedtext URL에서 `lang`/`kind`만 교체해 `pot` 토큰을 차용
- signed parameters를 재인코딩하지 않고 문자열 치환
- 아무 언어 자막 도착을 기다린 뒤 intercept/retarget 전략 재시도
- MAIN bridge에서 live `movie_player.getPlayerResponse()` 우선

위험과 테스트 공백:

1. 추가 테스트 3개는 URL 문자열 변환만 검증한다. “도착 전 검사 → 아무 언어 payload 대기 → 재시도 → bridgeFetch” orchestration은 테스트하지 않는다.
2. `waitForAnyInterception()`은 `pot`가 없는 같은-video payload에도 즉시 true가 된다. 이 경우 유효 token payload를 기다리지 않고 baseUrl fallback으로 진행할 수 있다.
3. `tokenizedUrlFor()`는 최신 token URL 하나만 사용하고 다른 후보를 순회하지 않는다.
4. URL 조작 helper는 현재 timedtext query shape에 의존한다.
5. live `readPlayerResponse()` 자체를 실제 bridge 코드로 실행하는 테스트가 없다.

## 4. 실행 검증

### Owner 재실행

- Node: v26.5.0
- npm: 11.17.0
- `CI=1 npm run test -- --run`: 23 files, **305/305 pass**
- `npm run lint`: exit 0, **0 errors / 8 warnings**
- `npm run typecheck`: pass
- `npm run build`: pass, Chrome MV3, **143.47 kB**
- `npm audit --json`: moderate 4 / high 17 / critical 4 / total 25

### clean checkout bootstrap 결함

`.wxt`를 임시로 치운 상태에서 테스트를 실행해 다음 실패를 재현했다.

- `tsconfig.json`이 gitignored `./.wxt/tsconfig.json`을 extends
- `prepare`는 `husky`만 실행하고 `wxt prepare`를 실행하지 않음
- custom reporter 로딩 단계에서 `TSConfckParseError`
- build가 `.wxt`를 생성한 뒤에는 전체 테스트 통과

따라서 현재 CLAUDE.md의 필수 순서인 `test → lint → build`는 fresh clone에서 성립하지 않는다.

## 5. 우선순위 권고

### P0 — 회귀 방어

1. locale 정책 확정
   - script-sensitive language(`zh-Hant/Hans`, `sr-Latn/Cyrl`)는 base fallback 금지 여부 결정
   - exact locale와 same-kind 중 우선순위를 명시하고 테스트 추가
2. `pot` orchestration 테스트
   - token payload가 늦게 도착하는 경우
   - token 없는 payload가 먼저 도착하는 경우
   - retarget 실패 후 다른 token URL 후보 순회
   - timeout 및 baseUrl fallback
3. clean bootstrap 수정
   - `prepare`에 `wxt prepare` 추가 또는 test script가 필요한 generated config를 먼저 생성
   - CI에서 fresh checkout `npm ci → npm test` gate 추가

### P1 — 품질·보안

1. page/subtitle/source/engine/model 간 cache namespace 정책 결정
2. MAIN bridge request의 source/payload/requestId/URL 검증
3. background, provider adapter, runtime message contract 테스트 추가
4. npm audit 25건의 실제 bundle/개발환경 도달성 평가 후 의존성 업데이트
5. `<all_urls>`와 중복 host/activeTab 권한 최소화 검토

### P2 — 문서 정합성

- CLAUDE.md: storage.local, 다중 target, 3-engine registry로 갱신
- README: cache 1000 → 4000
- docs/pipeline.md: 현재 cache-first mutable pool, concurrency 6, batch 15 반영
- docs/safety.md: rate limit 150 및 현재 엔진 목록 반영
- YouTube skill: 0.5초/10 cue → 250ms/120초, priority 5 + batch 20

## 6. Herm 룰·스킬 초기 로딩 개선안

### 원인

Hermes project context의 `AGENTS.md`는 현재 작업 디렉터리(CWD) 기준으로 로딩된다. 이번 Telegram 세션 CWD는 `/Users/gd452`였고 Herm 룰은 `/Users/gd452/b3os/members/herm/AGENTS.md`에 있어 자동 주입되지 않았다. 반면 `SOUL.md`는 Hermes 프로필에서 해당 Herm 폴더로 symlink되어 로딩됐다.

### 권장 순서

1. Herm 프로필의 기본 CWD를 `/Users/gd452/b3os/members/herm`으로 고정한다.
2. gateway/session을 재시작해 `AGENTS.md`가 startup context에 실제 표시되는지 확인한다.
3. `AGENTS.md`의 bootstrap 첫 부분에 다음 source chain을 짧게 명시한다.
   - runtime rule: `~/b3os/members/herm/AGENTS.md`
   - catalog: `~/b3rys-team-os/docs/B3OS_SKILLS.md`
   - canonical skill: `~/b3rys-team-os/skills/<name>/SKILL.md`
4. `b3os-*`, team, harness 요청이 감지되면 global Hermes/Claude skill보다 팀 catalog를 먼저 확인하도록 명시한다.
5. 로딩 로그 또는 첫 실행 보고에 `rule_source`, `catalog_source`, `skill_source`를 출력한다.
6. canonical skill이 없을 때만 global fallback을 허용하고 fallback 사실을 알린다.

### 설정 후보

```bash
hermes config set terminal.cwd /Users/gd452/b3os/members/herm
```

설정 후 Hermes gateway를 재시작하고 새 세션에서 project context source를 확인해야 한다. 만약 gateway process CWD가 별도로 고정돼 있다면 launch wrapper 또는 LaunchAgent의 WorkingDirectory도 같은 경로로 맞춘다.

`~/AGENTS.md`에 symlink를 두는 방식은 모든 홈 디렉터리 작업에 팀 규칙이 섞일 수 있으므로 권장하지 않는다. 운영 규칙을 `SOUL.md`에 복제하는 것도 identity와 workflow를 섞고 정본 drift를 만들기 때문에 피하는 편이 낫다.

## 7. 산출물

- `01_architecture.md`: 코드 구조와 E2E 흐름
- `02_today_pr.md`: 오늘 merge PR 및 diff 검증
- `03_qa.md`: 빌드·테스트·정적 품질
- `04_owner_synthesis.md`: owner 반증 검증과 최종 우선순위

코드·설정·lockfile·tracked 파일은 수정하지 않았다. `_workspace/harness-analysis/*.md`만 untracked 분석 산출물이다.
