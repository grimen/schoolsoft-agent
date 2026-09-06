#!/usr/bin/env bash
# Consumes what was ACTUALLY published: installs the exact version from npm
# into a clean prefix and asserts the consumer contract: both bins resolve,
# the CLI answers --version with that version, find-school works (public
# endpoint), and the MCP bin lists its tools.
# Usage: registry-smoke.sh <version>. CI: Verify job. Local: make registry-smoke V=<version>
set -euo pipefail
VERSION="${1:?usage: registry-smoke.sh <version>}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
echo "--- npm $(npm -v) / node $(node -v)"
for attempt in 1 2 3 4 5 6; do   # registry propagation
  npm install -g --prefix "$WORK/prefix" --no-audit --no-fund "schoolsoft-agent@$VERSION" && break
  echo "not yet on the registry ($attempt) - waiting"; sleep 20
done
BIN="$WORK/prefix/bin"
test "$("$BIN/schoolsoft-agent" --version)" = "$VERSION"
SCHOOLSOFT_CONFIG_DIR="$WORK/cfg" "$BIN/schoolsoft-agent" --school taby find-school --query rösjö \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(j.schools[0]?.slug!=="taby")process.exit(1);console.log("verify: find-school ok")})'
SCHOOLSOFT_CONFIG_DIR="$WORK/cfg" node "$(dirname "$0")/../mcp-probe.mjs" 17 "$BIN/schoolsoft-agent-mcp"
echo "REGISTRY SMOKE PASSED for $VERSION"
