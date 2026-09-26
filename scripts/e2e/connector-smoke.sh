#!/usr/bin/env bash
# Connector image smoke without SchoolSoft: builds Dockerfile.connector, then runs two
# network-isolated (--network none) container checks and removes everything it made.
#   1. test/packaging/connector-container.mjs: the production entrypoint (privilege
#      drop, encrypted persistence, restart, clean stop).
#   2. test/packaging/connector-flow-container.mjs: the scripted owner + OAuth + MCP
#      flow inside the image against a fake portal mounted read-only.
# Skips with exit 0 when Docker is unavailable, so it is safe on machines without it;
# set CONNECTOR_SMOKE_REQUIRE_DOCKER=1 to make that a failure instead.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if [ "${CONNECTOR_SMOKE_REQUIRE_DOCKER:-0}" = "1" ]; then
    echo "connector-smoke: Docker is required but no running daemon was found." >&2
    exit 1
  fi
  echo "connector-smoke: SKIPPED. Docker is not installed or its daemon is not running; nothing was built or tested."
  exit 0
fi

image="schoolsoft-connector:smoke-$$"
cleanup() {
  docker image rm -f "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --quiet -f Dockerfile.connector -t "$image" . >/dev/null
node test/packaging/connector-container.mjs "$image"
node test/packaging/connector-flow-container.mjs "$image"
echo "connector-smoke: passed."
