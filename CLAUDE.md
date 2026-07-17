# b3rys translate - Chrome Extension

## Project Overview

이중언어 번역 Chrome Extension. 웹페이지 원문을 유지하면서 바로 아래에 한국어 번역을 문단 단위로 삽입한다.

> 작업 트래커: [TODO.md](TODO.md)

## ⚠️ 코드 수정 전 필수 (MANDATORY)

**코드를 수정하기 전에 반드시 해당 스킬을 먼저 읽을 것. 읽지 않고 수정하면 무한 루프, 경쟁 조건, API 비용 폭주 등 치명적 버그가 재발한다.**

| 수정 대상                                           | 필수 스킬                 | 핵심 위험                                    |
| --------------------------------------------------- | ------------------------- | -------------------------------------------- |
| `content.ts`, `observer.ts`, `background.ts`        | `/safety-rules`           | Observer 무한 루프, 경쟁 조건, API 비용 폭주 |
| `text-detector.ts`, `translator.ts`, `constants.ts` | `/page-translate-rules`   | 감지 중복, 주입 경로 오류                    |
| `selection-popup.ts`, `llm-helpers.ts`              | `/selection-popup-rules`  | 팝업 UI 깨짐                                 |
| `youtube/` 디렉토리                                 | `/youtube-subtitle-rules` | 자막 파이프라인 오류                         |

### 절대 위반 금지 (이것만은 꼭 기억할 것)

1. **Observer 콜백에서 `removeAllTranslations()` 호출 금지** — 무한 루프 발생. 증분 번역만 사용.
2. **state 변경 전 `myGen === startGen` 확인 필수** — stale 결과가 상태 오염.
3. **`forceReplace` 경로에서 물리 교체 금지** — `markOriginalContent()` + CSS 토글만 사용.

## Tech Stack

- **Framework**: WXT (Web Extension Framework) + Manifest V3
- **Language**: TypeScript (vanilla, no React/Vue)
- **Translation API**: 다중 엔진 (Gemini, OpenAI, Anthropic)
- **Build**: WXT (Vite 기반)
- **Test**: Vitest + happy-dom

## Architecture

```
Content Script (DOM 조작, floating button, 번역 주입)
    ↕ chrome.runtime.sendMessage
Background Service Worker (Gemini API 호출, 배치 처리, 재시도, LRU 캐시)
    ↕ fetch
Gemini API (https://generativelanguage.googleapis.com/v1beta/)
```

## Branding

- **색상**: 검은 배경 (#111111) + 초록 (#22c55e / #10b981) 테두리/글씨
- **아이콘**: A→가 모티프 (SVG → resvg-cli로 PNG 변환, public/icon-\*.png)
- **둥둥이/유튜브 버튼**: 동일한 A→가 모티프, 초록/검정 색상

## Project Structure

```
entrypoints/
  background.ts              # Service worker: API 통신, 캐시
  content.ts                 # Content script 메인 진입점
  content/
    floating-button.ts       # 플로팅 번역 버튼 (Shadow DOM)
    text-detector.ts         # 텍스트 블록 탐지 (2-phase)
    translator.ts            # 번역 파이프라인
    selection-popup.ts       # 선택 번역 팝업 (Shadow DOM)
    observer.ts              # MutationObserver
    youtube/                 # YouTube 자막 번역
  popup/                     # 팝업 설정 페이지
utils/
  engines/                   # 번역 엔진 (gemini, openai, anthropic, google-translate)
  messaging.ts               # Content ↔ Background 메시지 타입
  constants.ts               # 상수 (엔드포인트, 배치 사이즈 등)
  translation-cache.ts       # LRU 번역 캐시
```

## Commands

- `npm run dev` - 개발 모드 (HMR, Chrome 자동 로드)
- `npm run build` - 프로덕션 빌드
- `npm run test` - Vitest 테스트 실행
- `npm run zip` - 배포용 zip 생성
- `npm run lint` - ESLint 검사
- `npm run format` - Prettier 포맷 적용

## 문서 역할

| 문서          | 역할                                      | 갱신 시점                        |
| ------------- | ----------------------------------------- | -------------------------------- |
| **TODO.md**   | 작업 트래커 (체크박스로 진행률 추적)      | 매 작업마다 (체크박스 완료/추가) |
| **MEMORY.md** | 작업 로그 + 미결 사항 + 워크플로우 교훈   | 상태 변경 시점마다 즉시          |
| **CLAUDE.md** | 아키텍처 + 코드 규칙 + 확정된 결정        | 확정된 결정 이관 시              |
| **README.md** | 사용자용 설명서 (설치, 사용법, 기능 소개) | TODO.md 주요 기능 변경 시 검토   |

## 작업 관리 룰

### 브랜치 규칙

- **기능 추가/버그 수정은 항상 feature 브랜치에서 작업** — main에 직접 커밋하지 않는다
- 브랜치 네이밍: `feat/기능명`, `fix/버그명`
- 완료 후 PR 생성 → CI 통과 → 머지

### 기타 규칙

- 복잡한 TODO (조사+설계+구현 분리, 멀티 세션 예상): `/harness`로 에이전트 팀 구성 후 진행
- **작업은 한 번에 하나씩** — 여러 항목을 동시에 처리하지 말고 순서대로. 각 작업 완료 확인 후 다음으로 이동
- **CLAUDE.md 수정 시 중복 체크** — 새 규칙 추가 전 기존 규칙과 겹치거나 충돌하는 내용이 없는지 전체 파일을 먼저 확인

## 빌드 규칙 (필수)

- **코드 수정 후 반드시 `npm run build` 실행** — 사용자가 `npm run dev`를 항상 켜두지 않으므로, 코드 변경 후에는 `npm run build`로 dist를 갱신해야 함
- 테스트 검증 순서: `npm run test` → `npm run lint` → `npm run build`
- build 실패 시 사용자에게 테스트 요청하지 말 것

## 기능별 상세 룰 (스킬)

코드 수정 시 해당 영역의 스킬을 참조할 것 (⚠️ 필수 읽기 테이블과 동일):

| 영역                                 | 스킬                      | 대상 파일                                           |
| ------------------------------------ | ------------------------- | --------------------------------------------------- |
| 상태 머신, 보호 장치, Observer       | `/safety-rules`           | `content.ts`, `observer.ts`, `background.ts`        |
| 페이지 번역 (감지, 주입, 배치, 캐시) | `/page-translate-rules`   | `text-detector.ts`, `translator.ts`, `constants.ts` |
| 선택 번역 팝업 (단어/문장 모드, UI)  | `/selection-popup-rules`  | `selection-popup.ts`, `llm-helpers.ts`              |
| YouTube 자막 (파이프라인, cue 병합)  | `/youtube-subtitle-rules` | `youtube/` 디렉토리                                 |

## Key Decisions

- 번역 방향: EN → KO 고정
- API 키: chrome.storage.sync에 저장 (사용자가 popup에서 입력)
- Floating button: Shadow DOM으로 CSS 격리
- 번역 단위: 문단(paragraph) 단위, viewport-first 병렬 배치
- 번역문 스타일: 원문 아래에 원문과 동일한 색상으로 표시

## Future Plans

> 상세 TODO는 TODO.md에서 관리
