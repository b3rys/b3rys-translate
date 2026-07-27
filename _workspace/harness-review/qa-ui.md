# Popup/UI·전체 품질·문서·실브라우저 독립 Release 검토

- 검토 일자: 2026-07-27
- 저장소: `/Users/gd452/Development/b3rys-translate`
- 브랜치: `feat/quality-models-antirez-pre`
- 범위: popup 모델 UI, provider별 API-key/storage 연결, 전체 tracked/untracked 변경, 신규·기존 테스트, package scripts, CLAUDE.md 및 배포 문서, 제공된 실브라우저 증거
- 제한: 소스 수정 없음, 외부 API 및 자격증명 접근 없음

## verdict

**NO-GO / RELEASE BLOCKED**

정적 구현과 자동 품질 게이트는 양호하다. 모델 selector는 모델명만 표시하고 가격 tooltip도 모델명·가격만 표시하여 품질·속도·추천을 과장하지 않는다. API key도 모델이 아니라 provider별 `engineApiKeys[engine]`에 유지되어 같은 provider의 두 모델이 키를 안전하게 공유하고 provider 전환 시 해당 provider 키만 불러온다. 전체 test 321/321, typecheck, build가 통과했고 lint는 오류 0이다.

그러나 배포 필수 조건인 실제 Chrome 인수검증이 완료되지 않았다. 제공된 owner 증거에는 popup option 대기 timeout과 종료 시 `content verifier failed for popup.html reason:1`이 남아 있다. 이번 검토 환경에는 이를 재현·확정할 실브라우저 도구나 성공 스크린샷/콘솔 로그가 없었다. 또한 popup 핵심 wiring은 순수 함수 단위 테스트만 있고 `main.ts`의 실제 DOMContentLoaded → storage → model change → provider key 연결을 통합 검증하지 않는다. 사용자/배포 문서도 실제 local storage 및 신규 모델 UI와 여러 곳에서 불일치한다. 따라서 현 상태를 release-ready로 승인할 수 없다.

## severity별 발견

### Critical

없음. 자격증명 노출, 하드코딩된 키, 임의 외부 전송 또는 명백한 저장소 파괴 동작은 확인되지 않았다.

### High

#### H1. 필수 실제 Chrome 인수검증 미완료

- **파일:라인:** `CLAUDE.md:108,110-115`, `docs/release-checklist.md:3-5,9-10,12-42`
- CLAUDE.md와 release checklist 모두 자동 테스트가 실제 Chrome 검증을 대체하지 못한다고 명시한다.
- 제공된 실행 증거는 popup option 대기 timeout 및 종료 로그 `content verifier failed for popup.html reason:1`로 끝났으며 성공 판정이 아니다.
- popup 모델 옵션 6개 표시, 가격 tooltip, provider 전환, 키 마스킹/보존/삭제, 저장 후 재오픈, 모델별 실제 요청 라우팅을 실제 Chrome에서 확인한 증거가 없다.
- **영향:** release gate 자체 미충족. popup이 열리지 않거나 초기화가 중단되는 경우 설정·온보딩·번역 전체가 막힌다.
- **조치:** 새 build를 `chrome://extensions`에서 reload한 뒤 popup DevTools console 포함 성공 증거를 남기고, `docs/release-checklist.md` 전 항목을 실제 브라우저에서 통과시켜야 한다.

#### H2. popup의 핵심 storage/provider 연결에 통합 회귀 테스트가 없음

- **파일:라인:** `entrypoints/popup/main.ts:39-117,160-197,256-273`; `tests/model-ui.test.ts:4-31`; `tests/model-migration.test.ts:6-48`
- `model-ui.test.ts`는 selector label과 tooltip column만 검사한다. `model-migration.test.ts`는 storage migration 순수 경로만 검사한다.
- 실제 popup의 `DOMContentLoaded`, 저장된 `selectedEngine` + `selectedModels` 복원, 모델 변경 시 두 storage key의 원자적 일치, provider별 키 마스킹/저장/삭제, badge/key URL 갱신은 테스트하지 않는다.
- 특히 브라우저 검증이 이미 timeout/verifier failure로 끝났으므로 이 공백을 수동 증거로도 메우지 못했다.
- **영향:** 단위 테스트가 모두 통과해도 실제 popup 초기화 또는 이벤트 wiring 회귀가 release에 포함될 수 있다.
- **조치:** chrome mock + popup DOM fixture로 `main.ts` 통합 테스트를 추가하거나 실제 Chrome 성공 증거로 최소 gate를 충족해야 한다.

#### H3. 신규 모델의 인증된 실호출/EN→KO 제품 gate가 미검증

- **파일:라인:** `utils/models.ts:23-66`; `utils/engines/openai.ts:17-75`; `utils/engines/gemini.ts:27-88`; `utils/engines/anthropic.ts:20-79`; `tests/model-engine-routing.test.ts:16-94`
- mock 테스트는 model ID와 payload shape만 확인한다. 실제 계정 entitlement, HTTP 200, 응답 schema, 번호/HTML 보존, 비용·latency는 확인하지 않았다.
- 저장소의 자체 조사도 `gpt-5.4-nano` 및 `gemini-3.5-flash-lite`를 번역 품질 근거 부족으로 “보류/추가 X”로 판정하고 있다 (`_workspace/model-research/openai.md:8-12,90-106`, `_workspace/model-research/google.md:3-8,83-96`). 반면 현재 catalog는 둘을 즉시 선택 가능하게 노출한다.
- UI 문구 자체는 품질을 과장하지 않지만, 기능 release 관점에서 신규 옵션의 실제 동작·번역 적합성은 아직 입증되지 않았다.
- **영향:** 사용자가 선택한 모델이 계정에서 거부되거나 형식이 깨질 수 있고, 고가 모델 선택 시 검증되지 않은 비용·지연이 발생할 수 있다.
- **조치:** 자격증명 소유자가 낮은 예산의 승인된 canary로 모델별 최소 4 mode 계약을 검증하고, 제품 채택 기준을 문서화해야 한다. 본 검토에서는 외부 API/자격증명 금지에 따라 실행하지 않았다.

### Medium

#### M1. 개인정보·운영 문서의 storage 설명이 실제 구현과 불일치

- **파일:라인:** `utils/storage.ts:15-20,54-65,66-113`; `CLAUDE.md:131`; `PRIVACY.md:30-33,96-99`; `TODO.md:32-35`; `docs/ui-guide.md:540-543`
- 구현은 API key, 설정, 사용량을 `chrome.storage.local`에 두고 legacy sync 데이터를 migration 후 전부 clear한다.
- CLAUDE.md는 API key를 sync에 저장한다고 쓰고, PRIVACY.md는 설정과 사용량 통계를 sync하여 기기 간 동기화한다고 한국어/영어로 명시한다.
- cache 최대치도 구현 `CACHE_MAX_ENTRIES = 4000`과 문서의 1,000개가 다르다.
- **영향:** 사용자에게 제공하는 데이터 보관/동기화 고지가 실제 동작과 다르며 release 문서 신뢰와 privacy review에 직접 영향을 준다.
- **조치:** release 전에 PRIVACY.md 양 언어, CLAUDE.md, TODO.md, ui-guide를 실제 local-only schema와 cache 4,000개 기준으로 정렬해야 한다.

#### M2. README·release checklist·설치 skill이 신규 Model UI와 불일치

- **파일:라인:** `README.md:40,125-139,169-185,197-201`; `docs/release-checklist.md:38-42`; `skills/b3translate/SKILL.md:96-113,139-145`; `entrypoints/popup/index.html:41-62,237-245`
- 실제 UI는 `Model` selector와 모델별 비용 표지만 README/skill/checklist는 `Engine` selector·Engine tooltip·엔진별 상세로 설명한다.
- README 가격표는 제거된 GPT-4.1 Nano를 계속 안내하며 신규 6개 모델을 반영하지 않는다. test count도 252로 표기되어 실제 321과 다르다.
- release checklist 5번은 여전히 `Engine ⓘ`를 검사하도록 되어 있어 실제 UI 기준 인수테스트가 모호하다.
- **영향:** 사용자가 화면과 다른 안내를 받고, release QA가 잘못된 라벨을 기준으로 수행된다.
- **조치:** selector/tooltip/cost detail 용어를 Model 기준으로 갱신하고 provider별 key 공유 구조를 설명해야 한다.

#### M3. 모델 가격 tooltip의 단위와 입력/출력 순서가 명시되지 않음

- **파일:라인:** `entrypoints/popup/model-ui.ts:13-41`; `entrypoints/popup/index.html:43-57`
- tooltip은 `$0.25/$1.50`처럼 두 수치만 표시하고 이것이 USD/1M tokens의 input/output 순서임을 설명하지 않는다.
- 과장된 “고품질/추천/최저가” 설명을 제거한 방향은 적절하지만, 가격 자체의 의미도 제거되어 사용자가 비교를 오해할 수 있다.
- **조치:** 품질 설명 없이도 `Input / Output · USD per 1M tokens` 같은 중립적 단위 표시는 필요하다.

#### M4. CLAUDE.md 품질 명령 순서에 typecheck가 누락

- **파일:라인:** `package.json:15-25`; `CLAUDE.md:103-108`; `docs/release-checklist.md:7-10`
- package에는 `typecheck`가 있고 release checklist도 이를 필수로 포함하지만 CLAUDE.md의 “테스트 검증 순서”는 `test → lint → build`만 적는다.
- **영향:** 작업자가 문서대로만 실행하면 필수 typecheck를 건너뛸 수 있다.
- **조치:** `test → lint → typecheck → build`로 단일화한다.

### Low

#### L1. popup icon-only 버튼의 접근 가능한 이름 부족

- **파일:라인:** `entrypoints/popup/index.html:34-37,81-102,204-231`
- API key 저장/삭제 버튼과 error dismiss 버튼은 SVG 또는 `×`만 있고 `aria-label`이 없다. cost detail/reset은 `title`만 제공한다.
- **영향:** 스크린리더에서 기능 이름이 불명확하고 키보드/접근성 QA가 어렵다.
- **조치:** 각 버튼에 명시적 `aria-label`을 추가하고 focus-visible/키보드 동작을 실제 Chrome에서 확인한다.

#### L2. 외부 Google Fonts가 extension popup에서 실제 적용되는지 미검증

- **파일:라인:** `entrypoints/popup/index.html:7-11`
- popup이 원격 Google Fonts stylesheet/font를 참조한다. MV3 extension CSP/네트워크 정책에 따라 차단되어 fallback font와 console 오류가 발생할 수 있으나, 현재 성공한 popup console 증거가 없다.
- **영향:** 치명적 기능 오류보다는 시각적 불일치/콘솔 잡음 가능성이다.
- **조치:** 실제 popup console/network에서 확인하고, 필요 시 font를 extension asset으로 번들한다.

## 긍정 확인 사항

1. **라벨 중심 UI:** `populateModelSelect()`는 6개 `model.label`만 option text로 사용한다 (`model-ui.ts:3-10`). provider명·추천·품질 수식어를 option에 섞지 않는다.
2. **설명 과장 제거:** tooltip은 모델명과 가격 2열뿐이며 “저비용/고품질/권장” 문구가 없다 (`model-ui.ts:13-41`, `tests/model-ui.test.ts:23-31`).
3. **provider별 key 안전 연결:** 모델 선택 시 `getModelConfig(...).engine`으로 provider를 결정하고 key 저장·삭제는 `keys[engine]`만 변경한다 (`main.ts:160-197`). 같은 provider의 두 모델은 하나의 key를 공유하며 다른 provider key를 덮어쓰지 않는다.
4. **저장 모델 방어:** 다른 provider의 model ID 또는 손상된 model 값은 해당 provider 기본 모델로 복구된다 (`utils/models.ts:88-100`, `tests/model-catalog.test.ts:39-42`).
5. **모델별 cache/usage 격리:** cache prefix에 target/mode/model이 포함되고 usage bucket도 model ID 기준이다 (`utils/translation-context.ts:4-10`, `background.ts:167-183,252-265,337-385`).
6. **XSS 완화:** 가격 tooltip과 cost row는 정적 catalog라도 DOM `textContent`로 구성한다 (`model-ui.ts:13-41`, `main.ts:374-401`).
7. **브랜치 규칙:** main 직접 작업이 아니라 feature branch에서 작업 중이다 (`feat/quality-models-antirez-pre`).
8. `git diff --check`는 통과하여 whitespace 오류가 없다.

## 실행 명령 / 실제 결과

| 명령                        | exit | 실제 결과                                                                                                                      |
| --------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------ |
| `git status --short`        |    0 | tracked 수정 13개, untracked 21개. 검토 중 소스 변경 없음. `_workspace/`는 기존 조사 문서와 본 보고서를 포함.                  |
| `git branch --show-current` |    0 | `feat/quality-models-antirez-pre`                                                                                              |
| `git diff --check`          |    0 | 출력 없음, whitespace 오류 없음                                                                                                |
| `npm run test -- --run`     |    0 | **29 files, 321/321 passed**, 총 34,424ms. Node `localStorage` ExperimentalWarning은 있으나 실패 없음.                         |
| `npm run lint`              |    0 | **0 errors, 8 warnings**. 전부 `tests/reporters/ascii-reporter.ts`의 기존 `no-explicit-any` 경고(56,61,67,91,184,186,200,204). |
| `npm run typecheck`         |    0 | `tsc --noEmit`, 진단 없음                                                                                                      |
| `npm run build`             |    0 | WXT 0.20.13 / Chrome MV3, **146.11 kB**, 641ms. popup HTML 9.92 kB, popup JS 10.97 kB.                                         |

### package scripts 검토

- `package.json:15-25`에 `dev`, `build`, `zip`, `test`, `typecheck`, `lint`, `lint:fix`, `format`, `format:check`, `prepare`가 정의되어 있다.
- `test` script는 watch 가능한 `vitest`이므로 독립 재검증에는 종료가 보장되는 `npm run test -- --run`을 사용했다.
- source tree와 build 결과는 검증 전후 동일한 git status였고, 검토자가 소스를 수정하지 않았다.

## 문서 정합

| 문서                               | 판정                     | 근거                                                                                                                      |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` 실브라우저 규칙        | **정합/유효**            | 자동 검증과 Chrome 검증의 상호 비대체, 자격증명 비접근, YouTube 종료 규칙이 명시됨 (`110-115`).                           |
| `CLAUDE.md` 아키텍처/Key Decisions | **불일치**               | Gemini 단일 API 도식(`37-41`), API key sync(`131`), EN→KO 고정(`130`)이 실제 다중 provider/local/target 선택 구현과 다름. |
| `docs/release-checklist.md`        | **부분 불일치 + 미통과** | 실제 Chrome 필수라는 gate는 명확하나 Model UI를 여전히 Engine tooltip으로 지칭하고, 전체 체크 성공 증거가 없음.           |
| `README.md`                        | **불일치**               | GPT-4.1 Nano·3엔진 UI·252 tests 등 구식 정보가 신규 6-model UI 및 321 tests와 다름.                                       |
| `PRIVACY.md`                       | **불일치**               | 설정/usage sync 고지가 실제 local-only 구현과 다름. 한국어/영어 모두 수정 필요.                                           |
| `skills/b3translate/SKILL.md`      | **불일치**               | 설치 안내가 Engine selector와 특징 비교 tooltip을 전제로 함.                                                              |
| `_workspace/model-research/*`      | **구현과 결정 불일치**   | OpenAI/Google 조사 결론은 후보 추가 보류이나 현재 catalog에는 즉시 노출됨.                                                |

## release blockers

1. **실제 Chrome popup verifier failure 원인 해결 및 성공 증거 확보.** 최소한 popup open, 6 options, tooltip, provider 전환, 기존 key 마스킹, provider별 key 보존, 저장 후 재오픈을 확인한다.
2. **`docs/release-checklist.md` 전 항목 실제 브라우저 통과.** 자동 321 tests는 이를 대체하지 않는다.
3. **신규 모델 승인 canary.** 자격증명 소유자가 각 정확한 model ID의 실제 200/응답 형식/4 mode/비용을 제한된 예산으로 확인한다.
4. **popup `main.ts` 통합 테스트 또는 동등한 실브라우저 증거 추가.** 현재 순수 model UI/migration/mock routing 테스트만으로는 timeout 이력을 닫을 수 없다.
5. **privacy 및 사용자 문서 정정.** 최소 `PRIVACY.md`, `README.md`, `CLAUDE.md`, `docs/release-checklist.md`, 설치 skill을 실제 local storage·Model UI와 맞춘다.
6. **Google/OpenAI 후보 노출의 제품 결정 명시.** 기존 조사상의 “보류/추가 X”를 뒤집는 근거와 rollout gate를 기록하거나 검증 전 선택지에서 제외한다.

## unverified scope

- 실제 Chrome에서 popup 렌더링, dropdown option 수/label, tooltip 위치·잘림·폰트·콘솔 오류
- 실제 `chrome.storage.local` persistence 및 popup 재오픈 후 selected model/provider key 복원
- 빠른 model/provider 연속 변경 시 async storage write ordering
- API key 저장/삭제/마스킹 UX와 provider 간 key 비혼선의 실브라우저 검증
- Google/OpenAI/Anthropic 실제 인증 요청, model entitlement, 200/4xx/429, response schema, rate limit
- 모델별 EN→KO 품질, 번호/HTML 보존, word/subtitle/segment output, p50/p95 latency와 실비
- popup에서 선택한 모델이 content/page/selection/YouTube 전체 경로에 실제 적용되는 end-to-end 증거
- `docs/release-checklist.md` 1~5절 전체: 정적 긴 페이지, on/off 5회, 스크롤, cache, 선택 번역, YouTube, Gmail/Claude/Anthropic/Substack, onboarding, auto-translate
- YouTube 실제 테스트 및 종료 시 재생 일시정지 확인
- 기존 owner popup timeout과 `content verifier failed for popup.html reason:1`의 원본 상세 로그/스크린샷(저장소 `_workspace`에는 해당 로그 artifact가 없고, 대화로 제공된 요약만 검토)
