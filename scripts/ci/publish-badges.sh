#!/usr/bin/env bash
# Publishes this branch's badges to gh-pages/badges/<branch>/: coverage.svg
# (when coverage/badge has one) plus unit/e2e .svg/.json rendered by
# status-badge.mjs. README.md embeds main's the way a workflow badge takes
# ?branch=main. cancel-closed.yml removes a PR's directory when it closes.
# Env: BRANCH, SHA. Expects the badges in coverage/badge/. CI: Badges job.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/ci/gh-pages-lib.sh
source scripts/ci/gh-pages-lib.sh
: "${BRANCH:?}" "${SHA:?}"
SRC="$PWD/coverage/badge"
WT="${RUNNER_TEMP:-/tmp}/gh-pages"

gh_pages_worktree "$WT"
mkdir -p "$WT/badges/$BRANCH"
[ -f "$SRC/coverage.svg" ] && cp "$SRC/coverage.svg" "$WT/badges/$BRANCH/"
cp "$SRC/unit.svg" "$SRC/unit.json" "$SRC/e2e.svg" "$SRC/e2e.json" "$WT/badges/$BRANCH/"
printf '%s\n' \
  '# CI-owned branch' \
  '' \
  'badges/<branch>/{coverage,unit,e2e}.svg (+ unit/e2e .json) - written by the' \
  'Badges job in .github/workflows/ci.yml (scripts/ci/publish-badges.sh) on every' \
  'CI run; a PR'"'"'s directory is removed when it closes (badges-cleanup.sh).' \
  'Do not edit by hand.' > "$WT/README.md"
git -C "$WT" add -A badges README.md
if git -C "$WT" diff --cached --quiet; then echo "badges unchanged"; exit 0; fi
git -C "$WT" commit -qm "chore(ci): badges for $BRANCH @ ${SHA::7}"
gh_pages_push "$WT"
