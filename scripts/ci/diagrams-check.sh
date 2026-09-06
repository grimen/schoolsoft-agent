#!/usr/bin/env bash
# Fails when docs/diagrams/README.md is stale relative to the diagram sources
# (assemble-diagrams.mjs regenerates it) or an SVG is missing for a source.
# CI: Checks / Code. Local: make diagrams-check.
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/assemble-diagrams.mjs
# shellcheck disable=SC2016 # backticks in the message are markdown, not expansion
git diff --exit-code -- docs/diagrams/README.md \
  || { echo '::error::docs/diagrams/README.md is stale - edit src/*.mmd and run `make diagrams`'; exit 1; }
