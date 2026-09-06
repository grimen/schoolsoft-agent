#!/usr/bin/env bash
# Classifies a PR's changed files so ci.yml can stop after Checks when only
# documentation changed (Unit and E2E skip; a skipped job counts as passing
# for required checks, unlike a workflow that never ran). "Docs" is docs/,
# *.md, LICENSE and the issue / PR templates - nothing else: workflow files
# change the thing under test, package.json and scripts feed the build.
# Only PRs are classified: main pushes already skip docs via paths-ignore,
# releases and dispatches always run everything.
# Env: EVENT_NAME (github.event_name), BASE_SHA (PR base). Output:
# docs-only=true|false to $GITHUB_OUTPUT (stdout when unset). CI: Changes job.
set -euo pipefail
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
if [ "${EVENT_NAME:-}" != pull_request ]; then
  echo "docs-only=false" >> "$OUT"; exit 0
fi
FILES=$(git diff --name-only "${BASE_SHA:?}"...HEAD)
if [ -z "$FILES" ]; then
  echo "docs-only=false" >> "$OUT"; exit 0
fi
NON_DOCS=$(printf '%s\n' "$FILES" | grep -Ev '^docs/|\.md$|^LICENSE$|^\.github/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)' || true)
if [ -z "$NON_DOCS" ]; then RESULT=true; else RESULT=false; fi
echo "docs-only=$RESULT" | tee -a "$OUT"
printf 'changed files:\n%s\n' "$FILES"
