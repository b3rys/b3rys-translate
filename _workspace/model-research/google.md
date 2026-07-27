# Google 상위 번역 모델 후보 검증

## 결론

- **판정: 추가/교체 보류.** 현재 `gemini-3.1-flash-lite`를 유지한다.
- 가장 현실적인 상위 후보는 **`gemini-3.5-flash-lite`**다. GA이고, `generateContent`의 REST `v1beta`에서 사용할 수 있으며, 현재 대비 가격도 입력 **1.20배**, 출력 **1.67배**(입출력 토큰 수가 같다고 가정한 합산 **1.60배**)로 “조금 더 비싼” 범위다.
- 그러나 Google 공식 자료의 직접 근거는 “이전 Flash-Lite 세대보다 high-throughput execution에서 우수”, 추론·문서 이해·멀티턴 지시 준수 개선이다. **EN→KO 번역 품질을 직접 비교한 공식 점수나 서술은 없다.** 비용 상승을 정당화할 번역 특화 근거가 부족하므로 즉시 채택하지 않는다.
- 더 강한 GA 후보 **`gemini-3.6-flash`**는 현재 대비 입력 **6.0배**, 출력 **5.0배**(1:1 합산 **5.14배**)이며 Google이 제시한 주 용도도 agentic/coding/multimodal이다. 번역 품질 직접 근거 없이 이 비용은 과도하므로 제외한다.

## 확인 메타데이터

- **공식 사이트 확인 시각:** 2026-07-27 16:52:22 KST (+09:00)
- **프로젝트 현재 설정:**
  - 모델 ID: `gemini-3.1-flash-lite`
  - REST endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`
  - 확인 위치: `utils/constants.ts`
- **가격 기준:** Google Gemini API pricing의 Standard 요금, USD / 1M tokens. 출력 가격에는 thinking tokens가 포함된다.

## 공식 URL

1. 모델 목록: https://ai.google.dev/gemini-api/docs/models
2. Gemini API 가격: https://ai.google.dev/gemini-api/docs/pricing
3. generateContent용 최신 모델 안내: https://ai.google.dev/gemini-api/docs/generate-content/latest-model
4. `models.generateContent` REST 명세: https://ai.google.dev/api/generate-content
5. Gemini API 릴리스 노트: https://ai.google.dev/gemini-api/docs/changelog
6. `gemini-3.1-flash-lite` 모델 문서: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
7. `gemini-3.5-flash-lite` 모델 문서: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
8. `gemini-3.6-flash` 모델 문서: https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash

위 페이지들은 확인 시점에 모두 HTTP 200으로 실제 접속했다. 릴리스 노트에는 2026-07-21자로 `gemini-3.6-flash`와 `gemini-3.5-flash-lite`의 GA 출시가 명시되어 있다.

## 후보 비교

| 구분          | 정확한 API 모델 ID      | 상태                       | Standard input | Standard output | Free tier                                          | 현재 대비 비용                              | `v1beta :generateContent` | 번역 품질 근거                                                                                                                                                         | 판정     |
| ------------- | ----------------------- | -------------------------- | -------------: | --------------: | -------------------------------------------------- | ------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 현재          | `gemini-3.1-flash-lite` | Stable / GA                |          $0.25 |           $1.50 | 있음: pricing 표에서 input/output “Free of charge” | 1.00× / 1.00×                               | 사용 중                   | Google 모델 문서가 Translation을 명시적 사용 사례로 제시: 빠르고 저렴한 대량 번역                                                                                      | **유지** |
| 1순위 후보    | `gemini-3.5-flash-lite` | Stable / GA, 2026-07-21 GA |          $0.30 |           $2.50 | 있음: input/output “Free of charge”                | input 1.20× / output 1.67× / 1:1 합산 1.60× | 지원                      | Google은 이전 Flash-Lite 세대 대비 전반적 우수, 향상된 reasoning·document understanding·3.1 대비 multi-turn instruction following 개선을 명시. 단, 번역 직접 비교 없음 | **보류** |
| 상위 품질군   | `gemini-3.6-flash`      | Stable / GA, 2026-07-21 GA |          $1.50 |           $7.50 | 있음: input/output “Free of charge”                | input 6.00× / output 5.00× / 1:1 합산 5.14× | 지원                      | Google은 speed와 intelligence의 균형, instruction following 및 복합 agentic/multimodal 성능을 강조. 번역 직접 비교 없음                                                | **제외** |
| 비교상 불필요 | `gemini-3.5-flash`      | Stable / GA                |          $1.50 |           $9.00 | 있음                                               | input 6.00× / output 6.00× / 1:1 합산 6.00× | 지원 계열                 | 번역 직접 근거 없음. `gemini-3.6-flash`가 같은 입력 가격, 더 낮은 출력 가격의 후속 상위 선택지                                                                         | **제외** |

### 비용 배수 계산 기준

- 현재: input `$0.25`, output `$1.50` / 1M tokens.
- `gemini-3.5-flash-lite`: `$0.30 / $0.25 = 1.20×`, `$2.50 / $1.50 = 1.67×`.
- `gemini-3.6-flash`: `$1.50 / $0.25 = 6.00×`, `$7.50 / $1.50 = 5.00×`.
- “1:1 합산”은 입력 1M + 출력 1M처럼 **입출력 토큰 수가 같을 때만** 적용한 비교다. 실제 EN→KO 사용량 비율에 따라 총비용 배수는 달라진다.

## `generateContent v1beta` 호환성

### 공식 확인

- REST 명세의 endpoint는 `POST https://generativelanguage.googleapis.com/v1beta/{model=models/*}:generateContent`다.
- Google의 **generateContent API 버전** 최신 모델 문서는 `gemini-3.6-flash`와 `gemini-3.5-flash-lite`를 GA/production-ready로 명시한다.
- 같은 문서의 REST quickstart가 `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`를 직접 제시한다. 따라서 기존 프로젝트의 endpoint 형태와 호환된다.

### 프로젝트에 중요한 조건

- Google은 `gemini-3.6-flash`와 `gemini-3.5-flash-lite`부터 `temperature`, `top_p`, `top_k`를 deprecated로 규정했다. 현재는 무시되며 향후 모델 세대에서는 해당 파라미터가 있으면 HTTP 400을 반환할 수 있으므로 제거하라고 안내한다.
- b3rys-translate의 `utils/engines/gemini.ts`는 현재 `generationConfig.temperature: 0.1`을 전송한다.
- 따라서 **endpoint 및 호출 방식은 호환되지만 현재 payload의 장기적 완전 호환은 아니다.** 후보 채택 시 모델 ID만 바꾸는 것보다 `temperature` 제거 검토가 필요하다. 이번 작업에서는 코드 수정 금지 조건에 따라 수정하지 않았다.

## 번역 품질 근거 평가

### 현재 모델의 강한 직접 근거

Google의 `gemini-3.1-flash-lite` 모델 문서는 이 모델의 적합 사용 사례로 **Translation**을 직접 들고, chat messages/reviews/support tickets의 빠르고 저렴한 대량 번역을 예시로 제공한다. 즉, 현재 선택에는 번역 목적의 공식 직접 근거가 있다.

### `gemini-3.5-flash-lite`의 간접 근거

Google 공식 문서가 제시한 개선점:

- “Outperforms prior Flash-Lite generations for high-throughput execution.”
- reasoning 및 multimodal benchmark 향상.
- document parsing/structured extraction 정확도 개선.
- `gemini-3.1-flash-lite` 대비 multi-turn instruction following/persona consistency 개선.

이 특성들은 번역 중 지시 준수·문맥 처리 개선 가능성을 시사하지만, **번역 자체의 정확도·자연스러움·EN→KO 평가를 증명하지는 않는다.** “상위 번역 품질”은 현재 공식 근거만으로 확정할 수 없다.

### `gemini-3.6-flash`의 간접 근거

Google은 더 강한 agentic/multimodal 성능과 better instruction following을 명시하지만, 주 사용 사례는 coding, spatial/multimodal reasoning, multi-step agentic workflow다. 번역 직접 근거가 없고 가격 상승이 크므로 번역 기본 모델 후보로는 부적합하다.

## 채택/보류 결정

### 최종 결정: `gemini-3.5-flash-lite` 추가 보류

**stop rule 적용:** 아래 중 하나면 자동 추가하지 않는다.

1. GA가 아니거나 preview-only → 이번 1순위 후보에는 해당 없음.
2. `generateContent v1beta` 미지원 → 해당 없음.
3. 현재 대비 과도하게 비쌈 → 3.5 Flash-Lite는 해당 없음; 3.6 Flash는 해당.
4. **번역 품질 우위 근거가 애매함 → 3.5 Flash-Lite와 3.6 Flash 모두 해당.**

따라서 현재 모델은 유지하고, `gemini-3.5-flash-lite`는 **verified candidate / manual benchmark 필요** 상태로 둔다. 실제 채택 조건은 동일한 EN→KO 코퍼스로 현재 모델과 블라인드 A/B 평가를 수행해 품질 개선이 확인되는 것이다.

권장 후속 검증(이번 조사 범위 밖): 뉴스/기술문서/대화체/관용구/HTML 혼합 샘플을 포함한 EN→KO 세트에서 누락, 고유명사, 문체 자연스러움, 원문 충실도, 출력 오염을 비교하고, 실제 `usageMetadata` 기준 총비용과 latency도 함께 측정한다.

## 미확인 / 한계

- Google 공식 문서에는 확인 시점 기준으로 `gemini-3.5-flash-lite` 또는 `gemini-3.6-flash`의 **EN→KO 번역 전용 벤치마크**가 없었다.
- Free tier의 존재는 pricing 표에서 확인했으나, 계정/프로젝트별 RPM·TPM·RPD 한도는 이 보고서에서 확정하지 않았다. 실제 한도는 AI Studio 프로젝트의 적용 rate limit/tier에 좌우될 수 있다.
- API 키 없이 실제 생성 호출은 수행하지 않았다. 모델 존재·상태·호환성은 Google의 공식 모델/가격/generateContent 문서로 검증했다.
- 가격표의 Batch/Flex/Priority 요금은 비교에서 제외하고 Standard만 사용했다.
- 이 보고서는 조사 결과만 기록했으며 소스 코드는 수정하지 않았다.
