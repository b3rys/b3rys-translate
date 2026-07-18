---
name: b3translate
description: b3rys translate 크롬 확장을 GitHub에서 설치하고 API 키 설정·사용법까지 끝까지 안내한다. 사용자가 `/b3translate`을 실행하거나, repo URL을 붙여넣거나, "b3rys 번역 확장 설치/사용법"을 요청하면 사용.
allowed-tools: Bash, Read, WebFetch
---

# b3rys translate — 설치 & 사용 가이드 (`/b3translate`)

이 스킬 하나로 **설치 → API 키 설정 → 사용법**까지 손잡고 끝낸다. self-contained라 다른 문서 없이 이
파일만으로 진행한다. 빌드된 zip을 받아 로드하는 방식이라 Node.js가 없어도 된다 (없으면 소스 빌드 폴백).

## ⚠️ 보안 원칙 (반드시 준수)

- **API 키를 채팅으로 받지 않는다.** 키는 사용자가 확장 팝업에 직접 입력한다. Claude는 발급 링크와 입력 위치만 안내한다.
- 사용자의 브라우저 설정·권한을 대신 바꾸지 않는다. `chrome://extensions` 조작은 사용자가 직접 하도록 단계별로 안내한다.
- 다운로드 출처는 사용자가 지정한 공식 repo(기본 `b3rys/b3rys-translate`)로 한정한다.

## 시작 방식

- 사용자가 **GitHub URL**을 줬으면 거기서 `owner/repo`를 추출한다.
- URL이 없으면 기본값 **`b3rys/b3rys-translate`**를 쓰되, 다른 repo인지 한 번 확인한다.
- 각 Phase를 끝낼 때마다 결과를 한 줄로 확인시키고 다음으로 넘어간다. 막히면 2~3회 이상 반복하지 말고 어디서 막혔는지 물어본다.

---

### Phase 0 — 사전 확인

1. **repo 파악**: URL → `owner/repo` 추출. 기본값 `b3rys/b3rys-translate`.
2. **Chrome(계열) 설치 확인**:

```bash
# macOS
ls "/Applications/Google Chrome.app" 2>/dev/null && echo "Chrome OK" || echo "Chrome 없음 (Chromium/Edge/Brave도 가능)"
```

Chromium 계열 브라우저가 하나도 없으면 설치 안내 후 중단.

3. **다운로드 도구**: `gh` CLI 우선, 없으면 `curl` 폴백.

```bash
command -v gh >/dev/null && echo "gh 있음" || echo "gh 없음 → curl 사용"
```

---

### Phase 1 — 확장 내려받기 + 압축 해제

설치 폴더는 **고정 경로**를 쓴다 (업데이트·재로드 편함). 기본 `~/b3rys-translate`.

**gh CLI가 있을 때** (최신 Release의 chrome zip):

```bash
DEST="$HOME/b3rys-translate"
mkdir -p "$DEST"
gh release download --repo <owner/repo> --pattern "*chrome*.zip" --dir "$DEST" --clobber
ZIP=$(ls "$DEST"/*chrome*.zip | head -1)
unzip -o "$ZIP" -d "$DEST/extension"
echo "설치 폴더: $DEST/extension"
```

**gh가 없을 때** (curl로 latest asset):

```bash
DEST="$HOME/b3rys-translate"; mkdir -p "$DEST/extension"
URL=$(curl -sL "https://api.github.com/repos/<owner/repo>/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*chrome[^"]*\.zip"' | head -1 | cut -d'"' -f4)
[ -n "$URL" ] && curl -L "$URL" -o "$DEST/ext.zip" && unzip -o "$DEST/ext.zip" -d "$DEST/extension"
echo "설치 폴더: $DEST/extension"
```

- Release가 없거나 zip을 못 찾으면 → **소스 빌드 폴백**(아래) 제안.
- unzip 후 `manifest.json`이 있는 폴더가 최종 로드 대상이다. 압축 구조에 따라 위치가 다를 수 있으니 확인:

```bash
find "$HOME/b3rys-translate/extension" -maxdepth 2 -name manifest.json
```

manifest.json이 있는 그 폴더 경로를 사용자에게 명확히 알려준다.

---

### Phase 2 — Chrome에 로드 (사용자가 직접)

`chrome://extensions`는 특권 페이지라 자동화 불가. **번호로 또박또박** 안내:

1. 주소창에 `chrome://extensions` 입력 후 이동
2. 우측 상단 **개발자 모드(Developer mode)** 토글 켜기
3. **압축해제된 확장 프로그램을 로드합니다(Load unpacked)** 클릭
4. Phase 1에서 확인한 **manifest.json이 있는 폴더** 선택
5. 목록에 "b3rys translate"가 나타나면 성공. 🧩 퍼즐 아이콘 → 📌 고정하면 편함

사용자가 "떴어/로드됐어"라고 확인하면 다음으로.

---

### Phase 3 — 번역 엔진 + API 키 (사용자가 직접 입력)

먼저 **어떤 엔진**을 쓸지 물어본다. 무료로 시작하려면 Gemini 추천.

| 엔진                             | 키 발급                                     | 가격 (1M 토큰, in/out) | 특징             |
| -------------------------------- | ------------------------------------------- | ---------------------- | ---------------- |
| **Gemini 3.1 Flash Lite** (추천) | https://aistudio.google.com/apikey          | $0.25 / $1.50          | 무료 할당량 있음 |
| GPT-4.1 Nano                     | https://platform.openai.com/api-keys        | $0.10 / $0.40          | 최저가 · 비추론  |
| Claude Haiku 4.5                 | https://console.anthropic.com/settings/keys | $1.00 / $5.00          | 품질 우선        |

안내 순서:

1. 고른 엔진의 발급 페이지 링크를 준다.
2. 키를 만들어 **복사**하라고 안내한다. (**키를 채팅에 붙여넣지 말라**고 명확히 말한다.)
3. Chrome 툴바의 **b3rys translate 아이콘 클릭 → 팝업**에서:
   - Engine 드롭다운에서 고른 엔진 선택 (라벨 옆 **ⓘ 설명**에 마우스를 올리면 엔진 비교 표가 뜬다)
   - API Key 칸에 붙여넣기 → 저장(✓)
4. 키는 브라우저 `chrome.storage`에만 저장되고 외부로 전송되지 않음을 알려준다. (번역 요청만 해당 엔진 API로 직접 전송)

---

### Phase 4 — 동작 확인 & 사용법

설치가 끝났으니 실제 기능을 시연하듯 안내한다.

**① 웹페이지 번역**

1. 영어 문서 페이지를 연다 (영문 위키백과, 블로그 등).
2. 페이지 **우측 하단 플로팅 버튼(A→가)** 클릭 → 원문 아래에 번역이 문단 단위로 삽입되면 성공.
3. 번역 중 무한 스크롤 등으로 새로 로드되는 콘텐츠도 이어서 번역된다. 버튼을 다시 누르면 OFF. 다른 페이지로 이동하면 번역이 꺼지므로 새 페이지에서 다시 누른다.

**② 선택 번역**

- 텍스트를 드래그하면 선택 영역 끝에 번역 트리거 버튼이 뜬다.
- **단어**(공백 없는 단일 단어): 번역 + 예문 2개 + 발음 듣기 컴팩트 팝업.
- **문장**: 번역 팝업 + 복사 버튼.

**③ YouTube 이중자막**

- 영상 플레이어 하단 컨트롤 바에 **A가** 버튼이 추가된다.
- 클릭 → 원문 + 번역 이중자막. 다시 클릭 → 해제.
- 표시 모드는 순환한다: 원문+번역 → 원문 → 번역 → 끄기.

**④ 비용 추적**

- 팝업 하단 **COST**에서 누적 비용 확인, 상세보기(▼)로 엔진별 사용량.
- **Limit**($)로 한도 지정 → 초과 시 번역 자동 차단(비우면 무제한).
- 플로팅 버튼 배터리 게이지로 한도 대비 사용량 시각화(초록→노랑→빨강).

번역이 안 나오면 체크: (a) API 키 저장됐는지, (b) 엔진 선택 맞는지, (c) 콘솔(F12)의 `[b3rys]` 에러, (d) 비용 한도 초과 여부.

---

### Phase 5 — 업데이트 / 제거

- **업데이트**: Phase 1을 다시 실행해 최신 zip으로 덮어쓴 뒤, `chrome://extensions`에서 b3rys translate 새로고침(↻).
- **제거**: `chrome://extensions`에서 제거(Remove) → 설치 폴더 `~/b3rys-translate` 삭제.

---

## 폴백 — 소스에서 빌드 (Release가 없거나 최신 소스를 원할 때)

Node.js(18+) 필요.

```bash
git clone https://github.com/<owner/repo>.git ~/b3rys-translate-src
cd ~/b3rys-translate-src
npm install
npm run build
# 로드 대상 폴더: dist/chrome-mv3  (여기에 manifest.json 있음)
```

이후 Phase 2~5는 동일하되, 로드할 폴더로 `dist/chrome-mv3`를 선택한다.

## 문제 대응

- 다운로드 실패 → repo가 공개인지, Release에 chrome zip asset이 있는지 확인. private면 `gh auth login` 필요.
- `unzip` 없음 → macOS는 기본 내장, Linux는 `apt install unzip` 등 안내.
- 로드 후 아이콘 안 보임 → 툴바 퍼즐 아이콘에서 고정.
- 2~3회 시도해도 막히면 무리하게 반복하지 말고, 어디서 막혔는지 사용자에게 물어본다.
