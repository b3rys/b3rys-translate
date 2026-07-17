# 번역 파이프라인 룰 카탈로그

> 코드를 읽기 전에 이 문서를 먼저 읽으면 전체 구조를 파악할 수 있음.
> **룰 추가/수정 시 반드시 이 문서도 업데이트할 것.**

---

## 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│ Content Script (content.ts)                                        │
│                                                                    │
│  사용자 클릭 ──┐                                                    │
│  Observer ─────┼──→ startTranslation() ──→ translatePage()         │
│  autoTranslate ┘        │                      │                   │
│                    circuit breaker         detectTextBlocks()       │
│                    (15회/분 제한)          ┌────┴────┐              │
│                                          Phase 0  Phase 1  Phase 2 │
│                                           │        │        │      │
│                                           └────┬───┘        │      │
│                                          필터 체인 ◄─────────┘      │
│                                                │                   │
│                                          processBatch() × N        │
│                                                │                   │
│                                    chrome.runtime.sendMessage      │
└────────────────────────────────────────────────┼───────────────────┘
                                                 │
┌────────────────────────────────────────────────┼───────────────────┐
│ Background Service Worker (background.ts)      │                   │
│                                                ▼                   │
│                                         rate limiter               │
│                                         (50콜/분 제한)             │
│                                                │                   │
│                                    ┌───────────┴──────────┐        │
│                                    │ 캐시 체크             │        │
│                                    │ hit → 즉시 반환       │        │
│                                    │ miss → API 호출       │        │
│                                    └───────────┬──────────┘        │
│                                                │                   │
│                                    ┌───────────┴──────────┐        │
│                                    │ Gemini │ OpenAI │ .. │        │
│                                    └───────────┬──────────┘        │
│                                                │                   │
│                                          응답 + 캐시 저장          │
└────────────────────────────────────────────────┼───────────────────┘
                                                 │
┌────────────────────────────────────────────────┼───────────────────┐
│ Content Script (translator.ts)                 │                   │
│                                                ▼                   │
│                                       injectTranslation()          │
│                                    ┌─────┬─────┬─────┐             │
│                                   경로1 경로2 경로2.5 경로3          │
│                                   네비  형제  강제   블록            │
│                                   인라인 삽입  교체   내부           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. 텍스트 감지 3단계 (text-detector.ts)

```
document.body
  │
  │  사이트 룰에 translateSelectors 있나?
  │
  ├─ YES → Phase 0: 커스텀 셀렉터만 사용
  │        (Phase 1, 2 건너뜀)
  │
  │        ┌─────────────────────────────────┐
  │        │ Gmail 예:                        │
  │        │ querySelectorAll('.bqe, .y2')   │
  │        │ → 이메일 제목/미리보기만 정확 감지 │
  │        └─────────────────────────────────┘
  │
  └─ NO → Phase 1 + Phase 2 순차 실행
          │
          ├─ Phase 1: 시맨틱 블록 태그
          │
          │  대상 태그 (TRANSLATABLE_TAGS):
          │  ┌──────────────────────────────────────────┐
          │  │ P  H1 H2 H3 H4 H5 H6  LI  TD  TH      │
          │  │ BLOCKQUOTE  FIGCAPTION  DT  DD           │
          │  └──────────────────────────────────────────┘
          │
          │  텍스트 추출: getDirectText()
          │  ┌──────────────────────────────────────┐
          │  │ <p>Hello <a>world</a></p>             │
          │  │       ↓                               │
          │  │ "Hello world" (인라인 마크업 포함)     │
          │  │                                       │
          │  │ <p>Intro <div>Nested</div></p>        │
          │  │       ↓                               │
          │  │ "Intro" (자식 블록 태그 제외)          │
          │  └──────────────────────────────────────┘
          │
          └─ Phase 2: 텍스트 컨테이너 (보완)

             Phase 1이 놓치는 네비, 사이드바, 바이오 등

             대상: DIV, SPAN, A 중
             ┌──────────────────────────────────────┐
             │ 자식이 없음 (리프 노드)               │
             │   OR                                 │
             │ 자식이 전부 인라인 (A, SPAN, STRONG..) │
             └──────────────────────────────────────┘
```

---

## 2. 필터 체인 (shouldSkipText)

감지된 텍스트 중 번역 불필요한 것을 걸러냄. **저비용 순서로 실행** (early exit).

```
감지된 텍스트
  │
  ├─ F1: URL인가? ──────────── YES → 스킵  "github.com/user/repo"
  │
  ├─ F2: 영어인가? ─────────── NO  → 스킵  "한국어 텍스트입니다"
  │      (ASCII 문자 < 60%)
  │
  ├─ F3: 스킵 조상 안인가? ─── YES → 스킵  <nav role="menu"> 내부
  │      (Phase 1 only)                    SCRIPT, STYLE, CODE, PRE 내부
  │
  ├─ F4: 링크 과다? ────────── YES → 스킵  텍스트의 70%+가 <a> 안
  │      (Phase 1, H1-H6/LI 제외)
  │
  ├─ F5: 이미 감지? ────────── YES → 스킵  Phase 1 블록을 감싸는 div
  │      (Phase 2 only)
  │
  ├─ F6: 짧은 셀? ──────────── YES → 스킵  TD/TH < 20자 (날짜, 숫자)
  │      (Phase 1, TD/TH only)
  │
  └─ F7: 테이블 서브트리? ──── YES → 스킵  TABLE 전체 건너뜀
         (Phase 2 only)
```

---

## 3. 번역 주입 4가지 경로 (translator.ts)

> 시각 예시는 [ui-guide.md](ui-guide.md) 에서 before/after로 확인.

```
injectTranslation(element, translatedText)
  │
  │  LI 또는 A(LI 안) 이고 ≤60자?
  ├─ YES → 경로 1: 네비 인라인
  │        label 스팬 찾아서 안에 삽입
  │        class: b3rys-translation-inline
  │
  │  사이트 룰: injectAsSibling + inline 요소?
  ├─ YES → 경로 2: 형제 삽입
  │        element.after(translationSpan)
  │        class: b3rys-translation
  │
  │  사이트 룰: forceReplace?
  ├─ YES → 경로 2.5: 강제 교체
  │        markOriginalContent() + 번역 추가
  │        CSS로 parallel/replace 전환
  │        class: b3rys-translation
  │
  └─ NO  → 경로 3: 블록 내부 (기본)
           markOriginalContent() + 요소 안에 번역 추가
           ≤60자: b3rys-translation-inline
           >60자/제목: b3rys-translation
```

### markOriginalContent 동작

```
Before:
<p> "Hello " <a>world</a> </p>

After markOriginalContent():
<p>
  <span data-b3rys-original>"Hello "</span>     ← 텍스트 노드 래핑
  <a data-b3rys-original>world</a>              ← 기존 요소에 속성 추가
  <span data-b3rys-translated>번역문</span>     ← 번역 삽입
</p>

Replace 모드: CSS가 [data-b3rys-original] { display: none }
Parallel 모드: 둘 다 표시
```

---

## 4. 사이트별 예외 규칙 (site-rules.ts)

```
┌─────────────────────────────────────────────────────────────────┐
│ site-rules.ts                                                   │
│                                                                 │
│ mail.google.com                                                 │
│ ├─ translateSelectors: ['.bqe', '.y2']                         │
│ │   → 이메일 제목/미리보기 스팬만 감지 (표준 감지가 Gmail에서 실패) │
│ ├─ forceReplace: true                                          │
│ │   → 원문 마킹 + 번역 추가 (CSS 모드 전환 가능)                │
│ └─ mainContentSelector: '[role="main"]'                        │
│     → viewport 우선순위 영역 지정                                │
│                                                                 │
│ substack.com                                                    │
│ ├─ injectAsSibling: true                                       │
│ │   → 인라인 요소 뒤에 형제로 삽입 (내부 삽입 시 레이아웃 깨짐)   │
│ └─ mainContentSelector: '.post-content, .body-SxXE9l, article' │
│     → 본문 영역 특정                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 새 사이트 룰 추가 체크리스트

```
1. site-rules.ts 에 규칙 추가
2. tests/fixtures/ 에 해당 사이트 HTML 스니펫 저장
3. 테스트 작성 (감지 + 주입 + 라운드트립)
4. docs/pipeline.md 사이트 규칙 섹션 업데이트
5. npm run test → npm run lint → npm run build
```

---

## 5. Observer (observer.ts)

```
┌─────────────────────────────────────────────────┐
│ MutationObserver                                 │
│ 감시: document.body (childList + subtree)        │
│                                                  │
│ 새 노드 추가됨                                    │
│   │                                              │
│   ├─ 텍스트 노드? ────────── 무시                 │
│   ├─ data-b3rys-* 속성? ──── 무시 (자체 변경)     │
│   ├─ b3rys-* 클래스? ─────── 무시 (자체 변경)     │
│   └─ 일반 HTMLElement? ───── hasNewContent = true │
│                                                  │
│ hasNewContent?                                   │
│   │                                              │
│   └─ YES → 디바운스 500ms → onNewContent()       │
│            │                                     │
│            ├─ state=done → startTranslation()    │
│            │   (증분: 기존 BLOCK_ID 보존)          │
│            │                                     │
│            └─ state=loading → pendingRestart     │
│                + cancelTranslation()             │
└─────────────────────────────────────────────────┘

⚠️ 절대 하면 안 되는 것:
   Observer 콜백에서 removeAllTranslations() 호출
   → BLOCK_ID 전부 제거 → 전체 재감지 → 무한 루프
```

---

## 6. 배치 처리 + viewport 우선순위

```
detectTextBlocks() 결과
  │
  ├─ viewport 안 블록 ──→ main 영역 / side 영역 분리
  │   │                    │
  │   │                    ├─ Phase 1a: main 영역 (최우선)
  │   │                    │   VIEWPORT_BATCH_SIZE(5)개씩 병렬
  │   │                    │
  │   │                    └─ Phase 1b: side 영역
  │   │                        VIEWPORT_BATCH_SIZE(5)개씩 병렬
  │   │
  └─ viewport 밖 블록 ──→ 거리순 정렬
      │
      └─ Phase 2: BATCH_SIZE(15)개씩
         PARALLEL_BATCH_COUNT(3)그룹 동시

사용자 체감:
  화면에 보이는 본문 → 사이드바 → 스크롤 아래 순서로 번역 도착
```
