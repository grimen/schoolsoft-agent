#!/usr/bin/env bash
# Shipped-artifact E2E without SchoolSoft: the built MCP server over stdio,
# the built CLI, the staged Claude Desktop bundle, and every host's launch
# manifest / skill wrapper in a sandbox (test/e2e-hosts). What CI's E2E
# stage runs; the live suite (make e2e) stays local because it needs BankID.
# Requires: make build skills mcpb-stage (make e2e-artifact does that).
set -euo pipefail
cd "$(dirname "$0")/../.."
./node_modules/.bin/tsx --test --test-concurrency=1 'test/e2e-hosts/*.e2e.test.ts' 'test/functional/cli-spawn.test.ts'
