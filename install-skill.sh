#!/usr/bin/env bash
# b3rys translate — Claude Code 스킬 설치 (git 불필요, 개인 스킬)
# 사용:  curl -fsSL https://raw.githubusercontent.com/b3rys/b3rys-translate/main/install-skill.sh | bash
set -euo pipefail

SKILL_NAME="b3translate"
DEST="$HOME/.claude/skills/$SKILL_NAME"
RAW="https://raw.githubusercontent.com/b3rys/b3rys-translate/main/skills/$SKILL_NAME"

echo "b3rys translate 스킬 설치 중…"
mkdir -p "$DEST"
curl -fsSL "$RAW/SKILL.md" -o "$DEST/SKILL.md"

echo "✓ 설치 완료: $DEST/SKILL.md"
echo
echo "  Claude Code에서:"
echo "    /reload-skills     # 스킬 로드"
echo "    /b3translate       # 실행 (또는 자연어 \"번역 확장 설치해줘\")"
