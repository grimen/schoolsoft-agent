#!/usr/bin/env bash
# Locate and run the schoolsoft-agent CLI. Resolution order:
#   1. $SCHOOLSOFT_AGENT_BIN            explicit path
#   2. sibling checkout                 <skill>/../../dist/cli/index.js
#   3. globally installed               schoolsoft-agent on PATH
#   4. npx                              npx -y schoolsoft-agent
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${SCHOOLSOFT_AGENT_BIN:-}" ]]; then
  exec "$SCHOOLSOFT_AGENT_BIN" "$@"
elif [[ -f "$here/../../../dist/cli/index.js" ]]; then
  exec node "$here/../../../dist/cli/index.js" "$@"
elif command -v schoolsoft-agent >/dev/null 2>&1; then
  exec schoolsoft-agent "$@"
else
  exec npx -y schoolsoft-agent "$@"
fi
