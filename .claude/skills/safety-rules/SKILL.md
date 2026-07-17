---
name: safety-rules
description: 상태 머신·보호 장치·Observer 룰. content.ts, observer.ts, background.ts 수정 시 참조.
---

# 안전 장치 룰

## 금지 사항

- Observer 콜백에서 `removeAllTranslations()` 호출 금지 → BLOCK_ID 전부 제거 → 전체 재감지 → 무한 루프. observer발 재시작(pendingRestart) 경로도 동일 — 전체 제거 없이 증분 재시작만
- `translatePage` 시작부의 `purgeAllTranslations()`는 **`HIDING_CLASS` 있을 때만** (토글 OFF 잔재 정리 전용). 무조건 purge하면 살아있는 번역+BLOCK_ID가 매 패스마다 전부 뜯겨 "증분"이 전체 재주입으로 변질 → 화면 출렁임 + breaker 오카운트 (실제 있었던 버그)
- Observer/autoTranslate 경로에서 `recentStarts` 배열 리셋 금지 → circuit breaker 무력화
- state 변경 시 `myGen !== startGen` 체크 누락 금지 → stale 결과가 상태 오염
- 새 번역 시작 시 `clearTimeout(errorTimeout)` 누락 금지 → 이전 타이머가 loading 상태 덮어씀
- `forceReplace` 경로에서 물리 교체 금지 → `markOriginalContent()` + CSS 토글만 사용 (물리 교체 시 모드 전환 불가)

## 상태 머신 (content.ts)

상태: `idle` | `loading` | `done` | `error`

| 현재    | 이벤트              | 다음      | 조건                                                                                                                   |
| ------- | ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| idle    | FAB 클릭            | loading   | API 키 존재                                                                                                            |
| idle    | autoTranslate       | loading   | translationEnabled=true                                                                                                |
| loading | 번역 완료           | done      | myGen === startGen일 때만                                                                                              |
| loading | FAB 클릭 (취소)     | idle/done | cancelTranslation() + cleanupLoaders(), hasTranslationsOnPage에 따라                                                   |
| loading | Observer `added`    | loading   | **취소 금지** — pendingRestart만 세팅, 완료 후 증분 (Gmail 등 SPA churn이 in-flight 배치·주입된 번역을 버리는 것 방지) |
| loading | Observer `replaced` | loading   | pendingRestart + cancelTranslation() — 진짜 페이지 전환, 완료 후 전체 재시작                                           |
| loading | API 에러            | error     |                                                                                                                        |
| done    | FAB 클릭            | idle      | removeAllTranslations() 실행                                                                                           |
| done    | Observer 새 콘텐츠  | loading   | 증분 번역 (BLOCK_ID 보존, removeAll 금지)                                                                              |
| error   | 3초 타이머          | idle/done | circuit breaker 에러가 아닌 경우만, state==='error' 가드                                                               |
| error   | FAB 클릭            | loading   | recentStarts.length=0 리셋 (FAB 클릭만 허용)                                                                           |

## 보호 장치 7개

| #   | 이름            | 위치                 | 임계치                    | 발동 시 동작                                                                                                                                                                                                                                                                          |
| --- | --------------- | -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Circuit Breaker | translation-state.ts | 15회 시작/분              | state='error' + translationEnabled=false + FAB 클릭으로만 리셋. **생산적 패스만 카운트** — `translatePage`가 `'empty'`(새 블록 0개) 반환 시 `recentStarts.push` 생략. 동적 페이지(Gmail churn)에서 번역할 게 없는데 터지는 것 방지. push는 `translatePage` 완료 후 결과 기준으로 실행 |
| 2   | Rate Limiter    | background.ts        | 150 API콜/분              | 에러 응답 반환, 1분 후 자동 해제. 캐시 hit 제외. content와 완전 독립. 전역(모든 탭+YouTube rolling 공유)이라 정상 대량 사용 위로 설정                                                                                                                                                 |
| 3   | startGen        | content.ts           | generation counter        | myGen !== startGen → 상태 변경 없이 return                                                                                                                                                                                                                                            |
| 4   | translateGen    | translator.ts        | generation counter        | cancelTranslation() → translateGen++ → 이전 배치 DOM 주입 차단                                                                                                                                                                                                                        |
| 5   | errorTimeout    | content.ts           | 3초 타이머 가드           | startTranslation() 시 clearTimeout + 콜백 내 state!=='error' 가드                                                                                                                                                                                                                     |
| 6   | isB3rysElement  | observer.ts          | 패턴 매칭                 | data-b3rys-_ 속성 또는 b3rys-_ 클래스 → 무시 (자체 DOM 변경 필터)                                                                                                                                                                                                                     |
| 7   | Fight Guard     | fight-guard.ts       | 같은 텍스트 3회 주입/90초 | 앱(Gmail 등)이 자기 DOM을 재렌더해 번역을 되돌리는 "소유권 싸움" 감지 → 해당 블록 세션 동안 양보(재번역 중단). 감지는 텍스트 키 기반(요소는 재렌더마다 죽음)                                                                                                                          |

## Observer 콜백 규칙 (observer.ts → content.ts)

Observer는 변경의 **종류**를 판정해 전달한다 (`ContentChangeKind`):

- `added` — 콘텐츠 추가만, 감지된 블록(BLOCK_ID) 무손실
- `replaced` — 감지된 블록이 제거됨 = 진짜 콘텐츠 교체/SPA 전환 (한 debounce 창에서 replaced가 added에 우선)
- 판정 시 자체 정리(TRANSLATED/LOADER 노드 제거)는 replaced로 오인 금지 — BLOCK_ID는 사이트 원본 요소에만 붙음

상태머신 정책:

- `state === 'done'` → `startTranslation()` (증분, BLOCK_ID 보존)
- `state === 'loading'` + `added` → **pendingRestart만** (취소 금지 — in-flight 배치 보존, 완료 후 증분)
- `state === 'loading'` + `replaced` → `pendingRestart = true` + `cancelTranslation()`
- 그 외 → 무시

## 스크롤 drift 보정 (translator.ts)

- **모든 번역 관련 DOM 변이(로더 추가/제거, 주입, 에러 표시, 숨김 토글)는 `withScrollCompensation(scroller, mutate)`로 감싼다** — 무보정 변이가 viewport 위에서 일어나면 스크롤 움찔거림의 직접 원인
- scroller는 **변이 대상(배치 요소)에서** `getScrollContainer()`로 도출 — Gmail처럼 내부 div가 스크롤하는 앱 대응. `window.scrollBy` 직접 호출 금지
- 앵커는 `findContentAnchor(scroller)` — **스크롤러 rect 내부** 좌표를 여러 깊이(60/140/240/360px)로 탐침하고 `scroller.contains(el)` 검증. ⚠️ 창 좌표 (중앙, y=100) 고정 탐침 금지 — Gmail의 fixed 툴바에 얹혀 drift가 항상 0으로 측정되어 보정이 죽는다 (실제 있었던 버그)
- 콘텐츠 스크립트 시작 시 `BUILD_TAG` 로그 — 리빌드 후 확장 리로드+페이지 새로고침 안 된 stale 번들 판별용

## state 변경 전 체크리스트

1. `myGen === startGen`인가? (아니면 stale 결과 → return)
2. `clearTimeout(errorTimeout)` 했는가? (새 번역 시작 시)
3. `recentStarts.length < CIRCUIT_MAX`인가? (걸렸으면 번역 불가)
4. `translationEnabled` 값이 circuit breaker에 의해 false가 아닌가?

## 변경 체크리스트

**새 보호 장치 추가:**
| # | 할 일 |
|---|-------|
| 1 | 기존 보호 장치(generation counter, circuit breaker 등)와 충돌 확인 |
| 2 | DOM 변경 시 isB3rysElement() 필터 통과 여부 확인 (Observer 루프 방지) |
| 3 | 수동 복구 경로 존재 확인 (FAB 클릭으로 리셋 가능해야 함) |
| 4 | 이 스킬 파일의 보호 장치 테이블에 행 추가 |
| 5 | `docs/safety.md`에 다이어그램/시나리오 추가 (사람용) |

**상태 전이 변경:**
| # | 할 일 |
|---|-------|
| 1 | 이 스킬 파일의 상태 전이 테이블 업데이트 |
| 2 | `docs/safety.md`의 상태 전이도 업데이트 (사람용) |
