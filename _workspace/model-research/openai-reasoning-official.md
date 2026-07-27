# GPT-5.4 Nano / GPT-5.6 Luna reasoning·번역 적합성 공식 검증

- 확인 시각: **2026-07-27 17:15:13 KST (+0900)**
- 출처 범위: **OpenAI 공식 개발자 문서만** 사용
- 확인 방법: 아래 공식 URL에 직접 HTTP 접속(모델·가이드·가격·deprecations 페이지 HTTP 200) 후 문서 본문 대조
- 대상: `b3rys-translate`의 EN→KO 텍스트 번역 후보
- 코드 수정: **없음**
- 인증된 유료 생성 호출: **하지 않음** (문서 계약 검증이며 실제 계정 접근성/번역 품질 실측은 아님)

## 최종 판정

1. **두 모델 모두 범용 reasoning-capable 모델이다.** OpenAI 문서가 reasoning token 지원 및 reasoning effort를 명시한다.
2. 그러나 **둘 다 번역 특화 모델은 아니다.** 최신 모델의 multilingual/text capability 때문에 번역에 사용할 수 있을 뿐, 공식 설명상 번역 전용 학습·최적화 모델이나 EN→KO 벤치마크 모델이 아니다. 따라서 제품 문구로 **“번역 추론 모델”은 부정확하거나 오해 소지가 있다.** 정확한 표현은 “번역에 사용할 수 있는 범용 reasoning 모델”이다.
3. **`gpt-5.4-nano`**는 간단한 고용량 작업용 저가 모델이고 reasoning 기본값은 `none`이다. 현행 `temperature: 0.1`을 유지하려면 effort가 반드시 `none`이어야 한다.
4. **`gpt-5.6-luna`**는 이전 nano tier에 대응하는 고용량·비용 민감 workload용 범용 모델이며, reasoning 기본값은 `medium`이다. 공식 GPT-5.6 가이드에서 `temperature`의 모델별 허용 조건을 확인하지 못했으므로 **production 요청에서는 `temperature`를 보내지 않는 것이 안전**하다.
5. OpenAI가 deprecated `gpt-4.1-nano`의 권장 대체로 지목한 것은 **`gpt-5.6-luna`**다. 다만 이것은 수명주기상의 대체 권고이지, EN→KO 번역 품질 우위의 직접 증거는 아니다.

## 모델별 계약 표

가격은 Standard API의 **USD / 1M text tokens**(짧은 context 기본 요율)이다.

| 항목                  | GPT-5.4 Nano                                                                                                               | GPT-5.6 Luna                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 정확한 alias/model ID | `gpt-5.4-nano`                                                                                                             | `gpt-5.6-luna`                                                                                                                                                                                 |
| 공식 고정 snapshot    | `gpt-5.4-nano-2026-03-17`                                                                                                  | **날짜 고정 snapshot 미확인**. 모델 페이지의 Snapshots 목록은 `gpt-5.6-luna`만 반복 표시하므로 alias와 별개인 dated ID를 제시하지 않는다.                                                      |
| reasoning 모델 여부   | **예**. 모델 페이지: “Reasoning token support”                                                                             | **예**. 모델 페이지: “Reasoning token support”; reasoning 가이드가 Luna를 저비용 reasoning 선택지로 명시                                                                                       |
| 지원 effort           | `none`, `low`, `medium`, `high`, `xhigh`                                                                                   | `none`, `low`, `medium`, `high`, `xhigh`, `max`                                                                                                                                                |
| effort 기본값         | **`none`** (모델 페이지에 `(default)`)                                                                                     | **`medium`** (GPT-5.6 가이드: omitted 시 standard/pro 모두 medium)                                                                                                                             |
| `temperature` 조건    | GPT-5.4는 **effort=`none`일 때만** `temperature`, `top_p`, `logprobs` 지원. 그 외 effort와 함께 보내면 오류                | GPT-5.6 공식 가이드는 effort 계약은 명시하지만 `temperature` 호환 조건을 명시하지 않음. generic Chat Completions 스키마의 0–2 설명만으로 Luna 지원을 단정할 수 없으므로 **미확인/전송 비권장** |
| Responses API         | **지원**: `v1/responses`                                                                                                   | **지원**: `v1/responses`                                                                                                                                                                       |
| Chat Completions      | **지원**: `v1/chat/completions`                                                                                            | **지원**: `v1/chat/completions`                                                                                                                                                                |
| reasoning API 권장    | 지원은 둘 다 하지만 OpenAI는 reasoning 모델에 Responses API가 더 좋은 intelligence/performance를 제공한다고 설명           | 동일. GPT-5.6 가이드는 reasoning·tool calling·multi-turn에 Responses API 사용을 권고                                                                                                           |
| Text 가격             | input **$0.20**, cached input **$0.02**, output **$1.25**                                                                  | input **$1.00**, cached input **$0.10**, output **$6.00**; cache write **$1.25**                                                                                                               |
| 장문/지역 추가 요금   | data residency eligible regional endpoint **10% uplift**                                                                   | 입력이 **272K 초과**면 요청 전체에 input **2×**, output **1.5×**; cache write는 uncached input의 **1.25×**                                                                                     |
| Free tier             | 모델 페이지 rate limits: **Not supported**                                                                                 | 모델 페이지 rate limits: **Not supported**                                                                                                                                                     |
| 상태                  | 공식 catalog/detail/pricing에 현재 제공되고 dated snapshot 존재; Preview/Deprecated 표기 없음. 단, 별도 “GA” 문구는 미확인 | 공식 catalog/detail/pricing에 현재 제공되고 Preview/Deprecated 표기 없음. 단, 별도 “GA” 문구 및 dated snapshot은 미확인                                                                        |
| 공식 주용도           | classification, data extraction, ranking, sub-agents 같은 단순 고용량 작업                                                 | cost-sensitive, high-volume workload; 이전 GPT-5 family의 nano tier에 대략 대응                                                                                                                |
| 번역 특화 여부        | **아니오**                                                                                                                 | **아니오**                                                                                                                                                                                     |
| EN→KO 직접 근거       | **없음/미확인**                                                                                                            | **없음/미확인**                                                                                                                                                                                |

## 인용 가능한 공식 근거

### 1) GPT-5.4 Nano 모델 페이지

공식 URL: https://developers.openai.com/api/docs/models/gpt-5.4-nano

- 용도: **“GPT-5.4 nano is designed for tasks where speed and cost matter most like classification, data extraction, ranking, and sub-agents.”**
- effort: **“Reasoning.effort supports: none (default), low, medium, high and xhigh.”**
- reasoning: **“Reasoning token support”**
- endpoint: **“Chat Completions v1/chat/completions”**, **“Responses v1/responses”**
- snapshot: alias `gpt-5.4-nano`, 고정 ID `gpt-5.4-nano-2026-03-17`
- 가격: input `$0.20`, cached input `$0.02`, output `$1.25`

### 2) GPT-5.6 Luna 모델 페이지

공식 URL: https://developers.openai.com/api/docs/models/gpt-5.6-luna

- 용도: **“GPT-5.6 Luna is designed for cost-sensitive, high-volume workloads. It roughly corresponds to the nano model tier used in earlier GPT-5 families.”**
- reasoning: **“Reasoning token support”**
- endpoint: **“Chat Completions v1/chat/completions”**, **“Responses v1/responses”**
- 가격: input `$1.00`, cached input `$0.10`, output `$6.00`
- 장문: **“Prompts with >272K input tokens are priced at 2x input and 1.5x output for the full request.”**
- snapshot 영역에는 `gpt-5.6-luna`만 표시되어 별도의 날짜 고정 snapshot을 확인할 수 없다.

### 3) GPT-5.6 모델 가이드

공식 URL: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6

- 모델 선택: **“Use gpt-5.6-sol for frontier capability, gpt-5.6-terra for a balance of intelligence and cost, or gpt-5.6-luna for efficient, high-volume workloads.”**
- effort: **“GPT-5.6 supports none, low, medium, high, xhigh, and max.”**
- 기본값: **“If you omit it, GPT-5.6 defaults to medium in both standard and pro modes.”**
- API 권고: **“Use the Responses API for reasoning, tool-calling, and multi-turn workflows.”**

### 4) GPT-5.4 모델 가이드 — sampling parameter 계약

공식 URL: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4

- **“The following parameters are only supported when using GPT-5.4 with reasoning effort set to none: temperature, top_p, logprobs.”**
- 문서는 다른 effort로 이 필드들을 보내면 오류가 난다고 명시한다.

### 5) Reasoning 가이드

공식 URL: https://developers.openai.com/api/docs/guides/reasoning

- **“Reasoning models work better with the Responses API. While the Chat Completions API is still supported, you’ll get improved model intelligence and performance by using Responses.”**
- effort 값은 모델별이며 낮을수록 속도/토큰을 우선하고 높을수록 더 완전하게 생각한다고 설명한다.
- Luna를 낮은 비용·지연 선택지로 제시하지만 번역 특화라고 부르지는 않는다.

### 6) 모델 catalog — multilingual 범위

공식 URL: https://developers.openai.com/api/docs/models

- **“All latest OpenAI models support text and image input, text output, multilingual capabilities, and vision.”**
- 이는 번역 가능성의 **간접 근거**일 뿐, EN→KO 번역 품질이나 번역 특화의 직접 근거는 아니다.

### 7) 가격과 deprecation

- 가격: https://developers.openai.com/api/docs/pricing
- deprecations: https://developers.openai.com/api/docs/deprecations

공식 deprecations 표는 `gpt-4.1-nano | gpt-4.1-nano-2025-04-14`의 shutdown을 **2026-10-23**, 권장 대체를 **`gpt-5.6-luna`**로 표시한다. 이 표는 lifecycle migration 근거이지 번역 benchmark가 아니다.

## “번역 추론 모델” 표현 판정

| 표현                                        | 정확성        | 이유                                                                                                                            |
| ------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| “번역 추론 모델”                            | **비권장**    | OpenAI 공식 문서는 두 모델을 번역 특화로 분류하지 않는다. reasoning과 multilingual capability를 섞어 번역 전용처럼 들리게 한다. |
| “번역에 사용할 수 있는 범용 reasoning 모델” | **정확**      | 공식 reasoning 지원 + multilingual text capability를 모두 반영한다.                                                             |
| “EN→KO에 최적화된 모델”                     | **근거 없음** | 공식 EN→KO 평가·권고·benchmark 미확인                                                                                           |
| “GPT-4.1 Nano의 공식 후속 번역 모델”        | **부정확**    | Luna는 deprecated 모델의 공식 API 교체 대상이지만 ‘번역 후속’이라는 공식 명칭/근거는 없다.                                      |

주의: 모델 페이지 endpoint 표의 `v1/realtime/translations` 또는 `v1/audio/translations` 노출은 해당 범용 텍스트 모델이 번역 특화라는 증거가 아니다. endpoint 목록과 모델의 주용도/품질 근거는 분리해야 한다.

## b3rys-translate 추천 설정

### A. `gpt-5.4-nano` — 저비용/저지연 번역 후보

현행 Chat Completions 요청을 최소 변경으로 검토한다면:

```json
{
  "model": "gpt-5.4-nano",
  "messages": ["..."],
  "reasoning_effort": "none",
  "temperature": 0.1
}
```

- `temperature`를 유지할 경우 effort는 **반드시 `none`**.
- 모델 자체 기본값도 `none`이지만, 계약을 명확히 하려면 effort를 명시하는 편이 안전하다.
- 분류/추출형 성격과 가격에는 맞지만 번역 품질 우위는 실측해야 한다.

Responses API로 옮길 경우 모델 ID는 동일하고 reasoning은 `{"effort":"none"}` 형태다. 단, 이번 작업은 코드 변경을 하지 않았다.

### B. `gpt-5.6-luna` — 공식 lifecycle 교체 후보

권장 검증 시작점:

```json
{
  "model": "gpt-5.6-luna",
  "reasoning": { "effort": "low" },
  "input": "..."
}
```

- **Responses API 권장**.
- 번역은 복잡한 reasoning이 핵심인 작업이 아니므로 먼저 `low`를 latency/quality 절충점으로 벤치하고, `none`도 비교한다.
- effort를 생략하면 `medium`이므로 reasoning token·latency·비용이 의도치 않게 늘 수 있다.
- `temperature`는 GPT-5.6 Luna의 명시적 공식 호환 조건을 찾지 못했으므로 **보내지 않는다**.
- 현행 `$0.20/$1.25`인 5.4 Nano 대비 Luna의 `$1/$6`은 input **5×**, output **4.8×**다. 번역 품질이 비용을 정당화하는지 실제 corpus로 확인해야 한다.

## 채택 권고

| 모델           | 권고                                  | 근거                                                                                                          |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `gpt-5.4-nano` | **후보 유지 + manual benchmark**      | 계약과 가격은 명확하고 기존 `temperature: 0.1`도 effort `none`이면 호환. 다만 EN→KO 직접 근거 없음            |
| `gpt-5.6-luna` | **공식 교체 후보 + manual benchmark** | `gpt-4.1-nano`의 공식 lifecycle replacement이며 더 큰 reasoning 범위 제공. 그러나 비싸고 EN→KO 직접 근거 없음 |

두 모델을 UI에 노출한다면 reasoning 유무가 아니라 **실제 번역 품질·지연·형식 보존·비용**으로 등급을 정해야 한다. 최소 검증 항목은 일반 문단, 기술 문서, 대화/존댓말, YouTube 자막, 고유명사, JSON/segment ID 보존, 누락·환각, 실제 reasoning/output token 및 latency다.

## 미확인 및 제한

1. **EN→KO 공식 benchmark 없음:** BLEU/COMET/chrF, 인간 선호, 한국어 자연스러움, GPT-4.1 Nano 대비 직접 비교를 공식 문서에서 확인하지 못했다.
2. **Luna dated snapshot 없음:** 모델 페이지가 alias만 표시한다. 존재하지 않는 날짜형 ID를 추정해서는 안 된다.
3. **Luna `temperature` 계약 미확인:** generic Chat Completions API reference는 `temperature` 필드의 일반 스키마를 설명하지만, GPT-5.6 Luna와 reasoning effort 조합별 허용을 보장하지 않는다.
4. **엄격한 GA 선언 미확인:** 두 모델은 공식 catalog/detail/pricing에 제공되고 Preview/Deprecated 표기가 없지만 모델 페이지가 “GA”라는 상태 문자열을 직접 표시하지 않는다.
5. **실제 API 호출 없음:** API key/조직 tier의 모델 접근성, 200 응답, parser 호환, 실제 reasoning token 청구를 인증 호출로 확인하지 않았다.
6. **`openai.com/api/pricing/`는 이 환경에서 HTTP 403:** 수치는 정상 접속된 공식 개발자 pricing 및 모델 상세 페이지에서 교차 확인했다.

## 한 줄 결론

**GPT-5.4 Nano와 GPT-5.6 Luna는 모두 번역 가능한 범용 reasoning 모델이지 번역 특화 모델은 아니다.** 5.4 Nano는 `reasoning_effort=none` + `temperature=0.1`로 계약이 명확하고, Luna는 Responses API + 명시적 `low`/`none` effort + temperature 생략으로 검증하는 것이 안전하다. 최종 번역 모델 채택은 공식 자료만으로 확정할 수 없으며 EN→KO blind benchmark가 필요하다.
