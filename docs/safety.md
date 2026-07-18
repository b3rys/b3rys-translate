# 안전 장치 & 상태 머신

> 번역 루프, 경쟁 조건, API 비용 폭주를 방지하는 보호 메커니즘.
> 버그 수정 시 이 문서를 참고하여 보호 장치를 우회하지 않도록 주의.

---

## 전체 보호 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│ Content Script                                                      │
│                                                                     │
│  사용자 / Observer / autoTranslate                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────┐                       │
│  │  [1차] Circuit Breaker (30회/분)         │                       │
│  │  startTranslation() 호출 횟수 감시        │                       │
│  │                                          │                       │
│  │  통과 ──→ 번역 실행                       │                       │
│  │  차단 ──→ state='error'                  │                       │
│  │          + translationEnabled=false       │                       │
│  │          + FAB 클릭으로만 리셋 가능         │                       │
│  └──────────────────────────────────────────┘                       │
│         │                                                           │
│         │ chrome.runtime.sendMessage                                │
│         ▼                                                           │
├─────────────────────────────────────────────────────────────────────┤
│ Background Service Worker                                           │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────┐                       │
│  │  캐시 체크                                │                       │
│  │  hit → 즉시 반환 (rate limiter 통과)      │                       │
│  │  miss ↓                                  │                       │
│  └──────┼───────────────────────────────────┘                       │
│         ▼                                                           │
│  ┌──────────────────────────────────────────┐                       │
│  │  [최종] Rate Limiter (50콜/분)            │                       │
│  │  실제 API 호출 직전 횟수 감시              │                       │
│  │                                          │                       │
│  │  통과 ──→ API 호출                        │                       │
│  │  차단 ──→ 에러 응답 반환                   │                       │
│  │          "Rate limit exceeded"            │                       │
│  │          1분 후 sliding window 자동 해제   │                       │
│  └──────────────────────────────────────────┘                       │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────┐                       │
│  │  Gemini │ OpenAI │ Anthropic │ Google    │                       │
│  └──────────────────────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 상태 머신 (content.ts)

```
                                    전체 상태 전이도
 ┌────────────────────────────────────────────────────────────────────┐
 │                                                                    │
 │                    ┌──────────┐                                    │
 │        ┌──────────│   idle   │──────────┐                         │
 │        │          └──────────┘          │                         │
 │        │            │      ↑            │                         │
 │        │  FAB 클릭   │      │  취소/에러  │  autoTranslate         │
 │        │  (수동)     │      │            │  (자동)                 │
 │        │            ▼      │            │                         │
 │        │          ┌──────────┐          │                         │
 │        │          │ loading  │←─────────┘                         │
 │        │          └──────────┘                                    │
 │        │            │      │                                      │
 │        │    완료     │      │  API 에러                            │
 │        │            ▼      ▼                                      │
 │        │          ┌──────────┐        ┌──────────┐                │
 │        │          │   done   │───────→│  error   │                │
 │        │          └──────────┘        └──────────┘                │
 │        │            │      ↑            │      │                  │
 │        │  FAB 클릭   │      │  Observer  │      │ 3초 자동복귀     │
 │        │  (제거)     │      │  새 콘텐츠  │      │ (일반 에러만)    │
 │        │            │      │            │      │                  │
 │        │            ▼      │            │      ▼                  │
 │        │      removeAll    │            │   idle/done             │
 │        │      Translations │            │                         │
 │        │            │      │            │ circuit breaker         │
 │        │            ▼      │            │ 에러는 자동복귀 ✗        │
 │        └──────→ idle ──────┘            │ FAB 클릭으로만           │
 │                                         │ 리셋 가능                │
 │                                         └────→ idle              │
 └────────────────────────────────────────────────────────────────────┘
```

### 상태 전이 규칙

| 현재    | 이벤트             | 다음      | 조건                          |
| ------- | ------------------ | --------- | ----------------------------- |
| idle    | FAB 클릭           | loading   | API 키 존재                   |
| idle    | autoTranslate      | loading   | translationEnabled=true       |
| loading | 번역 완료          | done      |                               |
| loading | FAB 클릭 (취소)    | idle/done | hasTranslationsOnPage에 따라  |
| loading | API 에러           | error     |                               |
| done    | FAB 클릭           | idle      | removeAllTranslations 실행    |
| done    | Observer 새 콘텐츠 | loading   | 증분 번역 (BLOCK_ID 보존)     |
| error   | 3초 타이머         | idle/done | circuit breaker가 아닌 경우만 |
| error   | FAB 클릭           | loading   | circuit breaker 카운터 리셋   |

---

## 보호 장치 상세 (6개)

### 1. Circuit Breaker — 1차 방어선 (content.ts)

**목적**: 번역 시작 루프 차단 (Observer 버그, 상태 머신 버그 등)

```
시간축: ──────────────────────────────────────────── (60초 window)

정상 사용 (무한스크롤 탐색):
  start  start  start    start      start
  ──┼──────┼──────┼────────┼──────────┼───────→  ~5-12회/분 → OK

루프 발생 (Observer 버그):
  start start start start start start start start ...
  ──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼──┼─→  ~30-40회/분
                                          ↑
                              30회에서 차단! → error 상태

임계: 30회 시작 / 60초 (sliding window)
대상: startTranslation() 호출
```

**발동 시 동작 흐름**:

```
Circuit breaker 발동!
  │
  ├─ state = 'error'
  ├─ FAB → 에러 표시 (!)
  ├─ translationEnabled = false   ← 자동 재시작 완전 차단
  │
  │  이후 자동 경로 차단:
  │  ├─ Observer → state='error'이므로 무시
  │  ├─ autoTranslate → translationEnabled=false이므로 무시
  │  └─ 카운터 리셋 불가 (자동 경로에서는)
  │
  │  복구 방법: 사용자가 FAB 직접 클릭
  │  ├─ recentStarts.length = 0   ← 카운터 리셋
  │  ├─ translationEnabled = true
  │  └─ startTranslation() 1회 실행
  │
  └─ 수동 시작만 가능 모드
```

### 2. Rate Limiter — 최종 방어선 (background.ts)

**목적**: 실제 API 호출 횟수 제한 (content 버그와 완전 독립)

```
┌────────────────────────────────────────────────────────────────┐
│  Background Service Worker                                      │
│                                                                 │
│  handleTranslateBatch() 호출                                     │
│    │                                                            │
│    ├─ 캐시 hit? → 즉시 반환 (카운트 안 함)                        │
│    │                                                            │
│    └─ 캐시 miss → checkRateLimit()                              │
│                    │                                            │
│                    ├─ 50콜 미만 → 통과 → API 호출                │
│                    │                                            │
│                    └─ 50콜 이상 → 차단                           │
│                         │                                       │
│                         ├─ 에러 응답: "Rate limit exceeded"     │
│                         ├─ content → 일반 에러 처리              │
│                         └─ 1분 후 자동 해제 (sliding window)     │
│                                                                 │
│  ⚠️ content의 circuit breaker와 완전 독립 동작                   │
│  → circuit breaker가 실패해도 여기서 최종 차단                    │
└────────────────────────────────────────────────────────────────┘
```

### 3. Generation Counter — startGen (content.ts)

**목적**: 취소 후 stale `startTranslation()` 결과가 상태를 덮어쓰는 것 방지

```
시간축: ──────────────────────────────────────────────→

     startTranslation() #1         (gen=1)
     ├─────── translatePage() ─── Promise ───────────┐
     │                                                │ resolve (gen=1)
     │  사용자 취소 (FAB 클릭)                          │
     │  state = 'idle'                                │
     │                                                │
     │  startTranslation() #2     (gen=2)             │
     │  ├──── translatePage() ──────────┐             │
     │  │                               │             │
     │  │          ← #1 결과 도착!       ←────────────┘
     │  │          myGen(1) !== startGen(2)
     │  │          → 상태 변경 없이 return ✓
     │  │                               │
     │  │          ← #2 결과 도착        ←────────────┘
     │  │          myGen(2) === startGen(2)
     │  │          → state = 'done' ✓
     │  │
```

**가드 없을 때의 문제**:

```
     ❌ #1 결과가 state='done' 설정
     ❌ #2는 아직 loading 중인데 FAB이 '✓'로 변경
     ❌ #2 결과가 또 state='done' → 이중 완료 처리
```

### 4. Generation Counter — translateGen (translator.ts)

**목적**: 취소된 배치가 DOM에 번역을 주입하는 것 방지

```
cancelTranslation() 호출
  │
  ├─ translateGen++            ← 세대 증가
  ├─ cleanupLoaders()          ← DOM 로딩 표시 즉시 제거
  │
  │  이후 이전 배치의 processBatch() 결과 도착:
  │  ├─ gen(이전) !== translateGen(현재)
  │  └─ DOM 주입 안 함 → return
  │
  │  새 번역 시작:
  │  ├─ 새 gen = translateGen
  │  └─ gen === translateGen → DOM 주입 허용

┌──────────────── 타임라인 ────────────────────────┐
│                                                   │
│  batch A (gen=3)  ───→ API ───→ 응답 도착         │
│                                  gen(3)≠gen(4)    │
│          cancel → gen=4          → 주입 안 함 ✓   │
│                                                   │
│  batch B (gen=4)  ───→ API ───→ 응답 도착         │
│                                  gen(4)=gen(4)    │
│                                  → 주입 ✓          │
└───────────────────────────────────────────────────┘
```

### 5. Error Timeout Guard (content.ts)

**목적**: 에러 후 3초 복구 타이머가 새 번역 상태를 덮어쓰는 것 방지

```
시나리오: 에러 → 3초 내 재시작 → 타이머가 loading을 덮어씀

  ❌ 가드 없을 때:
  ──────────────────────────────────────────────────────→
  에러 발생  →  setTimeout(3초)  →  state='idle' 강제 설정
       ↓                              ↓
  사용자 재시작                    loading → idle 덮어씀! 💥
  state='loading'

  ✅ 가드 있을 때:
  ──────────────────────────────────────────────────────→
  에러 발생  →  errorTimeout = setTimeout(3초)
       ↓
  사용자 재시작
  clearTimeout(errorTimeout)  ← 타이머 취소!
  state='loading'
       ↓
  (3초 경과해도 타이머 없음 → 안전)

  추가 가드: 타이머 콜백 내에서도
  if (state !== 'error') return;  ← 이미 다른 상태면 무시
```

### 6. Observer 자체 변경 필터 (observer.ts)

**목적**: 번역 주입/제거에 의한 DOM 변경을 "새 콘텐츠"로 오인하는 것 방지

```
MutationObserver 콜백
  │
  │ 새 노드 추가됨
  │
  ├─ isB3rysElement() 체크:
  │   │
  │   ├─ data-b3rys-* 속성 있음?  → 무시 (자체 변경)
  │   │   예: data-b3rys-original
  │   │       data-b3rys-translated
  │   │       data-b3rys-id
  │   │
  │   ├─ b3rys-* 클래스 있음?     → 무시 (자체 변경)
  │   │   예: b3rys-translation
  │   │       b3rys-translation-inline
  │   │       b3rys-loader
  │   │
  │   └─ 둘 다 없음?             → hasNewContent = true
  │
  │ hasNewContent = true?
  │   │
  │   └─ 디바운스 500ms → onNewContent()
  │       │
  │       ├─ state='done'    → startTranslation() (증분)
  │       │                    BLOCK_ID 보존, 새 블록만 감지
  │       │
  │       ├─ state='loading' → pendingRestart = true
  │       │                    cancelTranslation()
  │       │
  │       └─ 그 외           → 무시
  │
  │
  ⚠️ 패턴 매칭 방식:
  │   ┌──────────────────────────────────────────┐
  │   │ for (const attr of el.attributes) {      │
  │   │   if (attr.name.startsWith('data-b3rys'))│
  │   │     return true;  // 자체 변경             │
  │   │ }                                        │
  │   │ if (el.className.includes('b3rys-'))     │
  │   │   return true;    // 자체 변경             │
  │   └──────────────────────────────────────────┘
  │   → 새 data-b3rys-* 속성 추가 시 자동으로 필터됨
  │   → 개별 속성 열거 방식보다 안전
```

---

## 2중 방어 시나리오

### 시나리오 A: Observer 루프 발생

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. Observer가 자체 DOM 변경 감지 (필터 버그)                     │
│     │                                                           │
│  2. startTranslation() 반복 호출                                 │
│     │  ×1  ×2  ×3  ×4  ×5  ...  ×15                             │
│     │                            │                              │
│  3. [1차] Circuit Breaker 발동!  ◄─┘                             │
│     │                                                           │
│     ├─ state = 'error'                                          │
│     ├─ translationEnabled = false                               │
│     │                                                           │
│  4. Observer → state='error' → 트리거 안 함                      │
│  5. autoTranslate → translationEnabled=false → 동작 안 함        │
│     │                                                           │
│  6. 시스템 안정 상태 (모든 자동 경로 차단)                         │
│     │                                                           │
│  7. 사용자가 FAB 클릭                                            │
│     ├─ recentStarts.length = 0 (카운터 리셋)                     │
│     ├─ translationEnabled = true                                │
│     └─ startTranslation() 1회 실행                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 시나리오 B: Circuit breaker를 우회하는 미지의 버그

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  1. 어떤 이유로 circuit breaker가 작동하지 않음                   │
│     (예: recentStarts 배열이 초기화됨)                            │
│     │                                                           │
│  2. API 호출이 계속됨                                            │
│     │  ×1  ×2  ×3  ...  ×150                                    │
│     │                    │                                      │
│  3. [최종] Rate Limiter 발동! ◄─┘                                │
│     │                                                           │
│     ├─ 모든 TRANSLATE_BATCH 요청에 에러 응답 반환                 │
│     ├─ "Translation paused: 150 API calls/min limit reached"    │
│     │                                                           │
│  4. content → 일반 에러 처리 → FAB 에러 표시                      │
│  5. 번역 중단                                                    │
│     │                                                           │
│  6. 1분 후 sliding window 자동 해제                               │
│     └─ 정상 서비스 복귀                                           │
│                                                                 │
│  ⚠️ Rate limiter는 content와 완전 독립                           │
│  → content의 어떤 버그도 rate limiter를 우회 불가                 │
│  → 캐시 hit은 카운트 안 함 (실제 API 비용만 보호)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 시나리오 C: 취소 + 재시작 경쟁 조건

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  시간축 →                                                       │
│                                                                 │
│  T0: startTranslation() (gen=5)                                │
│      ├─ translatePage() 호출                                    │
│      │                                                          │
│  T1: 사용자 FAB 클릭 (취소)                                      │
│      ├─ cancelTranslation()                                     │
│      │   ├─ translateGen++ (DOM 주입 차단)                       │
│      │   └─ cleanupLoaders() (로딩 표시 제거)                    │
│      ├─ state = 'idle'                                          │
│      │                                                          │
│  T2: 사용자 FAB 클릭 (재시작)                                    │
│      ├─ startGen++ (gen=6)                                      │
│      ├─ clearTimeout(errorTimeout)                              │
│      ├─ startTranslation() (gen=6)                              │
│      │                                                          │
│  T3: T0의 translatePage() 결과 도착                              │
│      ├─ myGen(5) !== startGen(6) → return (상태 변경 없음) ✓     │
│      │                                                          │
│  T4: T2의 translatePage() 결과 도착                              │
│      ├─ myGen(6) === startGen(6) → state = 'done' ✓             │
│      │                                                          │
│  결과: 정상 동작. 이전 결과가 새 상태를 오염시키지 않음              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 주의사항

### Observer 콜백에서 하면 안 되는 것

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ❌ removeAllTranslations()                                  │
│     → BLOCK_ID 전부 제거                                      │
│     → detectTextBlocks()가 전부 새 블록으로 인식               │
│     → 전체 재감지 → 번역 → Observer 트리거 → 무한 루프         │
│                                                              │
│  ❌ 무조건 startTranslation()                                 │
│     → 자체 DOM 변경이 트리거일 수 있음                          │
│     → isB3rysElement() 필터를 우회하는 변경이면 루프             │
│                                                              │
│  ✅ state='done'일 때만 증분 startTranslation()                │
│     → 기존 BLOCK_ID 보존                                      │
│     → 새로 추가된 블록만 감지 + 번역                            │
│     → 기존 번역은 유지                                         │
│                                                              │
│  ✅ state='loading'일 때 → pendingRestart + cancelTranslation │
│     → 현재 번역 취소 후 새로 시작                               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 상태 변경 시 체크리스트

```
코드에서 state를 변경하기 전에 반드시 확인:

  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  □ 1. 내가 최신 generation인가?                      │
  │       myGen === startGen                            │
  │       → 아니면 stale 결과, 상태 변경 금지            │
  │                                                     │
  │  □ 2. 에러 타이머가 남아있진 않은가?                  │
  │       clearTimeout(errorTimeout)                    │
  │       → 새 번역 시작 시 이전 타이머 반드시 제거       │
  │                                                     │
  │  □ 3. circuit breaker에 걸리진 않았는가?             │
  │       recentStarts.length < CIRCUIT_MAX             │
  │       → 걸렸으면 번역 시작 불가                      │
  │                                                     │
  │  □ 4. translationEnabled 저장 상태와 일치하는가?     │
  │       chrome.storage.sync에 저장된 값 확인           │
  │       → circuit breaker가 false로 설정했을 수 있음   │
  │                                                     │
  └─────────────────────────────────────────────────────┘
```

### 새 보호 장치 추가 시 체크리스트

```
  ┌─────────────────────────────────────────────────────┐
  │                                                     │
  │  □ 1. 기존 보호 장치와 충돌하지 않는가?              │
  │       → generation counter, circuit breaker 등      │
  │                                                     │
  │  □ 2. Observer 무한 루프를 유발하지 않는가?           │
  │       → DOM 변경 시 isB3rysElement() 필터 통과 여부  │
  │                                                     │
  │  □ 3. 수동 복구 경로가 있는가?                       │
  │       → 사용자가 FAB 클릭으로 상태를 리셋할 수 있어야│
  │                                                     │
  │  □ 4. docs/safety.md에 문서화했는가?                 │
  │       → 이 문서에 새 장치 추가                       │
  │                                                     │
  └─────────────────────────────────────────────────────┘
```
