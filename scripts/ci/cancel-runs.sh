#!/usr/bin/env bash
# Cancels every queued or running workflow run for a commit (a closed PR's
# head), except the run executing this script. The push-to-main run is on a
# different commit and untouched.
# Env: GH_TOKEN, REPO (owner/name), SHA, GITHUB_RUN_ID. CI: cancel-closed.yml.
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${SHA:?}"
SELF="${GITHUB_RUN_ID:-0}"
for status in queued in_progress; do
  gh api "repos/$REPO/actions/runs?head_sha=$SHA&status=$status&per_page=100" \
    --jq ".workflow_runs[] | select(.id != $SELF) | \"\(.id) \(.name)\"" \
  | while read -r id name; do
      echo "cancelling $id ($name)"
      gh api -X POST "repos/$REPO/actions/runs/$id/cancel" >/dev/null
    done
done
