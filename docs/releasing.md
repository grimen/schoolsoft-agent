# Releasing

How a change goes from a merged PR to a published version, and the one thing
a human does along the way: merge the release PR.

## Where it publishes

Both registries, from the same Publish job, controlled by two flags at the top
of `ci.yml`:

- **GitHub Packages** (`PUBLISH_GITHUB: "true"`): always, as
  `@grimen/schoolsoft-agent`, using the workflow's own `GITHUB_TOKEN`. Nothing
  to set up. The scoped name is applied only in that step; the repository,
  the bins (`schoolsoft-agent`, `schoolsoft-agent-mcp`) and the Claude Desktop
  bundle keep the unscoped name. Consumers need a GitHub token with
  `read:packages` even for public packages, so the parent-facing
  `npx -y schoolsoft-agent` lines in the guides only work once we are on npm;
  until then the install path is in `docs/troubleshooting.md` ("not on npm
  yet").
- **npm** (`PUBLISH_NPM: "auto"`): as `schoolsoft-agent` with provenance,
  automatically as soon as the `NPM_TOKEN` secret exists; until then the step
  is skipped, never failed. `"true"` / `"false"` force it either way.

Verify runs once per registry that was actually published to, installing the
exact version from it.

## The short version

1. Merge PRs to `main` as usual. Every PR title is a Conventional Commit
   (commitlint enforces it); the squash merge makes that title the commit.
2. Each push to `main` publishes a prerelease under the `next` dist-tag
   (`npm i schoolsoft-agent@next` once on npm; `@grimen/schoolsoft-agent@next`
   from GitHub Packages).
3. When a `feat:`, `fix:`, `perf:` or `revert:` commit reaches `main`,
   release-please opens (or updates) one pull request titled
   `chore(release): X.Y.Z` with the next version and the changelog entry for
   everything since the last release.
4. Approve it and merge it: `make release`, or the Merge button. That is the
   release. release-please tags `vX.Y.Z`, creates the GitHub Release with the
   changelog entry as its body, and starts the release run of `ci.yml`, which
   stamps the version, runs Checks → Unit → E2E, waits for the commit's main
   run to be green, publishes to the registry under `latest` (with provenance
   on npm), builds
   the Claude Desktop bundle and attaches it to the release. Verify then
   installs the published version and asserts the consumer contract.

`package.json`'s version is maintained by release-please; nothing is edited
by hand.

## How the version is chosen

release-please reads the commits since the last `v*` tag:

| Commits since the last release                                          | Bump (while < 1.0.0) | Bump (from 1.0.0) |
| ----------------------------------------------------------------------- | -------------------- | ----------------- |
| only `ci:`, `docs:`, `chore:`, `build:`, `refactor:`, `test:`, `style:` | none: no release PR  | none              |
| at least one `fix:` / `perf:` / `revert:`                               | patch                | patch             |
| at least one `feat:`                                                    | minor                | minor             |
| `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer                       | minor                | major             |

To force a specific version once, add a footer to any commit on `main`:
`Release-As: 1.0.0`.

## What lands in the changelog

Only the sections that mean something to a user: **Features**, **Bug
Fixes**, **Performance**, **Reverts**. CI, docs, chores and dependency bumps
stay in git and on the PR, not in `CHANGELOG.md`. Because the type decides
the section, use the type that describes what shipped: a fix that only
touches CI is `ci:`, not `fix(ci):`.

## What happens on merge, step by step

1. The squash merge `chore(release): X.Y.Z` lands on `main`. `ci.yml` runs
   for it like any push and publishes a `-pre` build under `next`.
2. `release-please.yml` runs on the same push, finds the merged release PR,
   creates the `vX.Y.Z` tag and the GitHub Release, and dispatches `ci.yml`
   at that tag with `release_tag=vX.Y.Z`. The explicit dispatch exists because
   GitHub never triggers workflows from events the workflow token created.
3. That release run stamps `X.Y.Z`, runs the full pipeline, then Publish
   waits for the commit's push-to-`main` run to be green (fails on a red one)
   and publishes under `latest`. Verify installs what was published.
4. If the main run was red (a flaky job), re-run its failed job
   (`gh run rerun <id> --failed`); `release-retry.yml` re-runs the blocked
   Publish as soon as main is green. Nothing to re-tag.

CI does not run on the release PR itself (same token rule); it only changes
`CHANGELOG.md`, the manifest and `package.json`.

## Hand-cut prereleases (rc)

`make release-rc V=X.Y.Z-rc.1` creates a `vX.Y.Z-rc.1` tag and prerelease by
hand. It goes through the `release:` trigger and ships under `next`.
release-please ignores such tags.

## Setup that must exist once

- **`NPM_TOKEN`** repository secret, only when `PUBLISH_REGISTRY` is `npm`:
  an npm automation token for the `schoolsoft-agent` package. `GITHUB_TOKEN`
  cannot publish to npmjs.com. GitHub Packages needs no secret.
- Settings → Actions → General → "Allow GitHub Actions to create and approve
  pull requests" must be on, or release-please cannot open the release PR.
- `gh-pages` badges need nothing: the default token can push there.

## When something goes wrong

- **The release run failed after tagging.** Registries never accept a
  version twice, so fix forward, merge, and the next release PR bumps again. A run
  that failed _before_ Publish can be re-run.
- **No release PR appears.** Nothing releasable has merged since the last
  tag, or the `Release Please` workflow run on `main` failed (check the
  Actions setting above).
- **The version is wrong.** Push a commit with a `Release-As: X.Y.Z` footer.

## Configuration

- `release-please-config.json`: root component, `release-type: node`,
  `vX.Y.Z` tags, pre-1.0 bump policy, PR title pattern (`release` is a
  commitlint scope), changelog sections.
- `.release-please-manifest.json`: the last released version.
- `.github/workflows/release-please.yml`: the workflow described above.
- `scripts/release/resolve-version.sh`: what a CI run publishes
  (`make version` shows it for HEAD; `make version TAG=vX.Y.Z` for a tag).
- `scripts/release/require-green-main.sh`, `rerun-blocked.sh`,
  `.github/workflows/release-retry.yml`: the green-main gate and its retry.
- `scripts/release/registry-smoke.sh`: the Verify job
  (`make registry-smoke V=X.Y.Z` locally).
