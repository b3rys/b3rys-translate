# OpenAI 상위 번역 모델 후보 공식 검증

- **대상 프로젝트:** `b3rys-translate` (EN → KO 고정)
- **공식 확인 시각:** 2026-07-27 16:54:48 KST (+0900)
- **판정 기준:** OpenAI 공식 모델 문서 + 공식 API pricing + 공식 deprecations. 프로젝트의 현재 OpenAI 호출 형태(`/v1/chat/completions`, `temperature: 0.1`)도 읽어 대조했다.
- **코드 수정:** 없음

## 결론

**요청 후보 `gpt-5.4-nano`는 실제로 제공되고 가격과 Chat Completions 지원도 확인되지만, b3rys-translate의 EN→KO 상위 번역 옵션으로는 현재 `보류(추가 X)`가 타당하다.** 공식 자료에 EN→KO 번역 품질 또는 `gpt-4.1-nano` 대비 번역 향상을 입증하는 결과가 없고, 비용은 현재보다 input **2배**, output **3.125배**이기 때문이다. 존재성·API 호환성 검증은 통과했지만 번역 품질 채택 근거는 통과하지 못했다.

다만 현재 `gpt-4.1-nano`는 공식적으로 **deprecated**, **2026-10-23 shutdown 예정**이다. 따라서 현행 모델을 계속 장기 기본값으로 두는 것도 불가하다. OpenAI가 표준 `gpt-4.1-nano`의 공식 대체 모델로 안내하는 것은 `gpt-5.6-luna`이지만, 이 모델 역시 공식 EN→KO 근거가 없고 현재 대비 훨씬 비싸므로 별도 실측 벤치 후 교체해야 한다.

## 공식 URL

1. 모델 카탈로그: https://developers.openai.com/api/docs/models
2. GPT-5.4 nano: https://developers.openai.com/api/docs/models/gpt-5.4-nano
3. GPT-5.4 mini: https://developers.openai.com/api/docs/models/gpt-5.4-mini
4. GPT-4.1 nano: https://developers.openai.com/api/docs/models/gpt-4.1-nano
5. GPT-5.6 Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
6. 공식 API 가격: https://developers.openai.com/api/docs/pricing
7. 공식 deprecations: https://developers.openai.com/api/docs/deprecations
8. GPT-5.4 모델 가이드/파라미터 호환성: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4
9. 제품 API pricing 별도 URL: https://openai.com/api/pricing/ — 이번 환경의 직접 요청은 HTTP 403이었으므로 수치 근거는 접근 성공한 개발자 공식 pricing(6번)과 각 모델 페이지를 교차 사용했다.

## 후보별 검증표

가격은 Standard API의 **USD / 1M text tokens**이다. cached input은 참고값이며 현재 프로젝트 비용 계산은 uncached input/output 기준이다.

| 역할                  | 정확한 API model ID                                 | 가격 (input / cached / output) | 상태                                                                                | Chat Completions                                                 | 공식 번역 근거                                                                             | 현재 대비 비용                                                             | 판정                            |
| --------------------- | --------------------------------------------------- | -----------------------------: | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------- |
| 현재 기준선           | `gpt-4.1-nano` (snapshot `gpt-4.1-nano-2025-04-14`) |       `$0.10 / $0.025 / $0.40` | **Deprecated**; 공식 shutdown `2026-10-23`                                          | 지원: `v1/chat/completions`                                      | 텍스트 입출력, instruction following 강점은 명시. EN→KO 전용 결과 없음                     | 1.0×                                                                       | **유지 불가(교체 계획 필요)**   |
| 사용자 요청 후보      | `gpt-5.4-nano` (snapshot `gpt-5.4-nano-2026-03-17`) |        `$0.20 / $0.02 / $1.25` | 일반 제공 모델로 판단: 모델 페이지·고정 snapshot 존재, Preview/Deprecated 표기 없음 | 지원: `v1/chat/completions`; streaming·structured outputs도 지원 | 공식 설명은 속도/비용 중심의 분류·추출·랭킹·sub-agent 용도. EN→KO 또는 번역 우위 자료 없음 | input **2.0×**, output **3.125×**; input:output 토큰이 1:1이면 총 **2.9×** | **보류 / 추가 X**               |
| 품질 상위 비교 후보   | `gpt-5.4-mini` (snapshot `gpt-5.4-mini-2026-03-17`) |       `$0.75 / $0.075 / $4.50` | 일반 제공 모델로 판단: 모델 페이지·고정 snapshot 존재, Preview/Deprecated 표기 없음 | 지원: `v1/chat/completions`                                      | GPT-5.4 강점을 고용량 워크로드에 제공한다는 일반 설명뿐. EN→KO 결과 없음                   | input **7.5×**, output **11.25×**; 1:1이면 **10.5×**                       | **보류 / 추가 X**               |
| OpenAI 공식 교체 지목 | `gpt-5.6-luna`                                      |        `$1.00 / $0.10 / $6.00` | 일반 제공; Preview/Deprecated 표기 없음                                             | 지원: `v1/chat/completions`                                      | 비용 민감·고용량 workload 및 이전 nano tier 대응이라는 설명. EN→KO 결과 없음               | input **10×**, output **15×**; 1:1이면 **14×**                             | **즉시 채택 X; 교체 벤치 대상** |

### 상태 판정 주의

OpenAI 모델 페이지가 `gpt-5.4-nano`/`mini`에 별도 “GA” 문자열을 표시하지는 않는다. 따라서 여기서 “일반 제공”은 **공식 모델 페이지, alias, 날짜 고정 snapshot, rate limits가 존재하고 Preview/Deprecated 표기가 없다는 사실**에 근거한 판정이다. 엄격히 말해 OpenAI가 페이지에서 “GA”라고 직접 선언한 문구는 미확인이다.

## Chat Completions 및 현행 코드 호환성

현재 프로젝트는 다음 형태다.

- endpoint: `https://api.openai.com/v1/chat/completions`
- body 핵심: `model`, `messages`, `temperature: 0.1`
- 응답: `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`

공식 모델 페이지에서 `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.6-luna` 모두 **Chat Completions `v1/chat/completions` 지원**이 명시된다. GPT-5.4 모델 가이드는 `temperature`, `top_p`, `logprobs`가 **reasoning effort = `none`일 때만 지원**된다고 명시한다. `gpt-5.4-nano` 모델 페이지는 `reasoning.effort`의 기본값을 `none`으로 표시하므로 현재의 `temperature: 0.1` 요청은 공식 문서상 호환되는 조합으로 판단된다.

단, 이번 조사는 API key를 사용한 실제 유료 호출을 하지 않았으므로 다음은 실호출 미확인이다.

- 현재 payload 그대로 `gpt-5.4-nano`가 200 응답하는지
- 응답 JSON 및 usage 필드가 프로젝트 parser와 완전히 동일한지
- 조직/usage tier에서 모델 접근 권한이 열려 있는지
- reasoning token이 번역 비용·출력 안정성에 미치는 실제 영향

## 번역 적합성 판단

### 공식적으로 확인된 것

- `gpt-5.4-nano`는 text input/output을 지원한다.
- 속도와 비용이 중요한 간단한 작업용이며, 공식 예시는 classification, data extraction, ranking, sub-agents다.
- 400K context, 최대 128K output, reasoning effort `none` 기본값을 지원한다.
- `gpt-5.4-mini`는 GPT-5.4 강점을 더 빠르고 효율적인 고용량 workload에 제공한다고 설명한다.
- 현재 `gpt-4.1-nano`는 instruction following과 낮은 지연이 강점이나 deprecated 상태다.

### 공식적으로 확인되지 않은 것

- EN→KO 번역 점수, 인간 평가, COMET/BLEU/chrF 등
- 한국어 자연스러움·존댓말·고유명사·문단/자막/단어 모드별 정확도
- `gpt-5.4-nano`가 `gpt-4.1-nano`보다 번역 품질이 높다는 직접 비교
- `gpt-5.4-mini` 또는 `gpt-5.6-luna`가 가격 상승분만큼 번역이 개선된다는 근거
- b3rys-translate의 JSON/ID 보존, segmentation, subtitle context, 다국어 target 옵션에 대한 실제 성공률

따라서 일반 text capability를 번역 품질 보장으로 확대 해석하지 않았다. 제3자 benchmark도 이번 최종 판정 근거에는 사용하지 않았다.

## 현재 대비 비용 계산

현재 `gpt-4.1-nano` 비용을

`0.10 × input_MTok + 0.40 × output_MTok`

이라고 하면 `gpt-5.4-nano`는

`0.20 × input_MTok + 1.25 × output_MTok`

이다. 번역의 실제 input/output 토큰 비율에 따라 총 배수는 달라진다. input과 output이 같은 토큰 수라는 단순 예시에서 `(0.20 + 1.25) / (0.10 + 0.40) = 2.9배`다. 한국어 토큰화와 프롬프트/JSON overhead 때문에 이 1:1 예시는 실제 관측값이 아니며, 프로젝트 usage 로그로 재계산해야 한다.

## 최종 채택 판정

### `gpt-5.4-nano`: **보류 (현 시점 추가 X)**

- 통과: 공식 제공 여부, 정확한 model ID, 가격, 일반 제공 상태 추정, Chat Completions endpoint 호환성.
- 실패/미충족: EN→KO 품질 우위의 공식 근거.
- 비용: 현재보다 input 2×, output 3.125×.
- 따라서 “상위 번역 모델”이라는 제품 옵션으로 노출할 근거가 부족하다.

### 후속 권고

코드 변경 전에 고정된 실제 문장 세트로 최소 비교를 해야 한다.

1. 후보: `gpt-4.1-nano`, `gpt-5.4-nano`, 공식 교체 지목 `gpt-5.6-luna` (비용 허용 시 `gpt-5.4-mini`).
2. 케이스: 일반 문단, 기술 문서, 대화/존댓말, YouTube 자막, 단어 팝업, JSON ID 보존.
3. 지표: blind human preference, 의미 누락/환각, 고유명사, 형식 파손률, latency, 실제 input/output token 및 문단당 비용.
4. 채택 조건 예시: `gpt-5.4-nano`가 품질에서 명확히 우세하고 형식 안정성이 동등 이상이며 약 2.9× 안팎의 실비 상승을 제품상 정당화할 때만 추가.
5. shutdown 전에 `gpt-4.1-nano` 교체를 별도 일정으로 확정한다.

## 미확인/제약

- `openai.com/api/pricing/`는 이번 환경에서 HTTP 403. 개발자 공식 pricing과 모델 페이지는 HTTP 200으로 확인했다.
- API key를 통한 실제 모델 목록 조회·샘플 번역 호출은 하지 않았다.
- 엄격한 “GA” 선언 문구는 찾지 못했다. 일반 제공 판정은 snapshot/alias/비-preview·비-deprecated 상태에 근거한다.
- 공식 EN→KO benchmark는 확인하지 못했다. 이것이 `추가 X`의 핵심 사유다.
