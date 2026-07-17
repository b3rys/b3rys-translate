# b3rys translate — TODO

---

## P0: 구조 안정화 (완료)

- [x] Observer 무한 루프 수정 — `removeAllTranslations()`이 Observer를 재트리거하는 피드백 루프
- [x] Observer 필터 강화 — `data-b3rys-*` 속성 및 `b3rys-*` 클래스 일괄 필터 (개별 체크 → 패턴 매칭)
- [x] FAB 취소 race condition — stale `startTranslation()` 결과가 상태 덮어쓰기 (`startGen` 카운터)
- [x] 에러 타임아웃 race condition — `errorTimeout` 추적 + 상태 가드
- [x] API 비용 보호 circuit breaker — 2중 방어 (content: 15회/분 시작 제한, background: 50회/분 API 콜 제한)
- [x] **Observer 단위 테스트** — b3rys 요소 필터링, 디바운스, 자체 DOM 변경 무시 검증 (7 tests)
- [x] **State Machine 테스트** — 상태 머신 추출 (translation-state.ts) + 전이/경쟁 조건/circuit breaker/에러 복구 검증 (14 tests)
- [x] **Circuit Breaker 테스트** — 순수 함수 추출 + 트립/정리/리셋 검증 (6 tests)
- [x] **Injection 라운드트립 테스트** — inject → removeAll → 원본 DOM 완전 복원 검증 (6 tests)
- [x] **Site Rule 테스트** — Gmail forceReplace, Substack injectAsSibling 각각 fixture + 검증 (9 tests)

---

## 번역

- 웹페이지 문단 번역 (EN → KO, 원문 유지 + 아래에 번역 삽입)
- 2-phase 텍스트 감지 (시맨틱 블록 + 텍스트 컨테이너)
- Viewport-first 병렬 배치 처리
- MutationObserver 동적 콘텐츠 대응
- 플로팅 번역 버튼 (Shadow DOM, 상태 표시)
- YouTube 이중자막 (영어 원문 + 한국어 번역 오버레이, 표시 모드 순환: EN+KO → EN → KO → 끄기)
- YouTube 자막 rolling 번역 (이벤트 기반, 10 cue look-ahead)
- 다중 번역 엔진 (Gemini, OpenAI, Anthropic)
- 엔진별 비용 추적 + 한도 설정
- 플로팅 버튼 배터리 게이지 (사용량 시각화)
- LRU 번역 캐시 (TTL 7일, 최대 1000개)
- 팝업 설정 (엔진 선택, API 키, 토글, 비용 표시)
- 사용량 chrome.storage.sync 기기 간 동기화
- 선택 번역 팝업 (Shadow DOM)
  - 텍스트 드래그 → 선택 영역 마지막 줄 오른쪽 끝에 트리거 버튼 표시
  - 문장 모드: 블록 팝업 + 번역문 + 복사 버튼
  - 단어 모드 (공백 없는 단일 단어): 컴팩트 팝업 + 번역 + 예문 2개 (단어 하이라이트)
  - 문장 모드 긴 번역문 문장 분리 표시
  - 팝업 position: absolute (페이지 스크롤 시 함께 이동)
  - 플로팅 버튼 on/off에 연동 (버튼 숨김 시 선택 번역도 비활성화)
- [x] YouTube 번역 중지 시 자막 버튼 연동 off
- [x] YouTube 자막 heuristic merge 개선 (MAX_CHARS 70, MAX_TIME 4s, 80자 초과 후처리 분할, 20자 미만 흡수)
- [x] YouTube 자막 오버레이 폰트 크기 증가 + 원문/번역 각 1줄 표시
- [x] YouTube 자막 semantic segmentation 인프라 구축 (segment mode, LLM 엔진 연동, hot-swap — 현재 비활성, 향후 분할+번역 통합 방식으로 재설계 예정)
- [x] YouTube 자막 우선 마이크로배치 (5개 cue 우선 전송 → 체감 응답 단축)
- [x] YouTube 자막 번역 대기 "..." 표시 (opacity 0.5 로딩 상태)
- [x] YouTube seek 깜빡임 방지 (isSeeking 플래그)
- [x] 사이트 룰 시스템 (site-rules.ts: Gmail forceReplace + translateSelectors, Substack injectAsSibling)
- [x] Phase 0 커스텀 셀렉터 감지 (사이트 룰 translateSelectors 연동)
- [x] 웹번역 모드 전환 (병행/대치 토글. markOriginalContent + CSS body.b3rys-replace-mode 전환)
- [x] 문서 이중 경로 구조 (AI용 스킬 + 사람용 다이어그램 docs/)
- [x] YouTube 자막 타이밍 자율 튜닝 (de-overlap + gap-aware LEAD. ASR sync scorer + grid search 인프라 구축. AD-006 참조)
- [x] Extension context invalidated 에러 핸들링 (checkApiKey, persistEnabled, openPopup 콜백)
- [x] 멀티언어 지원 (타겟 언어 선택 10개, 소스 자동감지, 캐시 언어별 분리, YouTube 실시간 반영)
- [x] 오픈소스 공개 준비 (Apache-2.0 · NOTICE · 엔진 갱신 gpt-4.1-nano/gemini-3.1 · README 재구성)
- [x] Claude Code 설치 스킬 (`/b3translate` — GitHub URL → 설치·API 키·사용법 가이드)

> 범례: `[x]` 완료 · `[~]` 진행중 · `[ ]` 미착수

---

## 기술 문서

> 상세 기술 문서는 `docs/`에 분리. 룰 변경 시 해당 문서도 업데이트할 것.

| 문서                                   | 내용                                                                  |
| -------------------------------------- | :-------------------------------------------------------------------- |
| [docs/pipeline.md](docs/pipeline.md)   | 번역 파이프라인 룰 카탈로그 (감지, 필터, 주입, 사이트 룰, Observer)   |
| [docs/ui-guide.md](docs/ui-guide.md)   | UI 동작 가이드 (FAB, 모드 전환, 주입 경로별 before/after 예시)        |
| [docs/safety.md](docs/safety.md)       | 안전 장치 & 상태 머신 (circuit breaker, rate limiter, 경쟁 조건 보호) |
| [docs/decisions.md](docs/decisions.md) | 아키텍처 결정 기록 (ADR: 설계 배경과 이유)                            |

### 테스트 현황

> 현재: **252개 tests** (unit + acceptance). `npm run test`로 실행.

주요 커버리지 — 텍스트 감지 · 번역 주입 · Observer 필터 · Circuit Breaker · 상태 머신 ·
사이트별 룰 · 선택 번역 팝업 · 번역 캐시 · YouTube cue 병합/자막/타이밍 · LLM 헬퍼.
파일 목록은 `tests/` 디렉토리 참조.

---
