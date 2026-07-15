# Architectural Decisions

> 주요 설계 결정과 그 배경을 기록합니다.

---

## AD-001: YouTube 자막 모드 동기화 제거

**날짜**: 2026-02-13
**상태**: 확정

**맥락**: YouTube 자막 표시 모드(both/en/ko)를 chrome.storage.sync로 동기화하여 새 영상에서 이전에 선택한 모드로 시작하도록 시도.

**결정**: 동기화 제거. 매번 `both`에서 시작하는 고정 순환(both → en → ko → off).

**이유**:

- 저장된 모드에서 시작하면 순환 길이가 달라져 UX 혼란 (예: 'ko' 저장 시 1번 클릭으로 off)
- 원형 순환(circular cycling) 시도했으나 순서가 직관적이지 않음
- 단순한 고정 순환이 가장 예측 가능한 UX

---

## AD-002: Observer 콜백에서 removeAllTranslations() 금지

**날짜**: 2026-02 (초기 설계)
**상태**: 확정

**맥락**: MutationObserver가 DOM 변경 감지 → 번역 재시작 시, 기존 번역을 제거하면 Observer가 그 제거를 다시 감지하는 무한 루프 발생.

**결정**: Observer 경로에서는 증분 번역만 사용. `removeAllTranslations()`은 FAB 클릭(사용자 의도)에서만 호출.

**이유**:

- BLOCK_ID가 있는 요소는 재감지에서 제외 → 기존 번역 유지
- 새로 추가된 콘텐츠만 감지 → 번역 → 안정

---

## AD-003: forceReplace 경로에서 물리 교체 금지

**날짜**: 2026-02 (초기 설계)
**상태**: 확정

**맥락**: Gmail 등 forceReplace 사이트에서 원문을 번역문으로 물리적으로 교체하면, 모드 전환(parallel ↔ replace) 시 원문 복원 불가.

**결정**: `markOriginalContent()` + CSS `body.b3rys-replace-mode` 토글만 사용. 물리적 DOM 교체 금지.

**이유**:

- CSS 토글이면 모드 전환 시 원문/번역문 즉시 전환 가능
- 원문 데이터 보존으로 안전한 복원 보장

---

## AD-004: Shadow DOM으로 UI 격리

**날짜**: 2026-02 (초기 설계)
**상태**: 확정

**맥락**: Content script의 UI(플로팅 버튼, 선택 팝업, 새로고침 알림)가 호스트 페이지 CSS에 영향받음.

**결정**: 모든 UI 요소를 Shadow DOM (mode: closed)으로 격리.

**이유**:

- 호스트 페이지 CSS와 완전 격리
- `closed` 모드로 외부 JS 접근 차단
- Observer의 `isB3rysElement()` 필터로 자체 DOM 변경 감지 방지

---

## AD-005: 2중 API 비용 보호

**날짜**: 2026-02
**상태**: 확정

**맥락**: Observer 무한 루프나 코드 버그로 API 호출 폭주 가능.

**결정**: Content(circuit breaker: 15회/분 시작 제한) + Background(rate limiter: 50회/분 API 콜 제한) 2중 방어.

**이유**:

- Content 레벨: 번역 시작 자체를 제한 (근본 차단)
- Background 레벨: Content 버그와 무관하게 API 호출 상한 보장
- 캐시 hit는 rate limiter에서 제외 (비용 무관)

---

## AD-006: YouTube 자막 타이밍 — De-overlap + Gap-aware LEAD

**날짜**: 2026-02-14
**상태**: 확정

### 문제

YouTube ASR cue를 문장 단위로 병합(mergeCues)하면 자막 싱크가 깨짐.

- 빠른 영상(-1wUricB7vY): 자막이 발화 끝나기 전에 다음으로 넘어감 (premature cutoff 52%)
- 느린 영상(AUcYJczWXT4): 자막이 발화보다 늦게 나옴 (lead=-0.23s)

사용자 요구사항:

1. 최적: 발화와 자막이 일치 (수동 자막처럼)
2. 차선: 늦는 것보다 약간 일찍이 나음
3. 발화 끝나기 전에 넘어가면 안 됨

### 시도한 접근법과 실패 이유

| #   | 접근법                                              | 결과                  | 실패 원인                                              |
| --- | --------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| 1   | LEAD 파라미터 튜닝 (grid search)                    | avg 0.828→0.881 (+6%) | 구조적 문제를 파라미터로 못 풀음. 겹침이 근본 원인     |
| 2   | speechEnd guard (overlay에서 발화 끝날 때까지 hold) | 사용자 "못 볼 수준"   | 연속 발화에서 LEAD 효과 전부 제거 → 모든 자막이 늦어짐 |
| 3   | noOverlap (postProcessCues에서 겹침 제거)           | 0.856→0.597 (-30%)    | LEAD를 적용한 후 겹침 제거 → LEAD 자체를 무력화        |
| 4   | Progressive reveal (단어씩 표시)                    | 사용자 거부           | "한단어씩 나오면 모하러 이걸 하겠어. 그냥 ASR 보지."   |
| 5   | 한국어 읽기 시간 기반 hold                          | 싱크 완전 깨짐        | "한글로 자막싱크를 맞추지 말고 원문으로 맞춰야해"      |

### 근본 원인 발견

**YouTube ASR raw cue끼리 2~3초씩 시간이 겹침.**

```
raw cue A: [0s ─────── 5s]
raw cue B:      [3s ─────── 8s]    ← 2초 겹침
```

이 겹침이 병합 후에도 그대로 전파되어:

- 병합 cue의 speechEnd가 다음 cue의 start보다 늦음
- LEAD가 이 겹침을 더 악화시킴
- gap-aware LEAD의 gap 계산이 음수 → 조건 미발동

### 최종 해법: De-overlap + Gap-aware LEAD

**1단계 — De-overlap** (`deoverlapCues`, 병합 전 처리)

```ts
// 각 raw cue의 duration을 다음 cue의 start까지로 제한
cues.map((c, i) => {
  const maxDur = cues[i + 1].start - c.start;
  return c.duration > maxDur ? { ...c, duration: maxDur } : c;
});
```

YouTube의 인위적 겹침 제거 → 깨끗한 비겹침 cue → 병합 후에도 비겹침 보장.

**2단계 — Gap-aware LEAD** (`postProcessCues` LEAD 루프)

```ts
// 이전 cue 끝 ~ 현재 cue 시작 사이 gap만큼만 LEAD 적용
const gap = currentStart - prevSpeechEnd;
lead = Math.max(0, Math.min(computedLead, gap));
```

- 침묵 구간(gap > 0): LEAD 적용 → 자막 일찍 표시 (사용자 선호)
- 연속 발화(gap ≈ 0): LEAD ≈ 0 → 발화와 정확히 일치 (최적 해법)
- 음수 gap(잔여 겹침): LEAD = 0 → 악화 방지

### 결과

| 지표                    | Before | After      | 변화               |
| ----------------------- | ------ | ---------- | ------------------ |
| Avg sync score          | 0.828  | **0.914**  | +10.3%             |
| Premature cutoff        | 48-52% | **10-14%** | -75%               |
| p50 lead time           | +0.25s | **0.00s**  | 발화와 정확히 일치 |
| AUcYJczWXT4 (느린 영상) | 0.805  | **0.913**  | +13.4%             |

### 핵심 교훈

1. **데이터 문제는 데이터 레이어에서 해결** — raw cue 겹침이 근본 원인이었는데, overlay(display layer)에서 guard로 해결하려 하면 부작용만 생김. 입력 데이터를 깨끗하게 정리하는 것이 먼저.

2. **파라미터 튜닝의 한계** — 구조적 문제(데이터 겹침)가 있으면 파라미터 조합을 아무리 바꿔도 효과가 미미함. 구조를 고친 후 파라미터 효과는 0.5% 미만으로 수렴.

3. **자동화된 품질 측정이 핵심** — ASR word-level timestamp를 ground truth로 사용한 sync scorer + 3개 fixture 자동 비교가 없었으면 접근법별 비교 불가. 사용자에게 매번 "테스트해보세요"할 수 없음.

4. **실패한 접근법도 기록** — speechEnd guard, noOverlap, progressive reveal 등 실패한 5가지 접근을 기록해두면 같은 실수 반복 방지.

### 테스트 인프라

- `tests/helpers/sync-scorer.ts` — ASR word-level 기반 sync quality scorer
- `tests/acceptance/timing-sweep.test.ts` — Phase 1 (단일 파라미터) + Phase 2 (grid search) 자동 sweep
- `tests/fixtures/youtube-timedtext-asr-*.json` — 3개 ASR fixture (느린/보통/빠른 발화)
