#!/usr/bin/env bash
# Fail if grounding HTML fixtures contain common hallucinated tokens (see docs/AGENT_EVALUATION_CRITERIA.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILES=(
  "$ROOT/tests/fixtures/tetris_grounding.html"
  "$ROOT/tests/fixtures/tetris.html"
)
for FILE in "${FILES[@]}"; do
  if [[ ! -f "$FILE" ]]; then
    echo "missing: $FILE" >&2
    exit 1
  fi
  if command -v rg >/dev/null 2>&1; then
    if rg -n 'x_size|y_size|bag\.length0' "$FILE"; then
      echo "verify-grounding-fixture: forbidden tokens found in $FILE" >&2
      exit 1
    fi
  else
    if grep -nE 'x_size|y_size|bag\.length0' "$FILE"; then
      echo "verify-grounding-fixture: forbidden tokens found in $FILE" >&2
      exit 1
    fi
  fi
  echo "verify-grounding-fixture: OK ($FILE)"
done
