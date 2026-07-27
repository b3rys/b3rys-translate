# GPT-5.4 Nano / GPT-5.6 Luna 통합 영향 분석

- 대상: `/Users/gd452/Development/b3rys-translate`
- 조사 시각: 2026-07-27 17:14 KST
- 범위: 실제 OpenAI adapter, background dispatch, prompt/parser, storage/cache/usage/popup 계약
- 코드 변경: 없음
- 인증된 생성 호출: 하지 않음(비용·권한이 수반되는 실 API 호출 없이 정적 계약과 공식 문서를 교차검증)

## 1. 결론

1. 현행 `gpt-4.1-nano`는 deprecated이며 공식 shutdown 날짜는 **2026-10-23**이다. 표준(base) `gpt-4.1-nano`의 공식 권장 교체 모델은 **`gpt-5.6-luna`**다. 반면 deprecations 표에서 **`gpt-5.4-nano`는 fine-tuned `ft-gpt-4.1-nano-2025-04-14`의 교체 대상**으로 적혀 있다. 둘을 혼동하면 안 된다.
2. 모델 문자열만 바꾸는 것은 안전한 drop-in이 아니다. 현재 요청에는 항상 `temperature: 0.1`이 들어가고, GPT-5.6은 reasoning effort를 생략하면 공식 가이드상 `medium`이 기본이다. GPT-5 계열의 sampling parameter 제약을 피하고 번역의 지연·비용을 통제하려면 Chat Completions payload에 **`reasoning_effort: "none"`을 명시**하고 `temperature: 0.1` 조합을 계약 테스트해야 한다. `low` 이상은 벤치 후보이지 기본값이 아니다.
3. `gpt-5.4-nano`도 reasoning 기본값에 기대지 말고 `none`을 명시해야 한다. 존재성과 Chat Completions 지원은 확인되지만 EN→KO 번역 우위의 공식 직접 근거가 없고, 현재보다 input 2배/output 3.125배 비싸다. 따라서 공식 교체 경로가 아니라 **수동 벤치 후보**다.
4. `gpt-5.6-luna`는 공식 교체 경로지만 현재보다 input 10배/output 15배 비싸고, reasoning 기본값을 방치하면 숨은 reasoning output token·지연이 추가될 수 있다. **즉시 무조건 전환이 아니라 shutdown 전 canary/품질·비용 gate를 거친 전환**이 맞다.
5. 가장 큰 애플리케이션 결함은 cache와 usage가 모델을 구분하지 않는다는 점이다. 기존 4.1 결과가 새 모델 결과처럼 7일간 재사용되고, 두 후보를 동시에 노출하면 비용과 품질을 모델별로 측정할 수 없다. 모델 교체 전에 cache namespace와 model-level usage 차원을 먼저 도입해야 한다.

**판정:** `gpt-5.4-nano` = 보류/벤치 후보, `gpt-5.6-luna` = 공식 migration 목표(조건부 채택). 4.1 제거는 필요하지만 테스트와 데이터 migration 없이 model constant만 교체해서는 안 된다.

## 2. 현재 실제 호출 계약

### OpenAI adapter

`utils/engines/openai.ts:18-91`은 page/subtitle/word/segment 모두 다음 계약을 사용한다.

- endpoint: `POST https://api.openai.com/v1/chat/completions` (`utils/constants.ts:1-6`)
- model: `ENGINE_MODELS.openai = "gpt-4.1-nano"` (`utils/constants.ts:8-12`)
- request: `messages: [{ role: "user", content: prompt }]`, `temperature: 0.1`
- response text: `choices[0].message.content`
- usage mapping: `prompt_tokens → inputTokens`, `completion_tokens → outputTokens`
- API body의 `error.message`는 throw, content가 없으면 throw
- 429/5xx와 network exception은 공통 `callWithRetry`가 최대 3회 처리 (`llm-helpers.ts:112-140`)

segment만 raw text를 `__raw__` ID로 반환한다. 나머지는 `[N] 번역` 텍스트를 regex parser에 통과시킨다.

### prompt/parser

`utils/engines/llm-helpers.ts:12-109`:

- page: 번호와 HTML tag/attribute 보존 지시
- subtitle: 번호, 짧고 자연스러운 번역, 이전 자막 context
- word: 번역/정의/유사어/예문을 번호별 자유 텍스트 형식으로 요구
- segment: 단어를 바꾸지 않는 punctuation-only raw text
- parser: `/\[(\d+)\].../`로 번호를 원 paragraph ID에 다시 연결

새 모델에서도 prompt 입력 형식 자체는 유효하다. 다만 strict structured output이 아니므로 번호 누락·중복·설명 추가·markdown fence에 취약하다. 현재 테스트(`tests/llm-helpers.test.ts:71-106`)는 parser의 정상/멀티라인/범위 밖/malformed만 검증하고, **OpenAI adapter request/response 계약 테스트는 없다**.

### background/storage

- `selectedEngine`은 provider 수준(`gemini | openai | anthropic`)이며 모델 수준이 아니다 (`types.ts:1`, `background.ts:277-292`).
- OpenAI key는 `chrome.storage.local.engineApiKeys.openai`에 저장된다. 모델별 key가 아니다 (`storage.ts:9-40`, `popup/main.ts:92-97`).
- registry는 `openai → openaiEngine` 하나뿐이다 (`engines/index.ts:9-17`).
- usage는 `b3rys_usage_stats.openai` 한 bucket에 input/output/cost/request count를 누적한다 (`background.ts:135-210`).
- popup 이름과 가격도 OpenAI 하나만 표현한다 (`types.ts:23-27`, `popup/main.ts:21-51`).

## 3. 공식 문서 교차검증

공식 가격은 Standard API의 USD/1M text tokens이다.

| 모델           | Standard input | cached input | output | 현재 대비 input/output | 공식 migration 위치                    |
| -------------- | -------------: | -----------: | -----: | ---------------------: | -------------------------------------- |
| `gpt-4.1-nano` |          $0.10 |       $0.025 |  $0.40 |                1× / 1× | deprecated, shutdown 2026-10-23        |
| `gpt-5.4-nano` |          $0.20 |        $0.02 |  $1.25 |            2× / 3.125× | fine-tuned 4.1 nano replacement로 명시 |
| `gpt-5.6-luna` |          $1.00 |        $0.10 |  $6.00 |              10× / 15× | base 4.1 nano replacement로 명시       |

입력:출력 토큰이 단순히 1:1이라는 예시에서 총비용 배수는 5.4 Nano가 `(0.20+1.25)/(0.10+0.40)=2.9×`, 5.6 Luna가 `(1+6)/(0.10+0.40)=14×`다. 실제 번역은 prompt overhead와 한국어 tokenization 때문에 반드시 현장 usage mix로 계산해야 한다.

공식 문서에서 확인한 계약:

- `gpt-5.4-nano`, `gpt-5.6-luna`는 text in/out과 Chat Completions를 지원한다.
- OpenAI는 reasoning 모델에 Responses API를 권하지만 Chat Completions도 계속 지원한다고 명시한다.
- GPT-5.6은 `reasoning.effort`의 `none/low/medium/high/xhigh/max`를 지원하며, 생략 시 `medium`이 기본이다.
- Chat Completions에서는 request field가 Responses의 `reasoning: { effort }`와 달리 **`reasoning_effort`**다.
- reasoning token은 보이지 않지만 output token으로 과금된다. Responses 예시는 `usage.output_tokens_details.reasoning_tokens`; Chat Completions는 `usage.completion_tokens_details.reasoning_tokens` 형태다.
- 공식 자료에는 EN→KO 번역 품질, 번호/HTML 보존, word/subtitle/segment mode의 직접 평가가 없다. 일반 capability를 번역 우위로 간주할 수 없다.

### 공식 URL

1. 모델 카탈로그: https://developers.openai.com/api/docs/models
2. GPT-5.4 Nano: https://developers.openai.com/api/docs/models/gpt-5.4-nano
3. GPT-5.6 Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
4. GPT-4.1 Nano: https://developers.openai.com/api/docs/models/gpt-4.1-nano
5. 가격: https://developers.openai.com/api/docs/pricing
6. Deprecations: https://developers.openai.com/api/docs/deprecations
7. 최신 모델/reasoning 설정: https://developers.openai.com/api/docs/guides/latest-model
8. Reasoning guide: https://developers.openai.com/api/docs/guides/reasoning
9. Chat Completions → Responses migration 및 양쪽 payload 예시: https://developers.openai.com/api/docs/guides/migrate-to-responses
10. Chat Completions create reference: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create

모델 페이지의 shell은 HTTP 200이었고, pricing/deprecations/reasoning/migration의 공식 markdown endpoint도 직접 확인했다. 인증된 `/v1/models` 또는 generation call은 하지 않았으므로 계정별 접근 권한과 실제 200 응답은 canary 전까지 미확인이다.

## 4. 후보별 요청/응답 계약 영향

### 공통 권장 request profile (Chat Completions 유지 시)

```json
{
  "model": "gpt-5.4-nano 또는 gpt-5.6-luna",
  "messages": [{ "role": "user", "content": "..." }],
  "reasoning_effort": "none",
  "temperature": 0.1,
  "max_completion_tokens": "mode별 검증된 상한"
}
```

- `reasoning_effort: "none"`: 단순 번역에서 지연·숨은 output 비용을 억제하고 temperature 사용 조건을 명시적으로 만든다.
- `temperature: 0.1`: 기존 동작을 보존하되 두 정확한 model ID에 대해 200/400 contract test가 통과할 때만 유지한다. 모델별 공식 parameter support가 달라지면 `none` profile에서 temperature를 제거하고 품질/형식 변동을 다시 측정한다.
- `max_completion_tokens`: 현재 코드에는 출력 상한이 없다. page/subtitle/word/segment별 최대 예상 길이를 fixture로 계측해 서로 다른 상한을 둔다. reasoning을 켜면 이 상한에 reasoning token도 포함되므로 visible output truncation을 함께 검사해야 한다.

### `gpt-5.4-nano`

- `ENGINE_MODELS.openai` 교체만으로 endpoint와 기본 response parser는 형태상 유지 가능하다.
- 하지만 명시적 `reasoning_effort`, output cap, model-aware metadata/cache/stats가 없으면 운영상 drop-in으로 볼 수 없다.
- 가격 상승은 중간 수준이나 공식 base 4.1 migration target이 아니며, 직접 번역 품질 근거도 없다.
- 번역처럼 단순·대량 workload에서 `none`부터 비교하고, `low`는 blind 평가에서 의미 있는 품질 향상이 있을 때만 허용한다.

### `gpt-5.6-luna`

- 공식 base migration target이다.
- 현재 payload 그대로면 reasoning 기본 `medium`과 `temperature`의 조합이 가장 먼저 실패/변동할 위험이다. 성공하더라도 hidden reasoning token이 output 가격 $6/MTok로 청구되어 비용·latency가 급증할 수 있다.
- 따라서 `none` 명시는 사실상 필수 baseline이다. 공식 가이드가 “lowest cost and latency/high-volume”로 소개하는 것은 5.6 family 내부 비교이지, 4.1 Nano보다 싸다는 뜻이 아니다.
- 6개 worker의 병렬 page 요청(`PIPELINE_CONCURRENCY=6`)과 YouTube rolling 요청에서 높은 단가/latency가 곱해진다. timeout/AbortSignal도 adapter에 없으므로 p95/p99와 취소 비용을 canary에서 확인해야 한다.

### Responses API로 동시에 옮기지 말 것

모델 retirement 대응과 endpoint migration을 한 배포에서 합치면 실패 원인을 분리하기 어렵다. Responses로 바꾸면 다음이 함께 변경된다.

- endpoint `/v1/responses`
- request `messages → input`, `reasoning_effort → reasoning: { effort }`
- text `choices[0].message.content → output/output_text`
- usage `prompt_tokens/completion_tokens → input_tokens/output_tokens`

현행은 단일-turn text 번역이라 Chat Completions 유지가 최소 변경 경로다. 모델 migration 안정화 후 Responses 전환을 별도 ADR/테스트 묶음으로 수행한다.

## 5. GPT-4.1 Nano 제거 migration 영향

### A. 한 모델로 전면 교체하는 최소 경로

`openai`를 계속 provider ID로 유지하고 내부 model만 교체한다.

- `selectedEngine`: 기존 값 `openai`를 그대로 유지. storage rewrite 불필요.
- API key: `engineApiKeys.openai` 재사용. key 복사/재입력 불필요.
- UI: display name, 가격, “최저가·비추론” note는 반드시 수정. 특히 Luna는 전체 엔진 중 최저가가 아니다.
- model metadata: model ID, reasoning profile, price를 한 객체에서 원자적으로 선택해야 한다. constants 세 곳이 따로 drift하지 않게 한다.
- cache: 기존 4.1 cache를 비우거나 versioned key로 격리해야 한다.
- usage: 과거 `estimatedCost`는 기록 당시 금액이므로 재가격하지 않는다. 전환 시점부터 새 가격으로 계산하되 모델별 비교를 위해 새 bucket/schema version을 권장한다.

### B. 5.4 Nano와 5.6 Luna를 동시에 선택지로 제공하는 경로

`EngineType`에 `openai54/openai56`을 추가하는 방식은 API key를 중복 저장하고 provider 개념을 오염시키므로 피한다.

권장 저장 형태:

```ts
selectedEngine: "openai"
selectedOpenAIModel: "gpt-5.4-nano" | "gpt-5.6-luna"
engineApiKeys.openai: "sk-..."
usageStats: provider/model 또는 modelId 기준 bucket
```

- legacy `selectedEngine: "openai"`이고 model setting이 없으면 rollout 정책의 default를 명시적으로 채운다. 공식 target을 택하면 Luna, benchmark 전 안전 rollout이면 feature flag/canary cohort를 사용한다.
- runtime enum 검증이 필요하다. 지금 background는 storage 값을 타입 단언만 하므로 손상된 값에서 `undefined.translate`가 가능하다.
- popup은 모델 select, 모델별 가격/설명, 전환 전 예상 비용 경고를 추가해야 한다.
- key는 provider 단위라 그대로 하나만 사용한다.

### Cache migration — 차단 이슈

현재 key는 `targetLang + (word 여부) + originalText`뿐이다 (`background.ts:246-249, 335-369`). provider/model/prompt version을 포함하지 않는다. 그 결과:

1. 4.1 번역이 5.4/5.6 선택 후에도 최대 7일 재사용된다.
2. 모델 A/B에서 같은 원문을 먼저 번역한 모델이 다른 모델의 결과를 덮어쓴다.
3. page와 subtitle도 word가 아니면 같은 namespace를 공유하는 기존 문제까지 있다.
4. cache hit은 usage/request count에 잡히지 않으므로 A/B 지표가 왜곡된다.

권장 key는 최소 `cacheSchemaVersion/provider/modelId/promptVersion/targetLang/mode/originalText`다. `CACHE_LOOKUP`도 selected model을 읽어 같은 prefix를 계산해야 한다. 가장 단순한 1회 migration은 upgrade 시 cache 전체 clear지만, 장기적으로 versioned namespace가 필요하다. prompt 변경도 cache version을 올린다.

### Usage/cost migration — 차단 이슈

현재 `ENGINE_PRICING.openai`는 가격 한 쌍뿐이고 stats도 `.openai` 하나다.

- 5.4와 5.6을 함께 제공하면 정확한 비용을 계산할 수 없다.
- 기존 `usage.prompt_tokens_details.cached_tokens`를 버리고 모든 input을 full input price로 계산하므로 prompt caching이 발생할 때 비용을 과대추정한다.
- `completion_tokens` 총량으로 비용 합계는 대체로 reasoning 과금까지 포착하지만 `completion_tokens_details.reasoning_tokens`를 버려 latency/cost 원인을 진단할 수 없다.
- 비용 한도는 request 전에 누적 총액만 비교하므로 한 번의 고가/장출력 요청으로 limit를 크게 초과할 수 있다.

권장 `UsageData` 확장: `cachedInputTokens?`, `reasoningOutputTokens?`, `modelId`. 계산은 `(input-cached)*inputPrice + cached*cachedPrice + output*outputPrice`. 과거 stats는 그대로 보존하고 `legacy:gpt-4.1-nano`로 라벨만 이동하거나 migration timestamp 이후 새 model bucket에 기록한다. 값이 이미 `estimatedCost`로 확정되어 있으므로 과거 token을 새 단가로 역산/재가격하면 안 된다.

## 6. latency/cost/품질 위험

| 위험                                            | 영향                               |     우선순위 | 완화                                                              |
| ----------------------------------------------- | ---------------------------------- | -----------: | ----------------------------------------------------------------- |
| Luna 기본 reasoning `medium` + 현행 temperature | 400 또는 예상 밖 동작              |           P0 | `reasoning_effort:none` 명시, payload contract test               |
| 숨은 reasoning token                            | $6/MTok output 비용과 latency 증가 |           P0 | none baseline, detail 기록, output cap                            |
| 모델 미포함 cache                               | 4.1 결과 재사용, A/B 오염          |           P0 | versioned cache/clear migration                                   |
| 단일 OpenAI 가격/stats                          | 비용 한도 및 모델 비교 오류        |           P0 | model-aware pricing/usage bucket                                  |
| Luna 단가 10×/15×                               | 사용자 cost limit 급소진           |           P0 | 전환 경고, canary, 실제 token mix 예산 gate                       |
| output 상한/timeout 없음                        | runaway output, 긴 worker 점유     |           P1 | mode별 `max_completion_tokens`, AbortSignal timeout               |
| regex 자유형 parser                             | 번호 누락/중복/부분 결과           |           P1 | completeness validator, malformed 재시도; 추후 structured outputs |
| 6-way concurrency                               | rate/latency spike와 overspend     |           P1 | model별 concurrency canary, p95/p99 측정                          |
| alias drift                                     | 품질이 무통보 변경될 수 있음       |           P1 | benchmark는 dated snapshot, 운영 alias/snapshot 정책 명시         |
| 공식 EN→KO 근거 없음                            | 비용 상승 대비 품질 불명           | P0 채택 gate | representative blind A/B                                          |

## 7. 테스트 우선 변경안

코드를 수정하기 전에 아래 순서대로 RED를 만든다.

### 1단계 — OpenAI adapter characterization (`tests/openai-engine.test.ts` 신규)

fetch를 mock해 네 mode 각각에 대해 검증한다.

1. endpoint/auth/header/model/messages가 정확하다.
2. 선택 model의 policy가 `reasoning_effort: none`, `temperature: 0.1`, mode별 `max_completion_tokens`를 만든다.
3. `choices[0].message.content`를 page/subtitle/word는 ID에, segment는 `__raw__`에 연결한다.
4. `prompt_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`를 손실 없이 normalize한다.
5. API error, 빈 choices, null content, malformed body, 400 unsupported parameter를 명시 오류로 낸다.
6. 429/5xx retry와 4xx no-retry를 검증한다.

### 2단계 — 순수 model policy table

`modelId → endpoint/request profile/pricing/displayName`을 순수 데이터로 만들기 전에 테스트한다.

- 4.1 ID는 selectable 목록에 없음.
- 5.4/5.6 정확한 ID와 Standard input/cached/output 가격.
- 두 모델의 baseline effort는 `none`.
- unknown stored model은 안전한 rollout default 또는 명시 오류로 정규화.
- provider key는 두 모델 모두 `engineApiKeys.openai` 하나를 사용.

### 3단계 — cache migration/격리 테스트

- 동일 text/lang이어도 model/mode/promptVersion이 다르면 miss.
- legacy unversioned cache가 새 모델에서 hit하지 않음.
- upgrade migration clear/version bump가 idempotent.
- `CACHE_LOOKUP`과 write path가 같은 prefix function을 사용.
- 모델 A 결과가 모델 B 결과를 덮어쓰지 않음.

### 4단계 — usage/cost/storage migration 테스트

- cached input discount와 output/reasoning 과금 계산.
- 4.1 historical `estimatedCost`를 보존하고 새 단가로 재가격하지 않음.
- 5.4/5.6 요청이 별도 bucket에 누적.
- reset/storage.onChanged/debounced flush가 새 schema에서도 lost update를 만들지 않음.
- `selectedEngine=openai`와 기존 key를 보존하면서 legacy profile에 model default를 1회 채움.
- 잘못된 `selectedEngine`/model ID를 runtime validation.

### 5단계 — background 통합 테스트

현재 직접 테스트가 없는 `handleTranslateBatch` 경계를 export 가능한 순수 coordinator로 분리한 뒤:

- selected engine/model/key dispatch
- cache hit은 API/usage 미발생, model 전환 후 miss
- cost limit precheck와 단일-call 최대 예상비용 guard
- partial parser 결과를 cache하지 않거나 누락만 안전 재시도
- segment bypass와 usage 기록

### 6단계 — 인증 canary(기본 CI에서는 skip)

각 정확한 model ID × 4 mode로 소량 호출한다.

- HTTP 200 및 현재 `reasoning_effort:none + temperature:0.1` 지원
- numbered ID/HTML 보존/segment 무변조
- usage 상세 필드와 실제 output cap 동작
- p50/p95 latency, input/output/reasoning/cached tokens, batch당 실비
- access tier/rate limit

API key 없는 CI에서는 mock contract만 실행하고, canary는 수동 승인·낮은 예산·fixture hash 고정으로 수행한다.

### 7단계 — 대표 번역 gate

최소 후보: 4.1 baseline snapshot, 5.4 Nano, 5.6 Luna. fixture는 일반 문단, 기술 문서, HTML, 존댓말/대화, 고유명사, YouTube 자막/context, 단어 카드, punctuation segment를 포함한다.

채택 gate:

- 번호/HTML/단어 보존 및 parser 완전성 100%
- 의미 누락/환각이 baseline 이하
- blind human preference 또는 사전 정의 quality threshold 통과
- p95 latency와 실제 batch당 비용이 제품 예산 이내
- 5.6 `none`과 `low`를 비교하되 `low`는 품질 개선이 추가 비용/지연을 정당화할 때만 선택

검증 명령 순서(구현 시): `npm run test` → `npm run lint` → `npm run build`.

## 8. 권장 rollout

1. **즉시:** 4.1 shutdown migration 이슈를 P0로 등록하되 model constant는 아직 바꾸지 않는다.
2. **먼저:** adapter contract test, model policy, cache namespace, model-aware usage를 RED→GREEN으로 만든다.
3. **canary:** 5.4와 5.6을 exact ID로 비교하고 `reasoning_effort:none`을 baseline으로 측정한다.
4. **결정:** 공식 replacement와 shutdown 리스크 때문에 최종 기본 후보는 5.6 Luna이지만, 품질/비용 gate 실패 시 5.4를 임의 채택하지 말고 다른 지원 모델 포함 제품 결정을 재검토한다.
5. **migration 배포:** 기존 OpenAI key/selectedEngine 보존, cache version bump, historical usage 보존, UI 가격 경고 갱신.
6. **관측:** 첫 배포에서 model별 400/429/5xx, empty/partial parse, p95 latency, reasoning tokens, batch당 비용과 cost-limit overshoot를 관측한다.
7. **기한:** 2026-10-23 이전에 4.1 호출 제거와 rollback 가능한 새 모델 rollout을 완료한다.

## 9. 미확인 사항

- 인증된 실제 생성 호출을 하지 않아 계정별 model access와 exact payload의 200 응답은 미확인이다.
- 공식 EN→KO benchmark는 찾지 못했다. 번역 품질 우위 주장은 하지 않는다.
- `temperature: 0.1`과 각 exact ID의 실제 조합은 문서 기반 conditional compatibility이며 canary contract test를 통과해야 한다.
- 현재 저장된 사용자의 input/output token mix, cache discount 발생률, p95 latency가 없어 총비용 예측은 예시 배수다.
