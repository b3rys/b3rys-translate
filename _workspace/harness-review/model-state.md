# 모델 상태 경계 적대 검토 보고서

- 저장소: `/Users/gd452/Development/b3rys-translate`
- 브랜치: `feat/quality-models-antirez-pre`
- 검토 범위: 현재 tracked diff 전체 및 신규 model registry/storage migration/engine routing/cache/usage·cost 소스와 테스트
- 소스 수정: 없음
- 외부 API 호출·자격증명 접근: 없음

## Verdict

**fail**

모델 registry, provider별 모델 선택, engine dispatch, model별 cache namespace와 usage bucket의 기본 구조는 일관되고 전체 테스트/typecheck도 통과했다. 그러나 명시 요구사항인 **기존 `selectedEngine` 보존이 실제 legacy migration 조합에서 깨진다.** 또한 고가 모델 선택 이후에도 비용 한도는 요청 전 누적액만 검사하고 OpenAI 출력 상한이 없어, 표시된 limit를 단일 요청으로 크게 초과할 수 있다.

## 발견 요약

| 심각도   | 개수 | 요약                                                                                        |
| -------- | ---: | ------------------------------------------------------------------------------------------- |
| critical |    0 | 없음                                                                                        |
| high     |    2 | legacy Gemini key가 기존 provider 선택을 덮어씀; 비용 limit의 단일 고가 요청 초과 방어 없음 |
| medium   |    1 | cached-input 세부 usage/단가를 버려 OpenAI 비용을 과대계상                                  |
| low      |    1 | engine adapter 자체는 provider/model 조합을 runtime 검증하지 않음                           |

## High

### H1. legacy `geminiApiKey`가 있으면 기존 `selectedEngine`을 무조건 `gemini`로 덮어쓴다

**근거**

- `utils/storage.ts:67-71`: migration이 local에서 `engineApiKeys`, `selectedModels`만 읽고 기존 `selectedEngine`은 읽지 않는다.
- `utils/storage.ts:84-91`: sync에 `geminiApiKey`가 존재하면 local에 이미 `selectedEngine: openai|anthropic`가 있어도 `chrome.storage.local.set({ selectedEngine: 'gemini' })`를 무조건 실행한다.
- `tests/model-migration.test.ts:11-24`: 기존 selectedEngine/key 보존 테스트는 sync legacy key가 없는 경우만 다룬다.
- `tests/model-migration.test.ts:26-48`: 유효/오염된 selectedModels 정규화는 검증하지만 legacy key와 기존 provider가 공존하는 조합은 빠져 있다.

**영향**

- 요구사항인 기존 `selectedEngine` 보존 위반.
- 업그레이드 직후 사용자가 OpenAI/Anthropic을 선택해 둔 상태여도 Gemini로 전환된다.
- Gemini key도 함께 migration되므로 번역이 오류 없이 다른 provider/model로 실행될 수 있어 사용자가 전환을 즉시 알아채지 못할 수 있다.
- 기존 OpenAI/Anthropic API key 자체는 삭제되지 않지만 active routing이 바뀐다.

**재현**

임시 Vitest를 `_workspace/harness-review`에 만들고 실행 후 삭제했다. 초기 상태는 sync `geminiApiKey`, local `selectedEngine: openai`, local `engineApiKeys.openai`였다.

```bash
npx vitest --run _workspace/harness-review/migration-repro.test.ts
```

실제 결과:

```text
FAIL 1 test
expected 'gemini' to be 'openai'
```

즉 `migrateStorage()` 후 실제 selectedEngine은 `gemini`였다. API key 병합 자체는 기존 OpenAI key를 보존하면서 legacy Gemini key를 추가하는 경로다.

**권고**

migration 시작 시 local `selectedEngine`도 읽고, legacy single-key schema에서 provider 기본값을 쓰는 것은 selectedEngine이 없을 때만 허용해야 한다. sync legacy key + local selectedEngine + local/sync multi-engine keys의 조합 테스트를 추가해야 한다.

### H2. model-aware 가격은 적용됐지만 비용 limit가 단일 고가 요청의 초과 지출을 막지 못한다

**근거**

- `entrypoints/background.ts:306-318`: API 호출 전에 과거 누적액이 limit 이상인지 여부만 검사한다. 예정 요청 비용이나 최대 비용 reservation은 없다.
- `entrypoints/background.ts:364-389`: 실제 호출과 usage 기록은 precheck 이후 수행된다.
- `utils/engines/openai.ts:31-35`, `utils/engines/openai.ts:64-68`: 두 OpenAI 모델 요청 모두 `max_completion_tokens` 같은 출력 상한이 없다.
- `utils/models.ts:43-46`: `gpt-5.6-luna` output 단가가 `$6/1M`으로 catalog에 등록되어 기본 Nano보다 훨씬 높은 비용 경계가 생겼다.
- `tests/model-catalog.test.ts:54-57`: 순수 산술만 검사한다.
- `tests/model-engine-routing.test.ts:21-41`: model/effort/temperature payload만 검사하고 output cap 또는 cost-limit 통합 경계는 검사하지 않는다.

**영향**

- 예: 현재 누적액이 limit 바로 아래면 요청은 허용되고, 긴 출력 한 번이 limit를 크게 넘길 수 있다.
- UI의 “Cost limit”가 hard limit로 인식될 경우 실제 동작과 사용자 기대가 어긋난다.
- Luna 선택은 기존 저가 모델 대비 overshoot의 금전적 영향을 확대한다. page 병렬 worker/YouTube 연속 요청은 precheck가 서로 같은 이전 누적액을 볼 수 있어 동시 초과도 가능하다.

**권고**

mode/model별 보수적 최대 토큰과 최대 예상비용을 계산해 호출 전에 reserve하거나, 최소한 `max_completion_tokens`를 설정하고 동시 요청에 atomic budget reservation을 둬야 한다. “estimate only, not a hard cap”이라면 UI/문서에 명시해야 한다. background 통합 테스트로 limit 직전의 병렬 요청을 검증해야 한다.

## Medium

### M1. OpenAI cached-input usage를 일반 input 단가로 계산해 비용을 과대계상한다

**근거**

- `utils/engines/openai.ts:13-16`: usage 타입이 `prompt_tokens`, `completion_tokens`만 보존한다.
- `utils/engines/openai.ts:83-90`: prompt token detail의 cached token 수를 버린다.
- `utils/models.ts:11-16`, `utils/models.ts:37-46`: pricing schema는 input/output 두 값뿐이며 cached-input 단가가 없다.
- `utils/models.ts:80-85`: 전체 input token에 full input 가격을 적용한다.
- 저장소 내 사전 조사 자료 `_workspace/model-research/openai-integration.md:59-63,176-185`도 두 신규 OpenAI 모델의 cached-input 단가와 현재 방식의 과대계상 위험을 기록한다.

**영향**

- prompt caching이 적용되는 요청은 실제 청구액보다 높은 estimatedCost로 표시될 수 있다.
- 총액/usage ratio/cost precheck가 같은 estimatedCost를 사용하므로 사용자가 설정한 limit에 실제보다 빨리 막힐 수 있다.
- model별 bucket 분리는 성공했지만 “모델별 실제 과금 구조”까지는 반영하지 못한다.

**권고**

`UsageData`에 `cachedInputTokens`를 보존하고 catalog에 cached-input 단가를 추가해 `(input-cached)*input + cached*cachedInput + output*output`으로 계산한다. 상세 필드가 없는 provider/응답은 0으로 fallback한다.

## Low

### L1. engine adapter 경계는 잘못된 provider/model 조합을 자체 거부하지 않는다

**근거**

- `utils/engines/types.ts:17-26`: 모든 adapter가 임의 `ModelId`를 받을 수 있는 공통 signature다.
- `utils/engines/openai.ts:20-35`, `utils/engines/anthropic.ts:20-37`, `utils/engines/gemini.ts:68-86`: 전달된 modelId의 provider 소속을 adapter 내부에서 확인하지 않고 그대로 endpoint/body에 사용한다.
- 정상 background 경로는 `entrypoints/background.ts:293-294`의 `resolveSelectedModel`로 provider/model 조합을 정규화하므로 현재 사용자 경로는 보호된다.

**영향**

현재는 낮은 위험이다. 다만 향후 새 caller/test/helper가 adapter를 직접 호출하면 OpenAI endpoint에 Claude ID를 보내는 식의 지연된 4xx가 발생한다. 타입도 이 조합을 막지 못한다.

**권고**

adapter 진입점에서 `getModelConfig(modelId).engine`을 확인하거나 provider별 ModelId union/map으로 signature를 좁힌다.

## 통과한 경계 및 긍정적 확인

1. **Registry 단일 출처**
   - `utils/models.ts:23-66`에 6개 모델, provider, label, 가격, provider별 기본 모델이 함께 있다.
   - `resolveSelectedModel`은 unknown/wrong-provider 저장값을 provider 기본값으로 복구한다 (`utils/models.ts:88-100`).
2. **provider별 선택 저장**
   - popup은 변경한 provider의 모델만 갱신하고 정규화된 다른 provider 선택을 함께 보존한다 (`entrypoints/popup/main.ts:79-82,160-172`).
   - API key는 계속 `engineApiKeys[provider]`를 사용해 모델 전환 시 복제/삭제하지 않는다 (`entrypoints/popup/main.ts:174-197`).
3. **Engine routing**
   - background가 selectedEngine과 해당 provider selectedModels를 함께 읽고 안전한 modelId를 adapter에 전달한다 (`entrypoints/background.ts:281-296,364-373`).
   - page 및 segment 양쪽에 modelId가 전달된다.
4. **Model-aware cache**
   - key prefix가 `targetLang:mode:modelId:`다 (`utils/translation-context.ts:4-10`).
   - 순수 lookup과 write path 모두 동일 builder/선택 모델을 사용한다 (`entrypoints/background.ts:250-271,337-380`).
   - legacy cache key는 새 namespace에 hit하지 않아 gpt-4.1 결과가 신규 모델 결과로 재사용되지 않는다.
5. **Model-aware usage/cost**
   - stats bucket은 modelId이고 선택 모델 단가로 누적한다 (`entrypoints/background.ts:169-185`).
   - 기존 engine-keyed historical stats는 삭제/재가격되지 않고 총액과 UI fallback label에 계속 포함된다 (`entrypoints/background.ts:212-214`, `entrypoints/popup/main.ts:374-400`).
6. **gpt-4.1-nano 제거**
   - 실행 소스/catalog/신규 모델 테스트에는 `gpt-4.1-nano`가 남지 않았다.
   - 검색상 남은 참조는 `TODO.md`의 역사 기록과 `_workspace/model-research/*` 조사 문서뿐이다. runtime 선택/요청 경로가 아니다.

## 검증 명령과 실제 결과

### 현재 변경 확인

```bash
git status --short --branch
git diff --stat
git diff
git diff --check
```

실제 결과:

- branch: `feat/quality-models-antirez-pre`
- tracked diff: 13개 파일, `176 insertions / 122 deletions`; model 관련 신규 파일/테스트는 untracked로 별도 확인
- tracked diff 전체를 읽었고 model 관련 untracked 소스/테스트도 직접 읽음
- `git diff --check`: 출력 없음, exit 0

### 관련 테스트

```bash
npm run test -- --run tests/model-catalog.test.ts tests/model-migration.test.ts tests/model-engine-routing.test.ts tests/model-ui.test.ts tests/translation-context.test.ts tests/translation-cache.test.ts
```

실제 결과: **6 files, 21 tests passed**, exit 0.

### 전체 테스트

```bash
npm run test -- --run
```

실제 결과: **321 tests passed**, exit 0, 약 37초. Node experimental localStorage warning은 있었으나 실패는 없었다.

### 타입 검사

```bash
npm run typecheck
```

실제 결과: `tsc --noEmit`, 출력 오류 없음, exit 0.

### selectedEngine 보존 반례

```bash
npx vitest --run _workspace/harness-review/migration-repro.test.ts
```

실제 결과: **1 failed**, `expected 'gemini' to be 'openai'`. 임시 repro 파일은 실행 후 삭제했다.

## Side-effect / compatibility 위험

- 새 cache namespace 도입으로 기존 번역 cache는 의도적으로 miss가 된다. 데이터는 즉시 삭제되지 않아 최대 4,000-entry LRU 용량 일부를 잠시 차지하지만 신규 write가 진행되며 순차 축출된다.
- 기존 usage의 provider bucket(`gemini/openai/anthropic`)과 신규 model bucket이 한 테이블에 혼재한다. 합계 보존에는 맞지만 provider 과거값과 신규 model값을 같은 행 체계로 보여 주므로 기간/스키마 구분은 없다.
- model alias를 catalog에 직접 사용하므로 provider가 alias 동작을 변경하면 같은 cache namespace에서 품질이 바뀔 수 있다. prompt/schema version도 cache key에 없어 향후 prompt 변경 시 명시적 cache version bump가 필요하다.
- model switch 저장은 selectedEngine/selectedModels 한 `storage.local.set`에 묶여 일관적이지만, startup의 `migrateStorage()`는 await되지 않는다 (`entrypoints/background.ts:68-70`). 신규 selectedModels가 아직 없을 때도 runtime fallback이 동일 기본값을 선택하므로 현재 모델 경로는 안전하나, migration side effect와 첫 메시지의 ordering 보장은 없다.

## Unverified scope

- 사용자 지시대로 실제 OpenAI/Gemini/Anthropic API 호출, API key 조회, 계정별 model entitlement 확인은 하지 않았다.
- catalog의 현재 가격/모델 가용성은 저장소 내 조사 문서와 구현값만 대조했다. 이 검토 중 외부 문서를 새로 조회하지 않았다.
- 실제 Chrome popup에서 모델 전환, service-worker restart, 장기 cache/usage flush를 수동 검증하지 않았다.
- background의 private coordinator(`handleTranslateBatch`, usage flush)는 직접 import 가능한 통합 테스트가 없어 model 선택→cache hit/miss→usage persist→cost limit의 end-to-end 자동 검증을 하지 못했다.
- lint/build는 이번 독립 경계 검토에서 실행하지 않았다. 전체 test와 typecheck는 실행했다.
