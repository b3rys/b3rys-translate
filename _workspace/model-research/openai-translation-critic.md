# GPT-5.4 Nano vs GPT-5.6 Luna 번역 품질·제품 포지셔닝 적대 검증

- 조사 대상: b3rys-translate의 EN→KO 웹페이지·YouTube 자막 번역
- 공식 문서 확인 시각: 2026-07-27 17:12 KST (+0900)
- 조사 경계: 연구 문서만 작성, 코드 수정 없음
- 증거 등급: **직접**(EN→KO 번역 자체 평가), **간접**(일반 모델 능력/제품 설명), **미확인**(실측 없음)

## 1. 최종 판정

### 한 줄 결론

**두 모델 중 저비용 후보는 `gpt-5.4-nano`지만, `gpt-5.6-luna`를 “고품질 번역” 옵션으로 부를 공개 근거는 없다.** Luna는 공식적으로도 “cost-sensitive, high-volume” 및 과거 nano tier 대응 모델로 소개될 뿐 번역 품질 모델로 포지셔닝되지 않는다. Luna가 nano보다 약 4.8배 비싸다는 사실은 품질 우위를 증명하지 않는다.

| 모델           | 공식 제품 포지셔닝                                                   | EN→KO 직접 증거 | 두 모델 내 제품 라벨                                                      | 기본/수동 권고                                                          | 불확실성 |
| -------------- | -------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| `gpt-5.4-nano` | GPT-5.4 계열 최저가, 단순 대량 작업; 예시는 분류·추출·랭킹·sub-agent | **없음/미확인** | **“OpenAI 저비용 (실험)”**. “번역 중급/고품질” 표기 금지                  | **두 후보 중 조건부 기본 벤치 후보**. 현재 제품 기본값 자동 교체는 금지 | 높음     |
| `gpt-5.6-luna` | 비용 민감·대량 workload, 과거 GPT-5 nano tier에 대략 대응            | **없음/미확인** | **“OpenAI 상위 비교 (실험)”** 또는 “Luna (수동)”. “고품질 번역” 표기 금지 | **수동 A/B 후보만**. 품질·형식·지연 gate 통과 전 기본값 금지            | 높음     |

**stop-rule 판정:**

1. 제품 라벨: Nano=`저비용(실험)`, Luna=`상위 비교(실험)`; 번역 품질 등급은 둘 다 미확정.
2. 기본 추천: 둘 중 하나를 시험 기본 후보로 둬야 한다면 **Nano + reasoning none**. 단, gd-api-select 정본상 현재 자동 기본 번역 모델을 대체하지 않는다.
3. 수동 추천: Luna는 **품질 실측용 수동 후보**. 실측 우위가 없으면 제외.
4. 불확실성: **높음**. 공식 EN→KO benchmark, 신뢰 가능한 공개 head-to-head, 이 앱 payload의 유료 실호출이 모두 없다.

## 2. gd-api-select 정본과의 충돌 검증

먼저 읽은 정본은 다음 두 파일이다.

- `/Users/gd452/Development/b3rys-private/claude/skills/gd-api-select/SKILL.md`
- `/Users/gd452/Development/b3rys-private/claude/skills/gd-api-select/references/benchmark-verified-selection.md` (2026-06-28)

정본의 verified selection은 텍스트 번역 기본값을 `gemini-2.5-flash-lite`, 품질 비교 후보를 `claude-sonnet-4-6`으로 둔다. 또한 **registry에 없는 모델명·가격·preview 이름은 자동 선택 근거로 쓰지 말라**고 명시한다. `gpt-5.4-nano`와 `gpt-5.6-luna`는 verified selection의 검증된 모델 표에 없다. 따라서 둘 중 어느 것도 현재 정본 기준 자동 기본값이 아니다.

상세 `benchmark.md`에는 Nano를 EN→KO 품질 “중”, latency “~1–2s”로 적은 행이 있지만, 해당 품질·지연 수치의 시험 세트, 표본 수, 평가자, 점수, 분산, 출처가 제시되지 않는다. 게다가 스킬 자체가 verified selection과 충돌하면 verified selection을 우선하라고 한다. **따라서 그 “중” 라벨과 latency 추정은 채택 증거로 사용할 수 없다.** Luna는 상세 번역 표에도 없다.

## 3. 공식 OpenAI 문서에서 실제로 확인된 것

### 3.1 존재·가격·제품 설명

표준 가격은 USD / 1M text tokens이다.

| 항목                       |                 `gpt-5.4-nano` |                                  `gpt-5.6-luna` | 적대적 해석                                  |
| -------------------------- | -----------------------------: | ----------------------------------------------: | -------------------------------------------- |
| input                      |                          $0.20 |                                           $1.00 | Luna 5.0배                                   |
| cached input               |                          $0.02 |                                           $0.10 | Luna 5.0배                                   |
| output                     |                          $1.25 |                                           $6.00 | Luna 4.8배                                   |
| 1:1 input:output 단순 혼합 |                          $1.45 |                                           $7.00 | Luna 약 4.83배                               |
| context                    |                           400K |                                           1.05M | 번역 품질이 아니라 용량 우위                 |
| max output                 |                           128K |                                            128K | 본 앱의 짧은 batch에는 차별점이 거의 없음    |
| 공식 설명                  | 단순·고용량, speed/cost 최우선 | cost-sensitive·high-volume, 과거 nano tier 대응 | 둘 다 공식 “translation quality” 모델이 아님 |

Luna는 입력이 272K를 넘으면 **전체 요청에 input 2배, output 1.5배** 장문 가격이 적용된다. 현재 앱은 문단/자막 소규모 batch이므로 보통 해당하지 않지만, 1.05M context 자체를 저가 장점처럼 홍보하면 안 된다.

Nano에는 alias와 날짜 고정 snapshot `gpt-5.4-nano-2026-03-17`가 있다. Luna 공식 페이지에는 alias 목록이 반복 표기되지만 조사 시점에 별도의 날짜 고정 snapshot 문자열은 확인하지 못했다. 장기 회귀 재현성 면에서 확인이 필요하다.

### 3.2 공식 교체 신호도 “번역 우위”는 아니다

OpenAI deprecations 문서는 deprecated `gpt-4.1-nano`의 2026-10-23 대체로 `gpt-5.6-luna`를 지정한다. 한편 GPT-5.4 model guidance는 `gpt-4.1-nano`의 좋은 대체로 prompt tuning한 `gpt-5.4-nano`를 말한다. 이는 문서 시점·제품 세대가 다른 일반 마이그레이션 신호이며, **Luna 또는 Nano의 EN→KO 품질 우위 증거가 아니다.** 최신 deprecation 운영 경로는 Luna지만, 번역 제품 선택은 별도 eval이 필요하다.

### 3.3 API 호환성: Nano는 거의 drop-in, Luna는 조건부

현재 앱은 다음 요청 형태를 사용한다.

- endpoint: `POST https://api.openai.com/v1/chat/completions`
- body: `model`, 단일 user `messages`, `temperature: 0.1`
- parser: `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`
- 출력 계약: `[N]` 번호, HTML tag/attribute 보존, 설명 금지

두 공식 모델 페이지 모두 Chat Completions endpoint 지원을 표시한다. 그러나 모델 문자열만 바꾸면 된다고 단정할 수는 없다.

- **Nano:** 공식 페이지는 reasoning effort `none`을 기본값으로 표시한다. GPT-5.4 guidance는 `temperature`가 reasoning effort=`none`일 때만 지원된다고 명시한다. 따라서 현행 `temperature: 0.1`은 문서상 호환 가능성이 높다. 그래도 authenticated smoke test가 없어 **drop-in 확정은 아님**이다.
- **Luna:** GPT-5.6 guidance는 effort를 생략하면 기본 `medium`이라고 한다. 같은 문서에는 GPT-5.6에서 현행 Chat Completions + `temperature` 조합의 정확한 허용 조건이 명시적으로 확인되지 않았다. 따라서 현행 payload 그대로의 200 응답을 가정하면 안 된다. 최소한 **조건부 호환**으로 분류하고, `temperature: 0.1` 포함/제거 및 effort=`none`을 각각 실호출해야 한다.

이번 환경에는 `OPENAI_API_KEY`가 없어 모델 목록 조회나 유료 generation call을 수행하지 못했다.

## 4. 번역 품질 주장 적대 검증

### 주장 A: “Luna는 세대가 높고 비싸므로 번역도 고품질이다”

**기각.** 가격·세대명·context 길이는 EN→KO 정확성, 자연스러움, 자막 간결성의 대리 지표가 아니다. 공식 Luna 설명은 오히려 과거 nano tier에 대응하는 비용 민감·대량 모델이라고 한다. 공개된 EN→KO 점수가 없으므로 “고품질” 라벨은 과장이다.

### 주장 B: “Nano는 싸므로 저비용 기본값으로 안전하다”

**부분 인정, 자동 채택은 기각.** 두 모델 내에서는 명백히 저렴하지만, 저렴함은 형식 준수·번역 품질을 보장하지 않는다. gd-api-select verified selection의 현재 번역 기본 후보보다도 자동 선택 근거가 부족하고, 앱 특유의 `[N]`/HTML/자막 문맥 회귀를 통과하지 않았다.

### 주장 C: “reasoning을 높이면 번역 품질이 오른다”

**조건부이며 번역에서는 기본 가정으로 쓰면 안 된다.**

도움이 될 수 있는 범위(실측 필요):

- 대명사·생략 주어·다의어의 문맥 해소
- 연속 자막에서 화자/시제/용어 일관성 유지
- 기술 문서의 용어 선택, 복잡한 장문·중첩 수식 관계
- 태그 사이에 분절된 문장의 의미 복원

오히려 손해가 커질 수 있는 범위:

- 단순 문장·UI 문자열·짧은 자막처럼 과제가 이미 명확한 경우
- reasoning token은 사용자에게 보이지 않아도 context를 차지하고 **output token으로 과금**된다.
- GPT-5.6은 effort 생략 시 medium이므로 Nano none과 비교하면 모델 차이와 추론량 차이가 섞인다.
- 더 많은 내부 계산은 비용과 지연을 늘릴 수 있다. `[N]` 외 설명, 번호 누락, HTML 변형 같은 형식 파손이 실제로 증가/감소하는지는 공식 근거가 없으며 반드시 측정해야 한다.
- 고 effort에서 현행 `temperature`가 payload error를 일으킬 가능성도 별도 호환성 risk다.

따라서 **번역 기본은 effort=`none`**, 애매한 문맥 strata에 한해 Luna `low`를 수동 비교하는 것이 타당하다. `medium/high/xhigh/max`를 품질 옵션으로 노출하는 것은 이 workload에서 비용 대비 이득이 증명되기 전에는 금지한다.

## 5. 공식·공개 번역 benchmark 조사 결과

### 공식 OpenAI

공식 모델 catalog, Nano/Luna 모델 페이지, pricing, deprecations, GPT-5.4/5.6 model guidance, reasoning guide를 확인했다. 이 문서들에서 다음을 찾지 못했다.

- EN→KO COMET, BLEU, chrF, MQM 또는 인간 선호 점수
- 웹페이지 번역·자막 번역 평가
- Nano vs Luna 번역 head-to-head
- reasoning effort별 번역 품질/형식/지연 결과

모델 페이지의 navigation에 보이는 “Live translation”은 별도 realtime/audio 기능 링크이지, 여기의 text EN→KO benchmark가 아니다.

### 신뢰 가능한 제3자 공개 평가

정확한 모델 ID와 `translation`, `Korean`, `COMET`, `BLEU`, `chrF`, `WMT` 조합으로 일반 검색 및 학술 검색을 시도했으나, **채택 근거로 쓸 수 있는 공개 exact-model EN→KO 평가를 확인하지 못했다.** 검색 엔진의 bot challenge, Semantic Scholar 429, arXiv timeout도 발생했으므로 “세상에 절대 없다”가 아니라 **조사 시점에 검증 가능한 자료를 확보하지 못했다**가 정확한 표현이다.

블로그의 소수 예문, LLM-as-judge 단일 점수, 다른 GPT 계열 결과는 있어도 다음 조건을 충족하지 않으면 근거에서 제외해야 한다: exact model ID/snapshot, 공개 test set, 동일 prompt/effort, 충분한 EN→KO 표본, 인간 평가 또는 검증된 metric, 원출력·실패율·비용·지연 공개.

## 6. 채택 전 실측 eval 설계

### 6.1 후보 configuration을 분리한다

1. Nano: `gpt-5.4-nano-2026-03-17`, effort=`none`, 현행 prompt.
2. Luna-N: `gpt-5.6-luna`, effort=`none`, 현행 prompt.
3. Luna-L: `gpt-5.6-luna`, effort=`low`, 현행 prompt.
4. 현행 baseline: `gpt-4.1-nano` (shutdown 전 회귀 기준).

먼저 각 configuration에 대해 현행 Chat Completions payload의 200 응답, parser, usage를 smoke test한다. Luna default medium을 Nano none과 바로 비교하지 않는다. Luna에 고정 snapshot이 없다면 실행 날짜와 응답 model 식별자를 반드시 저장한다.

### 6.2 데이터셋

최소 **400개 단위**, 실제 제품 로그에서 개인정보·저작권 민감정보를 제거해 층화한다.

- 웹 200: 일반 기사 50, 기술/문서 50, 구어·리뷰 40, HTML inline tag/링크 40, 숫자·단위·고유명사·인용 20
- 자막 200: 대화/생략 60, 기술·강의 50, 빠른 짧은 cue 40, 고유명사/용어 연속성 30, ASR 오류·문장 분절 20
- 별도 adversarial contract set 100: `[N]` 유사 문자열, bracket, HTML attribute, code token, URL, emoji, prompt-like source text, 15/20-item 최대 batch

source만 보고 만든 고정 test set을 사용하고, 모델별 실패 사례를 본 뒤 test set을 수정하지 않는다.

### 6.3 평가 방법

- **블라인드 인간 평가:** EN/KO 가능한 평가자 2명 + 불일치 adjudicator. 모델명·가격·순서를 숨긴 pairwise 선호와 MQM식 error annotation을 함께 수행.
- 오류 분류: 의미 누락/추가·환각, 오역, 고유명사/숫자, 문체·존댓말, 부자연스러움, 자막 간결성/문맥, terminology.
- 자동 지표: chrF/COMET 계열은 보조값만 사용. EN→KO 및 해당 도메인에서 metric 버전의 유효성이 확인되지 않으면 단독 gate로 금지. BLEU 단독 순위도 금지.
- 계약 지표: `[N]` 완전성·순서·중복, parse 성공률, HTML tag/attribute byte-level 보존, 빈 응답, 재시도율.
- 운영 지표: end-to-end p50/p95 latency, input/output/reasoning token, batch당 USD, timeout/rate-limit, 출력 길이.
- 통계: 문서/영상 단위 bootstrap 95% CI. cue를 독립 표본으로 잘못 세어 유의성을 부풀리지 않는다.

### 6.4 채택 gate와 라벨 승격

**Nano를 저비용 기본 후보로 승격:**

- 현행 baseline 대비 MQM major error 비열등(사전 margin 0.5 percentage point 이내)
- parse 성공률 ≥99.5%, HTML/번호 치명 파손 ≤0.1%
- 의미 누락/환각 major error ≤0.5%
- p95 latency와 실제 단가가 제품 예산 cap 이내

**Luna를 “고품질” 수동 옵션으로 승격:**

- Nano 대비 전체 blind preference ≥55%이며 bootstrap 95% CI 하한 >50%
- MQM major error를 상대 20% 이상 감소시키고 웹·자막 양쪽에서 방향이 일치
- parse/HTML 파손이 Nano보다 0.2 percentage point 넘게 악화되지 않음
- Luna-N과 Luna-L 중 이득이 재현되고, 약 4.8배 base-token 가격 및 reasoning 비용·p95 지연을 사용자가 수용할 명확한 premium value가 있음

위 gate를 못 넘으면 제품 결론은 **Nano만 저비용 실험 옵션**, Luna는 **숨김/수동 benchmark 전용**이다. Luna가 품질은 이겨도 비용·지연 gate를 못 넘으면 자동 default가 아니라 수동 premium으로만 둔다.

## 7. 권고 제품 문구

사용 가능:

- `GPT-5.4 Nano — 저비용 · 실험`
- `GPT-5.6 Luna — 상위 비교 · 실험 (수동)`

실측 전 금지:

- `GPT-5.6 Luna — 고품질 번역`
- `GPT-5.4 Nano — 검증된 가성비 번역`
- `reasoning 강화 — 더 정확한 번역`

## 8. 공식 출처

1. OpenAI model catalog: https://developers.openai.com/api/docs/models
2. GPT-5.4 nano model: https://developers.openai.com/api/docs/models/gpt-5.4-nano
3. GPT-5.6 Luna model: https://developers.openai.com/api/docs/models/gpt-5.6-luna
4. API pricing: https://developers.openai.com/api/docs/pricing
5. Deprecations: https://developers.openai.com/api/docs/deprecations
6. GPT-5.4 model guidance: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4
7. GPT-5.6 model guidance: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6
8. Reasoning models/billing: https://developers.openai.com/api/docs/guides/reasoning
9. Product pricing: https://openai.com/api/pricing/ — 별도 제품 페이지; 이번 판정의 수치는 접근 성공한 개발자 pricing과 각 모델 페이지로 교차 확인

## 9. 미확인 사항

- API key가 없어 authenticated model-list/generation call 미수행
- Luna의 현행 Chat Completions + `temperature: 0.1` 실호출 호환성
- 두 모델의 실제 EN→KO 품질·형식 파손·지연·reasoning token
- Luna의 날짜 고정 snapshot 제공 여부와 alias drift 정책
- 신뢰 가능한 공개 exact-model EN→KO benchmark 부재(조사 접근 제한 포함)
