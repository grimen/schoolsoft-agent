#!/usr/bin/env bash
# Shared by publish-badges.sh / badges-cleanup.sh: a gh-pages worktree (the
# main checkout stays intact - these scripts live in it) and a push with
# rebase-retry, since branches publish concurrently. The default
# GITHUB_TOKEN can push to gh-pages (no branch protection there).

# gh_pages_worktree <dir>: worktree on gh-pages, or a fresh orphan when the
# branch does not exist yet. Prints nothing; returns 1 when asked not to
# create (CREATE=0) and the branch is missing.
gh_pages_worktree() {
  local dir="$1"
  git config user.name 'github-actions[bot]'
  git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  if git fetch -q origin gh-pages 2>/dev/null; then
    git worktree add -q "$dir" origin/gh-pages
    git -C "$dir" checkout -q -B gh-pages origin/gh-pages
  else
    [ "${CREATE:-1}" = 1 ] || return 1
    git worktree add -q --detach "$dir"
    git -C "$dir" checkout -q --orphan gh-pages
    git -C "$dir" rm -rfq --cached .
    git -C "$dir" clean -fdxq
  fi
}

# gh_pages_push <dir>: push gh-pages from the worktree, rebasing on conflict.
gh_pages_push() {
  local dir="$1" attempt
  for attempt in 1 2 3 4 5; do
    git -C "$dir" push -q origin gh-pages && return 0
    git -C "$dir" fetch -q origin gh-pages && git -C "$dir" rebase -q origin/gh-pages
    sleep $((attempt * 2))
  done
  echo "::error::could not push gh-pages after 5 attempts"; return 1
}
