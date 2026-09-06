#!/usr/bin/env bash
# Removes gh-pages/badges/<branch>/ for a closed PR. No gh-pages branch yet:
# nothing to clean. Env: BRANCH. CI: cancel-closed.yml.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/ci/gh-pages-lib.sh
source scripts/ci/gh-pages-lib.sh
: "${BRANCH:?}"
WT="${RUNNER_TEMP:-/tmp}/gh-pages"

CREATE=0 gh_pages_worktree "$WT" || { echo "no gh-pages branch - nothing to clean"; exit 0; }
[ -d "$WT/badges/$BRANCH" ] || { echo "no badges for $BRANCH"; exit 0; }
git -C "$WT" rm -rq "badges/$BRANCH"
git -C "$WT" commit -qm "chore(ci): drop badges for closed branch $BRANCH"
gh_pages_push "$WT"
