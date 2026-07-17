---
name: youtube-subtitle-rules
description: YouTube 자막 번역 룰 (파이프라인, cue 병합, rolling 번역, 캐시). youtube/ 디렉토리 수정 시 참조.
---

# YouTube 자막 번역 룰

## 파이프라인

1. 플레이어 버튼 클릭 → YouTube 내부 player 객체에서 자막 트랙 목록(captionTracks) 획득
2. English 트랙 선택 — manual(사람 작성, 정확도 높음) 우선, 없으면 ASR(자동 생성) 폴백
3. 자막 다운로드 (3-strategy)
   - 인터셉트: bridge 스크립트가 YouTube 네트워크 요청을 가로채서 자막 데이터 추출
   - 대기: 인터셉트 실패 시, YouTube가 자체적으로 자막을 로드할 때까지 대기
   - bridge fetch: 둘 다 실패하면, bridge가 직접 자막 URL로 fetch 요청
4. Cue 분리/병합 — YouTube 원본 cue(단어 2~3개 단위)를 번역 적정 크기로 재구성
5. 이중 자막 오버레이 시작 — YouTube 기본 CC를 CSS로 숨기고, 커스텀 오버레이로 원문+번역 동시 표시
6. Rolling translation 시작 — 전체 한꺼번에 번역하지 않고, 재생 위치 기준으로 선제적 번역

## Cue 병합 로직 (youtube-controller.ts)

**`splitCuesAtSentences()`** — 문장 경계에서 cue를 자름

- `(?<=[.!?;:])\s+(?=[A-Z])` — 문장 끝 기호 뒤 공백 + 대문자 시작이면 분리
- **약어 보호**: "Dr. Smith"의 `.`은 문장 끝이 아님 → `ABBREV_RE`/`DOTTED_ABBREV_RE` 매칭 시 임시 치환 후 분리 → 복원

**`deoverlapCues()`** — YouTube ASR raw cue의 시간 겹침 제거 (병합 전 전처리)

- YouTube ASR cue끼리 2~3초 겹치는 경우가 흔함 → 병합 후 premature cutoff의 근본 원인
- 각 cue의 duration을 다음 cue의 start까지로 제한하여 깨끗한 비겹침 cue 생성
- `mergeCues()`와 `mergeCuesTwoLine()` 모두 병합 전 적용

**`mergeCues()`** — 짧은 cue들을 합쳐서 번역 적정 크기로 만듦

- 문장 끝 (. ! ?) → 합치다가 문장이 끝나면 거기서 끊음
- 접속사 (and, but, so, however, because, although 등) → 이미 3초 이상 또는 60자 이상이면 접속사 앞에서 끊음
- 80자 또는 5초 초과 → 문장 끝이 안 와도 강제로 끊음 (configurable: `PostProcessConfig`)
- **강제 끊김 refine** (`refineForcedBreak`): 한도로 끊길 때 BreakRefiner 전략 체인으로 자연스러운 지점 선택 — ① 중앙 근처 쉼표 ② 기능어 꼬리 제거("...of your |" 방지). 끝이 이미 문장부호면 그대로. leftover는 비례 타이밍으로 다음 chunk에 승계. 새 휴리스틱은 `FORCED_BREAK_REFINERS` 배열에만 추가 (merge 루프 무수정)
- **고아 cue 흡수**: 강제로 끊으면 찌꺼기가 생김 → 25자 미만이면 앞 cue에 붙임

**Gap-aware LEAD** (`postProcessCues`에서 적용)

- 이전 cue의 speechEnd ~ 현재 cue의 start 사이 gap만큼만 LEAD 적용
- 침묵 구간(gap > LEAD): 전체 LEAD → 자막 일찍 표시
- 연속 발화(gap ≈ 0): LEAD ≈ 0 → 발화 시작과 정확히 일치
- **주의**: de-overlap 없이 gap-aware LEAD만 적용하면 효과 없음 (raw cue 겹침 → gap 음수 → 조건 미발동). 반드시 de-overlap이 먼저 적용되어야 함
- 설계 결정 상세: `docs/decisions.md` AD-006 참조

## Rolling Translation (subtitle-translator.ts)

- **이벤트 기반**: setInterval 폴링이 아니라 영상 이벤트(timeupdate, seeking, play)에 반응
- **throttle**: 이벤트가 자주 발생해도 0.5초에 한 번만 처리
- **look-ahead**: 현재 위치에서 앞으로 10개 cue를 미리 번역해놓음
- **seek 대응**: 사용자가 영상을 뒤로 감으면, 현재 위치보다 3개 전 cue부터 번역
- **in-flight 추적**: 이미 번역 요청 보낸 cue는 다시 요청 안 함. 실패하면 표시 해제 → 다음 이벤트에서 재시도
- **번역 컨텍스트**: 직전 3개 번역된 cue를 같이 보내서 LLM이 문맥에 맞게 번역
- **배치 크기**: 한 번에 최대 20개 cue를 묶어서 API에 보냄

## 자막 캐시

- **인메모리**: subtitle-cache.ts (`Map<videoId, Map<original, translated>>`)
- **영속 캐시**: background.ts의 LRU 캐시가 자동 적용 (같은 TRANSLATE_BATCH 메시지 사용)
- 같은 영상 재시청 시: 인메모리 캐시는 없지만 background 영속 캐시에서 즉시 반환 (API 호출 없음)

## 알려진 제한사항

- Bridge의 fetch/XHR 몽키패칭은 YouTube 내부 변경에 취약
- 약어 보호가 알려진 패턴(ABBREV_RE, DOTTED_ABBREV_RE)에만 적용 — 미등록 약어에서는 오분리 가능
- 인메모리 자막 캐시는 페이지 새로고침 시 초기화 (background 영속 캐시는 유지)
- 번역 캐시 키는 원문 텍스트 → 다른 영상에서 같은 문장이 다른 컨텍스트에서 나오면 캐시된 번역이 반환됨 (대부분 자연스러움)
