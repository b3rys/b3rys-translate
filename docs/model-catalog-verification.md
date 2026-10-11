# 모델 카탈로그·갱신 검증 (0.5.37)

| 기능                         | 소스                                                              | 자동 검사                                                                    | 뮤턴트 실패 수                       | 미검증                              |
| ---------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| 번들 모델·가격·기본값과 검증 | `config/models.json`, `utils/model-catalog.ts`, `utils/models.ts` | `tests/model-catalog-loader.test.ts`, 기존 catalog/migration 검사            | 음수 가격 허용 1; default 2개 허용 1 | 장문 단가 분기 미구현               |
| Solar Mini → Mini4 선택 이전 | 카탈로그 기본값, `utils/storage.ts`                               | `tests/model-refresh.test.ts`: 읽기/저장/재실행, 다른 선택·키·과거 비용 보존 | 폐기된 저장 ID 유지 4                | 실제 공급사 접근성                  |
| Haiku 4.5/5.5 추론 끄기      | `utils/engines/anthropic.ts`                                      | 일반·segment 두 경로의 요청 본문 스냅샷                                      | adaptive로 변경 2                    | 실제 공급사 호출                    |
| Gemini 생각 토큰 과금        | `utils/engines/gemini.ts`                                         | 두 요청 경로의 토큰 합·비용, 누락·0 값                                       | 생각 토큰 제외 3                     | 과거 누적 비용은 소급 보정하지 않음 |
| Solar Mini4 추론 생략        | `utils/engines/upstage.ts`                                        | 두 요청 경로 스냅샷·reasoning 필드 부재                                      | reasoning high 전송 3                | 실제 공급사 호출                    |
| GPT-6 Luna 추가·none 유지    | `config/models.json`, `utils/engines/openai.ts`                   | 기본값 유지, 두 경로 요청 스냅샷                                             | 해당 없음                            | 품질·실제 지연                      |
| 팝업 모델·가격               | `entrypoints/popup/model-ui.ts`                                   | 모델 7개와 가격 DOM, 텍스트 안전 표시                                        | 해당 없음                            | 실제 Chrome 확장 설치·팝업 조작     |

## 재현

```sh
npx wxt prepare
npx vitest run
npm run lint
npm run typecheck
npm run format:check
npm run build
python3 scripts/check-model-catalog-mutants.py
```

전체 자동 테스트는 41개 파일, 496개 검사다. 요청 본문 스냅샷은 8개다.
뮤턴트 검사 범위는 loader 31개와 refresh 14개: 기본 45통과/0실패,
뮤턴트 6개 각각 위 실패 수로 탐지, 원복 후 45통과/0실패다.
스크립트는 임시 사본에만 결함을 넣으며 치환 개수·적용·원복을 확인한다.
기존 테스트 리포터 lint 경고 8개는 남아 있고 오류는 없다.

실제 Chrome 확인 경로: 확장 팝업 → 모델 선택 메뉴·모델 가격 툴팁.
Solar Mini4가 이전 Mini 선택을 대체하며 다른 엔진 기본값은 유지되는지 확인한다.
실제 생성 호출·계정 접근·한국어/영어 품질·지연은 이 검사에 포함하지 않는다.

GPT-6 Luna 입력 272K 초과, Haiku5.5 입력 100K 초과 단가 분기는 미구현이며
짧은 입력 단가로 계산하므로 그 범위의 비용은 과소 추정된다. 원격 로딩도 별도 과제다.

롤백은 모델 갱신 커밋을 되돌리고 다시 빌드한다. 이전 카탈로그에서는 저장된 Mini4
선택이 기본값 Mini로 복구된다. 단, Mini 서비스 종료 후에는 이 롤백이 번역을 복구하지
못하므로 공급사가 지원하는 모델로 수정해야 한다. 과거 사용량은 이전/롤백에서 보존한다.
