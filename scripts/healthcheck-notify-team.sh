#!/usr/bin/env bash
# Adapter: safe summary on stdin; bus script, member, and thread as argv.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo 'usage: healthcheck-notify-team.sh <send.sh path> <member> <thread>' >&2
  exit 2
fi
body="$(cat)"
"$1" --to "$2" --thread "$3" --body "$body"
