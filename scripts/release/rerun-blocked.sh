#!/usr/bin/env bash
# When CI on main completes green for a commit, re-run the failed jobs of any
# release run for that commit (release event or release_tag dispatch) whose
# Publish refused to ship over a red main - see require-green-main.sh.
# Env: GH_TOKEN, REPO (owner/name), SHA (the green main commit). CI only.
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${SHA:?}"
for event in release workflow_dispatch; do
  gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=$event&head_sha=$SHA&per_page=20" \
    --jq '.workflow_runs[] | select(.conclusion == "failure") | "\(.id) \(.head_branch)"' \
  | while read -r id ref; do
      echo "main is green for ${SHA::7}: re-running failed jobs of $event run $id ($ref)"
      gh api -X POST "repos/$REPO/actions/runs/$id/rerun-failed-jobs" >/dev/null
    done
done
echo "done"
