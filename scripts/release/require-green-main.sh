#!/usr/bin/env bash
# Release gate: a release run re-runs the whole pipeline itself, but the
# README badges and "is main green" mean the push-to-main run for that
# commit. Waits while that run is in flight, fails when it is red or missing.
# release-retry.yml re-runs the failed Publish once main turns green.
# Env: GH_TOKEN, REPO (owner/name), GITHUB_SHA, GITHUB_RUN_ID. CI only.
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${GITHUB_SHA:?}"
query="repos/$REPO/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=$GITHUB_SHA&per_page=5"
url="(none)"
for attempt in $(seq 1 60); do   # up to ~30 min
  read -r id run_status conclusion url < <(gh api "$query" \
    --jq '.workflow_runs[0] | if . then "\(.id) \(.status) \(.conclusion // "-") \(.html_url)" else "" end')
  if [ -z "${id:-}" ]; then
    echo "::error::no push-to-main CI run found for ${GITHUB_SHA::7} - release from a commit that reached main through a merge"
    exit 1
  fi
  if [ "$run_status" != completed ]; then
    echo "main run $url is $run_status - waiting ($attempt)"; sleep 30; continue
  fi
  if [ "$conclusion" != success ]; then
    echo "::error::main run $url concluded '$conclusion' - fix or re-run it (gh run rerun $id --failed); this release's Publish is re-run automatically once it is green"
    exit 1
  fi
  echo "main run $url is green"; exit 0
done
echo "::error::main run $url did not complete in time - re-run this job later (gh run rerun ${GITHUB_RUN_ID:-<run-id>} --failed)"
exit 1
