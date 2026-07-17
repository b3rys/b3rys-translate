# Manual Fixtures

These fixtures require manual capture (login or network tab).

## YouTube Timed Text

### ASR (자동 생성 자막)

- **특징**: 단어별 타이밍, 문장 구분 없음 → `mergeCues` 파이프라인 테스트

| File                                     | Source                                      |
| ---------------------------------------- | ------------------------------------------- |
| `youtube-timedtext-asr-bTQM3oEW0gk.json` | https://www.youtube.com/watch?v=bTQM3oEW0gk |
| `youtube-timedtext-asr-AUcYJczWXT4.json` | https://www.youtube.com/watch?v=AUcYJczWXT4 |

### Manual (수동 자막)

- **특징**: 문장 단위 cue, `\n` 줄바꿈 포함 → `mergeCuesTwoLine` 파이프라인 테스트

| File                                        | Source                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `youtube-timedtext-manual-tnsrnsy_Lus.json` | https://www.youtube.com/watch?v=tnsrnsy_Lus&t=372s |

### 캡처 방법

1. 해당 URL 열기
2. DevTools → Network → `timedtext` 필터
3. 응답 본문 복사 → 위 파일명으로 저장

## Substack Chat

- **File**: `substack-chat.html`
- **Source**: Substack chat page (login required)
- **Capture**: DevTools → Elements → Copy outerHTML of chat container

## Skilljar Course

- **File**: `skilljar-course.html`
- **Source**: Anthropic Skilljar course page (login required)
- **Capture**: DevTools → Elements → Copy outerHTML of course content
