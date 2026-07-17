# 개인정보 처리방침 / Privacy Policy

**최종 수정일 / Last Updated:** 2026-02-03

---

## 한국어

### 개요

b3rys translate(이하 "본 확장 프로그램")은 웹페이지와 YouTube 자막을 한국어로 번역하는 Chrome 확장 프로그램입니다. 본 확장 프로그램은 사용자의 개인정보를 수집, 저장 또는 전송하지 않습니다.

### 수집하지 않는 정보

본 확장 프로그램은 다음 정보를 **수집하지 않습니다**:

- 개인 식별 정보 (이름, 이메일, 계정 정보 등)
- 브라우징 히스토리 또는 방문 기록
- 분석, 추적, 텔레메트리 데이터
- 쿠키 또는 브라우저 핑거프린트

본 확장 프로그램은 자체 서버를 운영하지 않으며, 개발자에게 어떠한 데이터도 전송되지 않습니다.

### 로컬에만 저장되는 데이터

다음 데이터는 사용자의 브라우저에만 저장되며 외부로 전송되지 않습니다:

| 데이터      | 저장 위치              | 설명                                                                 |
| ----------- | ---------------------- | -------------------------------------------------------------------- |
| API 키      | `chrome.storage.local` | 사용자가 직접 입력한 번역 API 키. 기기 외부로 동기화되지 않음        |
| 설정        | `chrome.storage.sync`  | 엔진 선택, 버튼 표시 여부 등 기본 설정                               |
| 번역 캐시   | `chrome.storage.local` | 번역 결과 캐시 (LRU 방식, 7일 후 자동 만료, 최대 1,000개)            |
| 사용량 통계 | `chrome.storage.sync`  | 토큰 사용량 및 예상 비용 (로컬 계산, 외부 전송 없음, 기기 간 동기화) |

### 외부로 전송되는 데이터

번역 기능을 위해 다음 데이터가 사용자가 선택한 번역 API에 전송됩니다:

| 데이터                           | 전송 대상       | 목적      |
| -------------------------------- | --------------- | --------- |
| 웹페이지 텍스트 (번역 대상 문단) | 선택한 번역 API | 번역      |
| YouTube 자막 텍스트              | 선택한 번역 API | 자막 번역 |
| API 키                           | 해당 API 제공자 | 인증      |

지원하는 번역 API:

- **Google Gemini** — `generativelanguage.googleapis.com`
- **OpenAI** — `api.openai.com`
- **Anthropic** — `api.anthropic.com`
- **Google Cloud Translation** — `translation.googleapis.com`

각 API 제공자의 데이터 처리에 대해서는 해당 서비스의 개인정보 처리방침을 참조하시기 바랍니다.

### 권한 사용 목적

| 권한               | 목적                                  |
| ------------------ | ------------------------------------- |
| `activeTab`        | 현재 탭의 웹페이지 텍스트를 읽어 번역 |
| `storage`          | API 키, 설정, 번역 캐시를 로컬에 저장 |
| `host_permissions` | 번역 API 엔드포인트와 통신            |

### 데이터 삭제

모든 저장 데이터는 확장 프로그램을 제거하면 자동으로 삭제됩니다. 제거 전에 데이터를 삭제하려면 Chrome 설정 → 확장 프로그램 → b3rys translate → 저장 데이터 삭제를 사용하시기 바랍니다.

### 문의

개인정보 관련 문의사항이 있으시면 아래 GitHub Issues를 통해 연락해 주시기 바랍니다.

- https://github.com/makhae/b3rys-translate/issues

---

## English

### Overview

b3rys translate ("the Extension") is a Chrome extension that translates web pages and YouTube subtitles into Korean. The Extension does not collect, store, or transmit any personal information.

### Information We Do NOT Collect

The Extension does **not** collect:

- Personal identifiable information (name, email, account info, etc.)
- Browsing history or visited URLs
- Analytics, tracking, or telemetry data
- Cookies or browser fingerprints

The Extension does not operate any servers. No data is ever sent to the developer.

### Data Stored Locally Only

The following data is stored exclusively in the user's browser and is never transmitted externally:

| Data              | Storage                | Description                                                                                 |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| API Keys          | `chrome.storage.local` | Translation API keys entered by the user. Not synced outside the device                     |
| Settings          | `chrome.storage.sync`  | Engine selection, button visibility, and other preferences                                  |
| Translation Cache | `chrome.storage.local` | Cached translation results (LRU, expires after 7 days, max 1,000 entries)                   |
| Usage Statistics  | `chrome.storage.sync`  | Token usage and estimated cost (computed locally, never transmitted, synced across devices) |

### Data Transmitted Externally

To provide translation functionality, the following data is sent to the translation API selected by the user:

| Data                                    | Destination              | Purpose              |
| --------------------------------------- | ------------------------ | -------------------- |
| Web page text (paragraphs to translate) | Selected translation API | Translation          |
| YouTube subtitle text                   | Selected translation API | Subtitle translation |
| API Key                                 | Respective API provider  | Authentication       |

Supported translation APIs:

- **Google Gemini** — `generativelanguage.googleapis.com`
- **OpenAI** — `api.openai.com`
- **Anthropic** — `api.anthropic.com`
- **Google Cloud Translation** — `translation.googleapis.com`

Please refer to each API provider's privacy policy for details on how they handle data.

### Permission Usage

| Permission         | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `activeTab`        | Read web page text on the current tab for translation   |
| `storage`          | Store API keys, settings, and translation cache locally |
| `host_permissions` | Communicate with translation API endpoints              |

### Data Deletion

All stored data is automatically deleted when the Extension is uninstalled. To delete data before uninstalling, go to Chrome Settings → Extensions → b3rys translate → Clear storage data.

### Contact

For privacy-related inquiries, please reach out via GitHub Issues:

- https://github.com/makhae/b3rys-translate/issues
