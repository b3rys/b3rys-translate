# 모델 카탈로그

`models.json`은 빌드에 포함되는 모델 목록의 정본이다. 원격 요청이나 추가 권한은 없다.
`version: 1`은 스키마 버전이며 확장 프로그램 버전과 독립적이다.

- `id`: 공급사에 보내는 모델 ID. 전체 목록에서 유일해야 한다.
- `engine`: `gemini`, `openai`, `anthropic`, `upstage` 중 하나.
- `label`: 팝업에 텍스트로 표시하는 이름.
- `pricing.input`, `pricing.output`: 100만 토큰당 USD. 유한한 0 이상 숫자.
- `default`: boolean. 엔진별로 정확히 하나만 `true`.

## 검증과 복구

`utils/model-catalog.ts`의 `loadModelCatalog(raw: unknown)`은 입력을 변경하지 않고
불변 카탈로그와 `diagnostics`(디버그 메시지 배열)를 반환하는 순수 함수다.
문자열 JSON의 파싱은 호출부가 담당한다. 로그·네트워크·저장소 접근도 호출부 책임이다.
`utils/models.ts`는 번들을 로드하고 `diagnostics`를 기존 `dbg`에 전달한다.
디버그 표시는 기존 `localStorage.b3rys_debug='1'` 설정을 따른다.

모르는 엔진, 빈 ID/라벨, 잘못된 가격·default 필드, 중복 ID의 모든 항목은 버린다.
검증 후 default가 0개 또는 2개 이상인 엔진은 전체를 버린다.
유효 모델이 없는 엔진만 번들의 해당 엔진 목록과 기본값으로 복구한다.
다른 엔진의 정상 모델은 유지한다. 지원하지 않는 스키마 버전은 전체 번들로 복구한다.
부분 복구 시 ID 충돌을 막기 위해 번들 ID를 다른 엔진에 재배정하는 항목도 버린다.
번들 자체가 잘못되면 빌드/테스트에서 오류를 드러내며 이를 정상 폴백으로 숨기지 않는다.

선택·조회·비용 함수와 팝업·엔진은 검증된 카탈로그를 인자로 받을 수 있다.
인자를 생략하면 번들 카탈로그를 쓴다. 저장된 모델이 사라졌거나 다른 엔진에 속하면
해당 엔진의 현재 기본값으로 돌아간다. 요청 옵션은 엔진 코드에 그대로 둔다.

원격 단계에서 붙일 곳: 백그라운드 fetch → 서명 검증 → loadModelCatalog → storage 캐시.
원격 갱신·서명 검증·캐시·다른 실행 컨텍스트로의 동기화는 아직 구현하지 않았다.

## 기존 선택·가격 근거 보존

아래는 설정 분리 전 `utils/models.ts`의 결정과 가격 출처 주석을 옮긴 것이다.
현재 가격이나 지원 현황을 새로 조사한 결과가 아니다. 0.5.36은 기존 값을 보존했으며, 0.5.37 변경과 최신 출처는 아래에 구분한다.

- **2026-07-27 제품 결정:** 번역에서 추론으로 늘어나는 지연과 토큰을 피하기 위해
  추론하지 않거나 요청에서 확실히 끌 수 있는 모델을 원칙으로 한다.
  2026-10-11부터 Gemini 3.1 Flash Lite는 minimal 예외로 유지한다. 추가 시 공급사 문서로 확인한다.
  Gemini 3.5 Flash Lite는 thinking 기본값이 minimal이며 off가 없어 제외했다.
  `thinkingConfig` 생략은 비활성화가 아니다.
- **2026-07-27 비용 결정:** Claude Sonnet 4.6은 Haiku 대비 3배($3/$15 대 $1/$5)이며
  번역 품질 차이가 비용을 정당화하지 못한다고 판단해 제외했다.
- **2026-07-30 GPT-5.6 Luna:** 공급사 공개 요금표의 short-context 가격 인하
  $1/$6 → $0.20/$1.20을 반영했다. 같은 표의 GPT-5.4 Nano $0.20/$1.25와
  열을 대조했다. Luna 출력 단가가 낮아졌지만 기본값 변경은 별도 판단으로 남겼다.
- **2026-07-29 Upstage 문서:** `solar-mini`는 `solar-mini-250422`의 별칭이며
  reasoning을 지원하지 않는다. `reasoning_effort`를 보내면 무시된다는 옛 설명은
  2026-10-11 공식 문서의 HTTP 400 설명으로 정정한다.
  공개 요금표에서 Solar Mini는 입출력 구분 없이 $0.15로 표시되어 둘 다 0.15다.
  Solar Pro 2/3의 $0.15/$0.60과 혼동하지 않는다. 출력 0.60은 4배 과대 추정이며,
  외부 PR #14의 $0.05/$0.20도 출처가 확인되지 않아 채택하지 않았다.

기존 주석에 가격표 URL은 없었다. 0.5.37에서 확인한 출처를 아래에 추가한다.

## 0.5.37 모델 갱신 (2026-10-11 확인)

가격 단위는 Standard, USD/100만 토큰, 입력/출력이다.

- [Solar Mini 4](https://console.upstage.ai/docs/models/solar-mini-4): 정가 0.10/0.40.
  종료 예정 `solar-mini`를 제거하고 `solar-mini4`를 기본값으로 한다. 기존 저장 선택은
  카탈로그 기본값 복구와 `migrateStorage`를 통해 이전한다. 과거 사용량·비용은 바꾸지 않는다.
  [추론 문서](https://console.upstage.ai/docs/capabilities/generate/reasoning)에 따라
  reasoning 파라미터를 생략한다. 임시 할인 가격은 쓰지 않는다.
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): 입력 272K 이하
  0.10/0.50. 초과 시 전체 요청 0.20/0.75다. 기존 nano와 5.6 Luna 및 기본값을 유지한다.
  `reasoning_effort: none`은 두 요청 경로에서 유지한다.
- [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview): 입력 100K 이하
  0.10/0.50, 초과 시 0.50/2.50. 기본값은 4.5를 유지한다.
  [thinking 문서](https://platform.claude.com/docs/en/build-with-claude/thinking)상
  4.5·5.5 모두 disabled가 가능하다. 5.5 기본 effort medium은 disabled 허용 범위다.
  출력 한도는 각각 64K/128K이므로 현재 요청 제한 8192를 유지한다.
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking): 3.1의
  기본 minimal은 완전 off를 보장하지 않는다. 예외를 `note`로 기록하고 출력 비용에
  `candidatesTokenCount + thoughtsTokenCount`를 사용한다. 과거 누적 비용은 소급 수정하지 않는다.
- [OpenAI 변경 기록](https://developers.openai.com/api/docs/changelog): 5.6 Luna 인하일을
  2026-07-30으로 정정했다.

GPT-6 Luna와 Haiku 5.5의 장문 가격 분기는 이번 범위에서 구현하지 않았다.
표시·계산은 위 짧은 입력 단가 기준이며, 해당 입력 임계치를 넘는 요청 비용은 과소 추정된다.
`note`는 검증된 카탈로그에 보존하는 설명용 메타데이터이며 요청 옵션을 실행하지 않는다.
실제 API 호출·계정 접근성·번역 품질·지연은 별도 검증 대상이다.
