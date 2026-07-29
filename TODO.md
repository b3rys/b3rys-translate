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
- [x] 크롬 웹스토어 등록 (v0.5.2 Unlisted 제출, 심사 대기)
- [x] 자동 번역 모드 (Auto 토글, 기본 OFF · circuit breaker 15→30)
- [x] B2 번역 파이프라인 (priority pool + worker 6 + 스크롤 추종 재정렬)
- [x] 스크롤 안정화 (pinAnchor multi-tick 재고정 · 미디어 제외 앵커 · 네이티브 anchoring 대응)
- [x] reveal-in-place 토글 (off=CSS 숨김/DOM 보존, on=클래스 제거만 — 재주입 제로, 언어 변경 시만 재구축)
- [x] 콘솔 침묵 (기본 무로그, `localStorage.b3rys_debug='1'`로만 디버그)
- [x] 배포 전 인수테스트 게이트 (docs/release-checklist.md)
- [x] Auto 모드 = 둥둥이 상태 유지 (FAB OFF면 페이지 이동해도 번역 안 함 · empty/cancelled 패스의 sticky 오염 제거) (#10)
- [x] 사용량 통계 저장소 sync→local + 디바운스 플러시 (배치마다 sync 쓰기 → quota 폭주 차단) (#12)
- [x] **모든 설정 저장소 sync→local 통일** (sync 쓰기 quota 터지면 전 설정 저장 마비되던 근본 버그 차단 · onChanged 전부 local · sync 미사용) (#13)
- [x] 둥둥이 '새로고침하세요' 말풍선 깜박임 제거 (#13)
- [x] v0.5.6 버전 bump
- [x] **YouTube 영상 전환 시 이전 자막 재사용 버그** — 인터셉트한 timedtext를 `lang=`만으로 매칭해 SPA 전환 후 이전 영상 cue가 로드됨. videoId+lang 키 격리 · 전환/클릭 시 prune · tlang(YT 자동번역) 제외 · 503 응답 캐싱 차단 · 파싱 실패 payload 자기치유 · 오버레이 videoId 안전망 (7 tests)
- [x] v0.5.7 버전 bump (YouTube 자막 교차오염 수정 포함)
- [x] **SPA 전환 후 stale player response 차단** — `ytInitialPlayerResponse`·초기 페이지 script 태그가 전환 후에도 이전 영상을 가리킴(실측 확인). 3개 전략 전부 videoId 검증 (4 tests)
- [x] **자막 종류(kind)·locale 매칭 정밀화 + 잔여 누수 정리** — 실제 받은 payload로 ASR/manual 판정(조각 자막 방지) · `lang` 정확 일치 우선(zh-Hant↔zh-Hans 오매칭 차단) · `v=` 없는 URL 오태깅 금지 · 언어 변경 시 videoId 재검증(떠난 영상 재번역 방지) · rolling translation 리스너 누수 · notice 잔존 · CC 토글 타이머 미취소 · 스킬 문서에 #16 규칙 기록 (하네스 3인 검수 반영)
- [x] **`pot` 토큰 게이팅으로 자막을 못 받던 버그** — YouTube가 timedtext에 영상별 proof-of-origin 토큰을 요구(baseUrl 직접 요청 시 200 + 0바이트). 공식 한국어 자막이 있는 영상은 YouTube가 ko만 로드해 en 인터셉트가 없어 이중자막이 아예 안 나옴. 인터셉트한 URL의 토큰을 빌려 `lang`/`kind`만 교체해 재요청(토큰은 영상별, 실측 검증) · bridge를 live `getPlayerResponse()` 우선으로 (HTML fetch 폴백 제거) (3 tests)
- [x] **번역 모델 정리** — 씽킹 모델(Gemini 3.5 Flash Lite: 씽킹 상시 ON, 끌 수 없음) 제외 · Sonnet 4.6 비용 과다로 제외 → 번역 최적화 4개 모델. 저장된 옛 선택값은 기본값으로 복구 (migration)
- [x] **문단 단위 번역** — 글 전체가 <pre> 하나인 사이트에서 영문 전체 뒤 국문 전체가 붙던 문제. site rule `splitParagraphs` 로 빈 줄 경계마다 inline span wrapper 를 씌워 문단별로 번역 (v0.5.11)
- [x] **antirez 규칙 확대 + 코드 문단 스킵** — /news/169 → /news/<n> · /latest/<n>. 이 사이트는 <code> 태그를 안 쓰고 들여쓰기로만 코드를 넣어 기존 `:has(code)` 가드가 무력했다. 들여쓰기 신호로 코드 문단만 건너뛴다 (글 12편 검증) (v0.5.12)
- [x] **팝업 버전 하드코딩 제거** — HTML 에 숫자가 박혀 있어 새 빌드를 올리고도 옛 버전으로 표시, 실제로 어느 빌드가 도는지 오판했다. 매니페스트에서 읽는다
- [x] **비용 표 중복 줄** — 사용량 집계 키가 엔진 → 모델로 바뀌며 두 형식이 공존, 같은 이름이 두 줄로 표시. 옛 엔진 버킷을 migration 에서 제거
- [x] **Upstage Solar Mini 엔진 추가** — 외부 기여 PR #14 를 코드 실행 없이 diff 만 읽고 우리 모델 카탈로그 구조로 재구현(외부 PR 은 프롬프트 인젝션 경로). 가격은 PR 값이 아닌 공급사 공개 요금표($0.15/$0.60). reasoning 미지원 문서 확인 → `reasoning_effort` 미전송. 키가 Authorization 헤더에만 실리는지 테스트로 고정 (14 tests · v0.5.13)
- [ ] **깃헙 싱크** — 로컬 커밋 밀림. PR 을 gd452 로 올리면 작성자=승인자가 되어 gd.b3rys 계정 필요 (대표님 브라우저 로그인 필요)
- [ ] **크롬 웹스토어 재배포** — 대표님 인수테스트 후 승인 대기
- [ ] **인수테스트 미커버 항목** — 유튜브 이중자막 · 드래그 선택 번역 · Gmail · Substack

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

> 현재: **354개 tests** (unit + acceptance). `npm run test`로 실행.

주요 커버리지 — 텍스트 감지 · 번역 주입 · Observer 필터 · Circuit Breaker · 상태 머신 ·
사이트별 룰 · 선택 번역 팝업 · 번역 캐시 · YouTube cue 병합/자막/타이밍 · LLM 헬퍼.
파일 목록은 `tests/` 디렉토리 참조.

---
