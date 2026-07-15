# gen-extension-icon

Chrome Extension 아이콘을 생성한다. SVG를 디자인하고 resvg-cli로 16/32/48/128px PNG를 생성하여 `public/` 디렉토리에 저장한다.

## 현재 디자인

- **배경**: 검은색 (#111111) 둥근 사각형 (rx=26)
- **테두리**: 초록 그라데이션 (#22c55e → #10b981), 3.5px
- **내용**: 상단 "A" (초록), 화살표 구분선, 하단 "가" (에메랄드)
- **의미**: 영어 → 한국어 번역

## 워크플로우

1. SVG 파일을 scratchpad에 작성
2. `npx -y resvg-cli` 로 4가지 사이즈 PNG 생성:
   ```bash
   npx -y resvg-cli icon.svg public/icon-128.png --fit-width 128 --fit-height 128
   npx -y resvg-cli icon.svg public/icon-48.png --fit-width 48 --fit-height 48
   npx -y resvg-cli icon.svg public/icon-32.png --fit-width 32 --fit-height 32
   npx -y resvg-cli icon.svg public/icon-16.png --fit-width 16 --fit-height 16
   ```
3. 128px PNG를 Read로 확인하여 결과 검증
4. `npx wxt build` 로 빌드 (WXT가 자동으로 manifest에 icons 등록)

## 주의사항

- SVG 텍스트는 시스템 폰트에 의존하므로 resvg 렌더링 결과가 다를 수 있음
- 16px에서도 식별 가능한 단순한 디자인 유지
- 브랜드 색상: 검정 (#111111) + 초록 (#22c55e, #10b981)
