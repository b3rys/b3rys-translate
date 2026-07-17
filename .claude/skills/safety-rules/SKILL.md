---
name: safety-rules
description: 상태 머신·보호 장치·Observer 룰. content.ts, observer.ts, background.ts 수정 시 참조.
---

# 안전 장치 룰

## 금지 사항

- Observer 콜백에서 `removeAllTranslations()` 호출 금지 → BLOCK_ID 전부 제거 → 전체 재감지 → 무한 루프
- Observer/autoTranslate 경로에서 `recentStarts` 배열 리셋 금지 → circuit breaker 무력화
- state 변경 시 `myGen !== startGen` 체크 누락 금지 → stale 결과가 상태 오염
- 새 번역 시작 시 `clearTimeout(errorTimeout)` 누락 금지 → 이전 타이머가 loading 상태 덮어씀
- `forceReplace` 경로에서 물리 교체 금지 → `markOriginalContent()` + CSS 토글만 사용 (물리 교체 시 모드 전환 불가)

## 상태 머신 (content.ts)

상태: `idle` | `loading` | `done` | `error`

| 현재    | 이벤트             | 다음      | 조건                                                                 |
| ------- | ------------------ | --------- | -------------------------------------------------------------------- |
| idle    | FAB 클릭           | loading   | API 키 존재                                                          |
| idle    | autoTranslate      | loading   | translationEnabled=true                                              |
| loading | 번역 완료          | done      | myGen === startGen일 때만                                            |
| loading | FAB 클릭 (취소)    | idle/done | cancelTranslation() + cleanupLoaders(), hasTranslationsOnPage에 따라 |
| loading | API 에러           | error     |                                                                      |
| done    | FAB 클릭           | idle      | removeAllTranslations() 실행                                         |
| done    | Observer 새 콘텐츠 | loading   | 증분 번역 (BLOCK_ID 보존, removeAll 금지)                            |
| error   | 3초 타이머         | idle/done | circuit breaker 에러가 아닌 경우만, state==='error' 가드             |
| error   | FAB 클릭           | loading   | recentStarts.length=0 리셋 (FAB 클릭만 허용)                         |

## 보호 장치 6개

| #   | 이름            | 위치          | 임계치             | 발동 시 동작                                                         |
| --- | --------------- | ------------- | ------------------ | -------------------------------------------------------------------- |
| 1   | Circuit Breaker | content.ts    | 15회 시작/분       | state='error' + translationEnabled=false + FAB 클릭으로만 리셋       |
| 2   | Rate Limiter    | background.ts | 50 API콜/분        | 에러 응답 반환, 1분 후 자동 해제. 캐시 hit 제외. content와 완전 독립 |
| 3   | startGen        | content.ts    | generation counter | myGen !== startGen → 상태 변경 없이 return                           |
| 4   | translateGen    | translator.ts | generation counter | cancelTranslation() → translateGen++ → 이전 배치 DOM 주입 차단       |
| 5   | errorTimeout    | content.ts    | 3초 타이머 가드    | startTranslation() 시 clearTimeout + 콜백 내 state!=='error' 가드    |
| 6   | isB3rysElement  | observer.ts   | 패턴 매칭          | data-b3rys-_ 속성 또는 b3rys-_ 클래스 → 무시 (자체 DOM 변경 필터)    |

## Observer 콜백 규칙 (observer.ts → content.ts)

- `state === 'done'` → `startTranslation()` (증분, BLOCK_ID 보존)
- `state === 'loading'` → `pendingRestart = true` + `cancelTranslation()`
- 그 외 → 무시

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
