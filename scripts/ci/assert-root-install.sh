#!/usr/bin/env bash
# Fails when a root-only install pulled in the app's dependencies (spec: Workspace and fences).
set -euo pipefail
LEAKED=""
for pkg in expo react-native react react-dom expo-router jest-expo; do
  if [ -d "node_modules/$pkg" ]; then LEAKED="$LEAKED $pkg"; fi
done
if [ -n "$LEAKED" ]; then
  echo "root-only install leaked app dependencies:$LEAKED" >&2
  exit 1
fi
echo "root-only install: no app dependencies"
