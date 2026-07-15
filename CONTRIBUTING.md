# 기여 가이드 (Contributing)

b3rys translate에 관심 가져 주셔서 감사합니다! 버그 리포트, 기능 제안, 코드 기여 모두 환영합니다.

## 시작하기

```bash
git clone https://github.com/b3rys/b3rys-translate.git
cd b3rys-translate
npm install
npm run dev      # HMR 개발 모드 (Chrome 자동 로드)
```

## 개발 워크플로우

1. **이슈 먼저** — 버그/기능은 먼저 이슈로 등록해 방향을 맞춥니다 (사소한 오타 수정은 예외).
2. **feature 브랜치에서 작업** — `feat/기능명` 또는 `fix/버그명`. `main`에 직접 커밋하지 않습니다.
3. **검증** — PR 전에 아래 순서로 로컬 검증을 통과시켜 주세요.
   ```bash
   npm run test        # Vitest
   npm run typecheck   # tsc --noEmit
   npm run lint        # ESLint
   npm run format      # Prettier (커밋 전 필수)
   npm run build       # 프로덕션 빌드 확인
   ```
4. **PR 생성** — `main`을 대상으로 PR을 엽니다. CI(타입체크·린트·포맷·테스트)가 통과해야 머지됩니다.

## 코드 규칙

- **TypeScript (vanilla)** — React/Vue 없이 순수 TS + DOM API.
- **테스트 우선** — 로직 변경 시 `tests/`에 단위 테스트를 추가/갱신합니다 (현재 252 tests).
- **민감 정보 금지** — API 키·토큰·개인정보를 코드나 커밋에 포함하지 않습니다. 로컬 설정은 `.env`(gitignore됨)에 둡니다.

### ⚠️ 위험 영역 (수정 전 문서 필독)

아래 영역은 무한 루프·경쟁 조건·API 비용 폭주 위험이 있어, 수정 전 `docs/`의 해당 문서를 반드시 읽어 주세요.

| 수정 대상                                    | 참고 문서                            | 핵심 위험                                |
| -------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| `content.ts`, `observer.ts`, `background.ts` | [docs/safety.md](docs/safety.md)     | Observer 무한 루프, 경쟁 조건, 비용 폭주 |
| `text-detector.ts`, `translator.ts`          | [docs/pipeline.md](docs/pipeline.md) | 감지 중복, 주입 경로 오류                |
| `youtube/`                                   | [docs/pipeline.md](docs/pipeline.md) | 자막 파이프라인 오류                     |

**절대 위반 금지**

1. Observer 콜백에서 `removeAllTranslations()` 호출 금지 — 무한 루프.
2. state 변경 전 `myGen === startGen` 확인 필수 — stale 결과 오염 방지.
3. `forceReplace` 경로에서 물리 교체 금지 — `markOriginalContent()` + CSS 토글만 사용.

## 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/) 스타일을 권장합니다.

```
feat: 단어 번역 팝업에 발음 듣기 추가
fix: YouTube 소스 언어 자막 없을 때 폴백 처리
docs: README 설치 가이드 보강
```

## 라이선스

기여하신 코드는 프로젝트와 동일하게 [Apache License 2.0](LICENSE)으로 배포됩니다.
