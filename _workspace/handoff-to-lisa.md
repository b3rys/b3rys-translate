# b3rys-translate Lisa 인수인계

- 인계자: Herm
- 새 실행 owner 요청: Lisa
- 저장소: `/Users/gd452/Development/b3rys-translate`
- 브랜치: `feat/quality-models-antirez-pre`
- 기준 HEAD: `db0a10e`
- 상태: 구현 diff는 로컬 uncommitted. commit/push/PR 없음.

## 목표

1. 제공사별 모델 선택 UI와 안전한 기존 사용자 migration
2. `https://antirez.com/news/169`의 산문형 `<pre>` 본문 번역 누락 수정
3. 전역 PRE/code 안전 규칙을 약화하지 않고 해당 URL만 처리
4. 전체 자동 품질 + 실제 Chrome 검증 후 완료

## 모델 구성

- Gemini: `gemini-3.1-flash-lite`(기본), `gemini-3.5-flash-lite`
- OpenAI: `gpt-5.4-nano`(기본), `gpt-5.6-luna`
- Anthropic: `claude-haiku-4-5-20251001`(기본), `claude-sonnet-4-6`
- `gpt-4.1-nano` runtime 선택/상수에서 제거
- UI option은 라벨만 표시. 품질·추천 설명 금지. 가격 tooltip은 모델명/가격/중립 단위만 표시.

## 아키텍처 경계

- `utils/models.ts`: 모델 ID/라벨/provider/가격/default/정규화/비용의 단일 정본
- `entrypoints/popup/model-ui.ts`: selector와 가격 table 렌더링
- `utils/translation-context.ts`: `target:mode:model` cache namespace
- `utils/translation-types.ts`: API 요청 mode 중립 타입
- provider API key는 기존 `engineApiKeys[provider]` 구조 유지
- `selectedModels`는 provider별 저장; 기존 `selectedEngine`과 API key 보존

## Harness 발견과 반영

보고서:

- `_workspace/harness-review/model-state.md`
- `_workspace/harness-review/antirez.md`
- `_workspace/harness-review/qa-ui.md`

반영 완료:

1. legacy sync `geminiApiKey` migration이 기존 OpenAI/Anthropic `selectedEngine`을 Gemini로 덮어쓰던 버그 수정 + 영구 회귀 테스트
2. antirez hostname 전체 규칙이 홈페이지 100개 PRE/100개 제목을 opt-in하던 문제 수정
   - path: `^/news/169/?$`로 제한
   - 제목: `article[data-news-id="169"] h2`
   - 본문: `pre:not(:has(code))`
3. antirez homepage bulk PRE 제외, PRE 내부 CODE drift 제외, 줄바꿈, purge 원문 복구 테스트 추가
4. popup `main.ts` + 실제 popup HTML + chrome storage mock 통합 테스트 추가
5. README/PRIVACY/CLAUDE/release-checklist/설치 skill을 local storage·6-model·Model UI와 정렬
6. 비용 Limit은 실제 billing hard cap이 아니라 누적 예상 비용 도달 후 후속 요청 차단선임을 문서화

남은 비차단 설계 검토:

- OpenAI cached input token 상세를 현재 보존하지 않아 예상 비용이 과대계상될 수 있음
- engine adapter 직접 호출 시 wrong-provider ModelId runtime 검증 없음. 정상 background 경로는 정규화됨.
- hard atomic budget reservation은 없음. 현재 제품/문서 계약은 estimate-based follow-up blocking.

## 검증 증거

post-Harness 수정 후:

- `npm test -- --run`: **326/326 passed**
- `npm run lint`: exit 0, errors 0, 기존 `ascii-reporter.ts` warnings 8
- `npm run typecheck`: exit 0
- `git diff --check`: exit 0
- targeted regression: 12/12 passed

주의:

- post-Harness 최종 수정 뒤 `npm run build`는 아직 다시 실행하지 않음. 이전 빌드는 146.11 kB로 통과했지만 반드시 재실행 필요.

## 실제 Chrome 상태 / blocker

- Mac Studio의 Chrome 일반 탭을 실제 검증에 사용해도 됨.
- 실제 `https://antirez.com/news/169` 탭 존재를 확인했음.
- 로컬 unpacked 경로: `/Users/gd452/Development/b3rys-translate/dist/chrome-mv3`
- 기존 Chrome의 로컬 extension ID는 `ccledfholbijloceggeobmkijaldikkd`로 Preferences에서 확인.
- macOS Accessibility 권한 없음, Chrome의 Apple Events JavaScript 비활성이라 Herm 자동 UI 조작 불가.
- branded Chrome 150 headless `--load-extension` 격리 검증은 popup option wait timeout/content verifier 오류로 성공 증거가 되지 못함. 이를 앱 성공/실패로 단정하지 말 것.

Lisa 완료 전 필수:

1. `npm run build`
2. `chrome://extensions`에서 local unpacked reload
3. popup에서 6개 모델 라벨, 가격 단위, provider별 key 보존, 모델 저장/재오픈 확인
4. `/news/169` 본문 번역 및 줄바꿈 확인
5. `https://antirez.com/` 홈페이지가 bulk PRE 번역되지 않는지 반대 검증
6. 일반 `<pre><code>` 페이지가 계속 제외되는지 반대 검증
7. 필요 시 전체 `test → lint → typecheck → build` 재실행
8. release 여부 판단 및 최종 보고

## API canary

- Herm 환경의 provider API key env는 unset이었고 유료 canary 미수행.
- 자격증명 값을 출력/기록하지 말 것.
- canary가 필요하면 사용자 승인과 작은 예산으로 exact model ID/응답 schema만 검증하고 EN→KO 우위를 근거 없이 주장하지 말 것.

## Chrome / YouTube 팀 규칙

`CLAUDE.md`에 공유 기록 완료:

- Mac Studio Chrome 일반 탭 사용 가능
- 자동 테스트와 실제 Chrome 검증은 상호 대체 불가
- 개인/unrelated 탭과 자격증명 비접근
- YouTube 테스트 시 종료 전에 반드시 pause하고 실제 재생 중지 재확인. 탭 이동/음소거로 대체 금지.

## 인수 완료 조건

Lisa가 ack/ETA를 반환하고 위 남은 검증을 owner로 수행한다. Lisa가 결과를 보고하면 Herm은 더 이상 구현 owner로 작업을 계속하지 않는다.
