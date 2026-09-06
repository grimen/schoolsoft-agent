#!/usr/bin/env bash
# Decides what a CI run publishes and stamps it into package.json.
#   release event : the tag IS the version (vX.Y.Z -> X.Y.Z, dist-tag latest;
#                   vX.Y.Z-<pre> -> dist-tag next). The commit must be on main.
#   anything else : prerelease <next-patch-after-latest-v*-tag>-pre.<run>.<sha>
#                   under dist-tag next.
# Env: EVENT (github.event_name, or "release" for a release_tag dispatch),
#      TAG (release tag), RUN (run number), GITHUB_SHA.
#      DRY_RUN=1 prints without touching package.json.
# Outputs version= and disttag= to $GITHUB_OUTPUT (stdout when unset).
# CI: Publish job. Local: make version [TAG=vX.Y.Z]
set -euo pipefail
cd "$(dirname "$0")/../.."
EVENT="${EVENT:-push}"; RUN="${RUN:-0}"; SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"

if [ "$EVENT" = release ]; then
  if ! printf '%s' "${TAG:-}" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
    echo "::error::release tag '${TAG:-}' is not vX.Y.Z or vX.Y.Z-<prerelease>"; exit 1
  fi
  if ! git merge-base --is-ancestor "$SHA" origin/main; then
    # shellcheck disable=SC2016 # backticks in the message are markdown, not expansion
    echo "::error::release commit ${SHA::7} is not on main - use \`gh release create --target main\`"; exit 1
  fi
  VERSION="${TAG#v}"
  case "$VERSION" in *-*) DISTTAG=next ;; *) DISTTAG=latest ;; esac
else
  LATEST=$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || echo v0.0.0)
  LATEST="${LATEST#v}"; LATEST="${LATEST%%-*}"
  IFS=. read -r MAJ MIN PAT <<< "$LATEST"
  VERSION="${MAJ}.${MIN}.$((PAT + 1))-pre.${RUN}.$(git rev-parse --short "$SHA")"
  DISTTAG=next
fi

if [ -z "${DRY_RUN:-}" ]; then
  npm pkg set version="$VERSION"
fi
{ echo "version=$VERSION"; echo "disttag=$DISTTAG"; } >> "$OUT"
echo "Publishing $VERSION under dist-tag $DISTTAG${DRY_RUN:+ (dry run)}"
