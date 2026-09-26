#!/usr/bin/env bash
# app-changed=true when the app, the typed client or the dependency set changed (always on pushes).
set -euo pipefail
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
if [ "${EVENT_NAME:-}" != pull_request ]; then
  echo "app-changed=true" >> "$OUT"; exit 0
fi
FILES=$(git diff --name-only "${BASE_SHA:?}"...HEAD)
if printf '%s\n' "$FILES" | grep -Eq '^packages/app/|^src/client/|^package(-lock)?\.json$|^scripts/ci/changed-app\.sh$|^\.github/workflows/app\.yml$'; then
  echo "app-changed=true" | tee -a "$OUT"
else
  echo "app-changed=false" | tee -a "$OUT"
fi
