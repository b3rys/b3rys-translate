---
name: selection-popup-rules
description: 선택 번역 팝업 룰 (단어/문장 모드, UI, 캐시). selection-popup.ts, llm-helpers.ts 수정 시 참조.
---

# 선택 번역 팝업 룰

## 파이프라인

1. 사용자가 텍스트 드래그 → `mouseup` 이벤트 캐치
2. 영어 텍스트 판별 (`isLikelyEnglish`, ASCII 비율 > 60%)
3. 선택 영역 마지막 줄 오른쪽 끝에 트리거 버튼 표시 (`Range.getClientRects()` 마지막 rect)
4. 트리거 클릭 → 팝업 표시 + `TRANSLATE_BATCH` 메시지 전송
5. 단어/문장 모드 자동 판별 → 각각 다른 프롬프트·UI로 처리

## 모드 판별

| 모드 | 조건                         | mode 값  | 프롬프트                                       | UI          |
| ---- | ---------------------------- | -------- | ---------------------------------------------- | ----------- |
| 단어 | `isSingleWord()` — 공백 없음 | `'word'` | `buildWordTranslationPrompt` (번역 + 예문 2개) | 컴팩트 팝업 |
| 문장 | 공백 포함                    | `'page'` | `buildTranslationPrompt` (일반 번역)           | 넓은 팝업   |

## 단어 모드 응답 파싱 (`parseWordResponse`)

LLM 응답 형식:

```
[1] 한국어 번역
= brief English definition
~ similar word 1, similar word 2
• English example sentence 1
→ Korean translation 1
• English example sentence 2
→ Korean translation 2
```

- 첫 줄 = 번역
- `=` 시작 줄 = 영영 해석 (작은 회색 글씨)
- `~` 시작 줄 = 유사 단어 (초록색, `≈` 라벨)
- `•` 시작 줄 = 영어 예문 (선택 단어 초록색 하이라이트)
- `→` 시작 줄 = 한국어 예문

## 단어 모드 UI 구조

```
word — 한국어번역                    🔊
brief English definition (작은 회색)
≈ similar1, similar2 (초록색)
──────────────────────────────────
• Example sentence (word 하이라이트)
→ 한국어 예문
```

- 헤더: 원문(볼드) — 번역(초록) + 발음 버튼
- 발음: Web Speech API (`speechSynthesis`), Google US English 보이스 우선
- 로마자 표기 금지 (프롬프트에 명시)

## 팝업 위치·동작

- `position: absolute` — 페이지 스크롤 시 함께 이동 (viewport 좌표 → document 좌표 변환)
- 페이지 스크롤: 트리거만 닫힘, 팝업은 유지
- 페이지 리사이즈: 전부 닫힘
- 팝업 밖 클릭 (`mousedown`): 전부 닫힘

## 캐시

- 문장 모드: 일반 캐시 키 (원문 텍스트)
- 단어 모드: `__word__` 프리픽스로 분리 (같은 단어라도 page/word 결과가 다름)

## Floating 버튼 연동

- `floatingButtonVisible === false` → `destroySelectionPopup()` (선택 번역도 비활성화)
- `floatingButtonVisible === true` → `initSelectionPopup()` (재활성화)

## 변경 체크리스트

**선택 팝업 UI 변경:**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `content/selection-popup.ts` | 해당 함수 | 로직 수정 |
| 2 | `content/selection-popup.css` | 스타일 클래스 | 스타일 추가/수정 |
| 3 | 이 스킬 파일 | 해당 섹션 | 규칙 업데이트 |

**번역 모드 추가:**
| # | 파일 | 위치 | 할 일 |
|---|------|------|-------|
| 1 | `utils/messaging.ts` | `TranslateBatchRequest.mode` | 모드 타입 추가 |
| 2 | `utils/engines/types.ts` | `TranslationEngine.translate()` | mode 타입 추가 |
| 3 | `utils/engines/llm-helpers.ts` | 프롬프트 빌더 | 새 프롬프트 함수 추가 |
| 4 | `utils/engines/gemini.ts`, `openai.ts`, `anthropic.ts` | prompt 선택 분기 | 모드 분기 추가 |
| 5 | `entrypoints/background.ts` | `handleTranslateBatch` | mode 전달, 캐시 키 분리 |
| 6 | 이 스킬 파일 | 모드 판별 테이블 | 행 추가 |
