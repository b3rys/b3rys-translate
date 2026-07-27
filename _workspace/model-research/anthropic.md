# Anthropic 상위 번역 모델 공식 검증

- **확인 시각:** 2026-07-27 16:57:03 KST (+0900)
- **대상:** b3rys-translate의 EN→KO Anthropic 엔진
- **현재 모델:** `claude-haiku-4-5-20251001`
- **현재 단가:** 입력 **$1 / 1M tokens**, 출력 **$5 / 1M tokens**
- **현재 요청:** `POST https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, `max_tokens: 8192`, user message 1개, thinking/sampling 파라미터 없음
- **검증 원칙:** gd-api-select의 verified selection을 출발점으로 삼되, 모델 ID·가격·상태·API 동작은 아래 Anthropic 공식 문서로 재검증했다. 실제 유료 API 호출이나 EN→KO 블라인드 평가는 수행하지 않았다.

## 판정 요약

**Claude Sonnet 4.6 (`claude-sonnet-4-6`)을 b3rys-translate의 “상위 품질 수동 옵션”으로 채택한다.** 현재 Haiku 4.5를 모든 사용자에 대해 즉시 대체하는 기본 모델 전환은 **보류**한다.

- 공식 문서상 Sonnet 4.6은 **Active**, deprecated 아님, Claude API에서 사용 가능한 고정 snapshot 모델이다.
- 가격은 **$3/$15 per MTok**으로 현재 Haiku 4.5 대비 입력·출력 모두 정확히 **3.0배**다.
- 현재 b3rys-translate Messages API 요청은 model 문자열만 바꿔도 계약상 호환된다. Sonnet 4.6은 요청에 `thinking`이 없으면 thinking이 꺼져 있으므로 현재의 `content[0].text` 파서와도 맞는다.
- Anthropic은 Claude의 multilingual 역량과 Sonnet 4.6의 전반적 성능·instruction-following 향상을 공식적으로 설명하지만, **Haiku 4.5 대비 EN→KO 번역 품질 우위를 직접 입증하는 공식 점수는 공개하지 않았다.** 따라서 상위 품질 옵션 채택은 타당하지만, 기본 전환 전에는 프로젝트 자체 번역 eval이 필요하다.
- 더 최신인 Sonnet 5는 현재 프로모션 단가가 **$2/$10**으로 명목상 2배라 매력적이지만, adaptive thinking이 기본 활성화되어 thinking block이 text block 앞에 온다. 현재 파서는 첫 block의 `.text`만 읽으므로 **현재 코드 그대로는 응답 호환성이 없다.** 따라서 현 시점 채택은 보류한다.

## 후보별 검증

### 1) Claude Sonnet 4.6 — 채택(상위 품질 옵션), 기본 전환 보류

| 필드                      | 공식 검증 결과                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **공식 URL**              | [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) · [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) · [Model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) · [Introducing Claude Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6) · [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) · [Get started](https://platform.claude.com/docs/en/get-started) |
| **확인 시각**             | 2026-07-27 16:57:03 KST (+0900)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Messages API model ID** | `claude-sonnet-4-6`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **ID 성격**               | 4.6 이후 dateless ID이지만 evergreen alias가 아니라 **고정된 canonical snapshot**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **가격**                  | 입력 **$3 / MTok**, 출력 **$15 / MTok** (base tokens, USD)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **GA/deprecated 상태**    | **Active / deprecated N/A**. Tentative retirement: **not sooner than 2027-02-17**. 출시 공지는 Claude API와 주요 cloud platform에서 사용 가능하다고 명시한다. Preview 표기가 없다.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **현재 요청 호환성**      | **호환.** 공식 기본 요청과 동일한 `POST /v1/messages`, `model`, `max_tokens`, `messages`, `x-api-key`, `anthropic-version` 구조다. 현재 요청은 thinking 및 비기본 sampling parameter를 쓰지 않는다. 공식 Thinking 문서상 Sonnet 4.6은 `thinking`을 명시하지 않으면 thinking이 꺼져 있어 응답의 첫 content block이 일반 text가 되는 현재 경로와 맞는다. `max_tokens: 8192`도 모델 허용 범위 안이다.                                                                                                                                                                                                   |
| **번역 근거**             | 공식 overview는 모든 current Claude model이 multilingual capability를 지원하며 current model들이 multilingual task에서 top-tier라고 설명한다. Sonnet 4.6 출시는 전반적 능력, consistency, instruction following이 향상되었고 benchmarks 전반에서 개선됐다고 설명한다. gd-api-select verified selection도 Sonnet 4.6을 “품질 우선/한국어 자연스러움” 후보로 둔다.                                                                                                                                                                                                                                     |
| **현재 대비 비용**        | 토큰 단가 기준 입력 `3/1 = 3.0배`, 출력 `15/5 = 3.0배`; 따라서 동일한 입력·출력 token 수라면 총비용도 정확히 **3.0배**다. 서로 다른 tokenizer/실제 출력 길이에 따른 실청구 배수는 별도 측정이 필요하다.                                                                                                                                                                                                                                                                                                                                                                                              |
| **채택/보류**             | **채택:** Anthropic의 상위 품질 수동 옵션. **보류:** Haiku 4.5를 대체하는 전면 기본값 변경은 EN→KO 블라인드 eval 전까지 보류. 또한 3배는 “조금 더 비쌈”을 엄격히 2배 이내로 해석하면 요구를 초과한다.                                                                                                                                                                                                                                                                                                                                                                                                |
| **미확인**                | Haiku 4.5와 Sonnet 4.6의 동일 EN→KO 세트 직접 비교, 한국어 고유명사/문체/누락률, 실제 latency, rate limit, 현재 API key의 Sonnet 4.6 entitlement, 실제 tokenizer에 따른 청구 배수.                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 2) Claude Sonnet 5 — 보류(후속 1순위)

| 필드                      | 공식 검증 결과                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **공식 URL**              | [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) · [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations) · [What's new in Claude Sonnet 5](https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5) · [Introducing Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5) · [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)                                               |
| **확인 시각**             | 2026-07-27 16:57:03 KST (+0900)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Messages API model ID** | `claude-sonnet-5`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **가격**                  | **2026-08-31까지:** 입력 **$2 / MTok**, 출력 **$10 / MTok**. **2026-09-01부터:** 입력 **$3 / MTok**, 출력 **$15 / MTok**.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **GA/deprecated 상태**    | **Active / deprecated N/A**. Tentative retirement: **not sooner than 2027-06-30**. 공식 출시는 Claude Platform/API에서 “available everywhere”라고 명시하며 preview/limited availability가 아니다.                                                                                                                                                                                                                                                                                                                                                                              |
| **현재 요청 호환성**      | **요청 schema는 호환하지만, 현재 응답 처리까지 안전하게 호환된다고 판정할 수 없다.** Sonnet 5는 동일 요청에서 adaptive thinking이 기본 활성화된다. 공식 Thinking 문서상 thinking content block은 text block보다 먼저 오며, 최신 모델의 기본 display가 omitted이어도 빈 thinking block 자체는 반환된다. 현재 구현은 `data.content?.[0]?.text`만 읽으므로 thinking이 발생한 요청에서 “Empty response” 오류가 날 수 있다. 채택하려면 최소한 `thinking: {type: "disabled"}` 명시 또는 `content`에서 `type === "text"` block 탐색이 필요하다. 이번 조사에서는 코드 수정하지 않았다. |
| **번역 근거**             | Sonnet 5는 공식적으로 Sonnet 4.6의 차세대/drop-in upgrade이며 reasoning·knowledge work 등에서 substantial improvement로 소개된다. 모든 current Claude model의 multilingual 지원 근거는 있다. 그러나 EN→KO 또는 Haiku 4.5 대비 번역 benchmark는 공식 문서에서 확인되지 않았다.                                                                                                                                                                                                                                                                                                  |
| **현재 대비 비용**        | 표시 단가 기준 프로모션 기간 입력·출력 모두 **2.0배**, 9월 1일부터 **3.0배**. 다만 공식 문서는 새 tokenizer가 같은 text를 Sonnet 4.6보다 대략 30% 더 많은 token으로 만들며 내용에 따라 약 1.0–1.35배라고 설명한다. Haiku와 tokenizer가 같다는 보장은 없으므로 실제 배수는 미측정이다. 단순 참고로 같은 token 증가 범위를 적용하면 프로모션 실효 범위는 약 **2.0–2.7배**, 표준가는 약 **3.0–4.05배**다. adaptive thinking token도 output으로 과금된다.                                                                                                                          |
| **채택/보류**             | **보류.** 가격·세대상 후속 1순위이나 현재 response parser와 비용 예측에 영향을 주는 기본 thinking 때문에 “model ID만 교체”할 수 없다. thinking 비활성화/파서 보강 후 EN→KO eval을 거치면 Sonnet 4.6 대신 우선 검토할 가치가 있다.                                                                                                                                                                                                                                                                                                                                              |
| **미확인**                | thinking을 끈 Sonnet 5의 EN→KO 품질/latency, Haiku 대비 실제 tokenizer 배수, 프로모션 종료 후 비용 수용성, 현 API key entitlement/rate limit.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## 현재 모델 기준선

| 필드               | 확인 결과                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **모델 ID**        | `claude-haiku-4-5-20251001`                                                                                            |
| **가격**           | 입력 $1 / MTok, 출력 $5 / MTok                                                                                         |
| **상태**           | Active, deprecated N/A, tentative retirement not sooner than 2026-10-15                                                |
| **프로젝트 위치**  | `utils/constants.ts`의 `ENGINE_MODELS.anthropic`, `ENGINE_PRICING.anthropic`; 요청 구현은 `utils/engines/anthropic.ts` |
| **응답 처리 제약** | `content[0].text`만 읽기 때문에 thinking block이 먼저 오는 모델은 그대로 교체할 수 없음                                |

## gd-api verified selection 재검증 결과

- gd-api-select의 **Claude Sonnet 4.6 / `$3/$15` / 품질 우선 번역 후보**는 공식 Anthropic 가격·ID·Active 상태와 일치한다.
- 다만 verified selection은 2026-06-28 기준이라 2026-06-30 공개된 **Sonnet 5**를 반영하지 못했다.
- Sonnet 5가 더 최신이고 프로모션 기간에는 더 저렴하지만, b3rys-translate의 현재 parser까지 고려하면 지금 즉시 쓸 수 있는 안전한 상위 후보는 **Sonnet 4.6**이다.
- 따라서 registry 관점에서는 Sonnet 5를 새 verified candidate로 추가 검토할 가치가 있으나, b3rys-translate의 현 채택 판정과는 분리해야 한다.

## 권장 검증 게이트

기본 모델 변경 전, 동일 prompt와 파싱 조건으로 Haiku 4.5 대 Sonnet 4.6을 최소 다음 항목에서 블라인드 비교한다.

1. 일반 웹 문단, 기술 문서, 구어체 자막, 관용구/고유명사를 포함한 EN→KO 세트
2. 의미 누락·추가, 수치/코드 보존, 한국어 자연스러움, 지시 형식 준수
3. 입력/출력 token, 요청당 비용, p50/p95 latency, parse 실패율
4. 품질 개선폭이 3배 비용을 정당화할 때만 기본 전환; 아니면 Haiku 기본 + Sonnet 수동 품질 옵션 유지

## 공식 URL 목록

1. https://platform.claude.com/docs/en/about-claude/models/overview
2. https://platform.claude.com/docs/en/about-claude/pricing
3. https://platform.claude.com/docs/en/about-claude/model-deprecations
4. https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
5. https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
6. https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5
7. https://platform.claude.com/docs/en/build-with-claude/thinking
8. https://platform.claude.com/docs/en/build-with-claude/working-with-messages
9. https://platform.claude.com/docs/en/get-started
10. https://www.anthropic.com/news/claude-sonnet-4-6
11. https://www.anthropic.com/news/claude-sonnet-5
