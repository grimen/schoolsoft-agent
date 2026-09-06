#!/usr/bin/env bash
# Docs are hand-maintained alongside code (docs/architecture.md). Warns
# (never fails) when architecture-relevant files change without any docs/
# update in the same push/PR. Hard rule (fails): a diagram source
# (docs/diagrams/src/*.mmd) may not change without its re-rendered SVG -
# `make diagrams` produces both; the pre-commit hook stages both.
# Range: PR -> origin/<BASE_REF>...HEAD; push -> HEAD~1; local -> origin/main.
# Env: EVENT_NAME, BASE_REF (CI). CI: Checks / Docs. Local: make docs-check.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "${EVENT_NAME:-}" = pull_request ]; then
  git fetch --no-tags --depth=1 origin "${BASE_REF:?}"
  CHANGED_FILES=$(git diff --name-only "origin/$BASE_REF"...HEAD 2>/dev/null || echo "")
elif [ -n "${EVENT_NAME:-}" ]; then
  CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || echo "")
else
  CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || echo "")
fi

ARCH_PATTERNS="^src/core/(index|config)\.ts$|^src/core/operations/registry\.ts$|^src/core/auth/|^src/core/api/|^plugins/|^package\.json$"
ARCH_CHANGES=$(echo "$CHANGED_FILES" | grep -E "$ARCH_PATTERNS" || true)
DOC_CHANGES=$(echo "$CHANGED_FILES" | grep -E "^docs/|README\.md$|^skills/" || true)

# (grep exits 1 when nothing matched; with pipefail that must not abort us)
STALE_SVGS=$(echo "$CHANGED_FILES" | { grep -E '^docs/diagrams/src/.*\.mmd$' || true; } | while read -r f; do
  svg="docs/diagrams/dist/$(basename "$f" .mmd).svg"
  echo "$CHANGED_FILES" | grep -qx "$svg" || printf ' %s' "$f"
done)
if [ -n "$STALE_SVGS" ]; then
  echo "::error::Diagram sources changed without re-rendered SVGs:$STALE_SVGS - run 'make diagrams' and commit the SVGs"
  exit 1
fi

if [ -n "$ARCH_CHANGES" ] && [ -z "$DOC_CHANGES" ]; then
  echo "::warning::Architecture-relevant files changed but docs were not updated:"
  echo "$ARCH_CHANGES"
  echo ""
  echo "Consider updating docs/architecture.md, docs/schoolsoft-api.md or docs/hosts/ if these change:"
  echo "  - the operation set or config surface"
  echo "  - the SchoolSoft endpoints used"
  echo "  - how a host installs the integration"
  {
    echo "## Documentation Status"
    echo ""
    echo ":warning: Architecture-relevant files changed without a docs/ update:"
    echo '```'
    echo "$ARCH_CHANGES"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  echo "Docs check OK"
fi
