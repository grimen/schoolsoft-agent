#!/usr/bin/env bash
# Packs the package and installs the tarball into a clean prefix, then
# asserts the consumer contract: both bins resolve, the CLI answers
# --version, and the MCP bin starts and lists its tools. Run from the repo
# root (CI: Checks / Packages). Local: make check-package.
set -euo pipefail
SMOKE="$(mktemp -d)"
trap 'rm -rf "$SMOKE"' EXIT
npm pack --pack-destination "$SMOKE" --silent >/dev/null
npm install -g --prefix "$SMOKE/prefix" --no-audit --no-fund --silent "$SMOKE"/schoolsoft-agent-*.tgz
BIN="$SMOKE/prefix/bin"
test -x "$BIN/schoolsoft-agent" && test -x "$BIN/schoolsoft-agent-mcp"
"$BIN/schoolsoft-agent" --version | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'
SCHOOLSOFT_CONFIG_DIR="$SMOKE/cfg" node "$(dirname "$0")/mcp-probe.mjs" 12 "$BIN/schoolsoft-agent-mcp"
echo "PACK SMOKE PASSED"
