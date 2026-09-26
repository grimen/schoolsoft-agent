# Contributing

## Setup

```sh
make setup      # node >= 22 check + npm ci (also installs git hooks via lefthook)
make help       # every target
```

Nothing else is needed for the offline gates. The live suite needs a
SchoolSoft guardian account: `make configure`, `make login` (BankID in your
browser), then `make e2e`.

## Quality gates

Cheap first, expensive last; CI runs them in this order and stops at the
first red stage (`.github/workflows/ci.yml`):

| Stage            | Local                                                                                                                                    | What                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checks           | `make check-code`, `make check-ci`, `make audit`, `make diagrams-check`, `make docs-check`, `make plugin-validate`, `make check-package` | oxlint, typecheck, prettier, import boundaries; actionlint + shellcheck; dependency audit; generated diagrams/docs/skills current; host manifests; publint + pack/install smoke; Conventional Commits on PR commits and title                                             |
| Unit             | `make coverage`                                                                                                                          | unit + boundary + functional + packaging tests with c8 thresholds (`.c8rc.json`)                                                                                                                                                                                          |
| E2E              | `make e2e-artifact`, `make connector-smoke`                                                                                              | the shipped artifact: MCP over stdio, the CLI, the Claude Desktop bundle, and every host manifest / skill wrapper launched in a sandbox (`test/e2e-hosts`); the connector's Docker image with `--network none`, including the full OAuth + MCP flow against a fake portal |
| Publish → Verify | —                                                                                                                                        | main pushes ship a prerelease under `next`; releases ship `latest`; Verify installs what was published                                                                                                                                                                    |

`make check` runs the Checks + Unit set in one go. The live SchoolSoft suite
(`make e2e`) needs a human with BankID and never runs in CI.

Coverage is measured, not hardcoded: CI renders the badge from c8's summary
and publishes it per branch to `gh-pages/badges/<branch>/`; the README embeds
`main`'s. A red `failing` badge replaces it when the coverage run fails. The
HTML report is the `coverage-report` run artifact.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org):

```text
<type>(<scope>): <imperative summary>

[optional body - what and why, wrapped at 100 columns]

[optional footer - BREAKING CHANGE: ..., Closes #123]
```

| Type       | Use for                                                    |
| ---------- | ---------------------------------------------------------- |
| `feat`     | A user-facing capability (a new operation, a new host)     |
| `fix`      | A bug fix                                                  |
| `perf`     | A performance improvement with no behaviour change         |
| `refactor` | Code change that neither fixes a bug nor adds a feature    |
| `test`     | Adding or correcting tests only                            |
| `docs`     | Documentation only (README, `docs/`, diagrams, skill text) |
| `build`    | Build system, packaging, dependencies of the build itself  |
| `ci`       | GitHub Actions workflows and CI tooling                    |
| `chore`    | Maintenance that touches none of the above                 |
| `style`    | Formatting only                                            |
| `revert`   | Reverts a previous commit                                  |

Scopes are optional but, when present, must be one of
(`commitlint.config.mjs` is the source of truth): `core`, `mcp`, `cli`,
`skill`, `plugins`, `http`, `e2e`, `ci`, `deps`, `deps-dev`, `docs`,
`release`.

The type decides the changelog section and the version bump
([docs/development/releasing.md](docs/development/releasing.md)): `feat` → minor, `fix`/`perf` →
patch, everything else → no release. A fix that only touches CI is `ci:`,
not `fix(ci):`.

### Is my change breaking?

The [stability policy](docs/development/stability.md) decides; in short:

- A tool, command, flag, input, REST route or setting is renamed or removed,
  or a call that worked before now fails (new required input, narrower range,
  stricter setting).
- A typed output loses, renames or retypes a field, or gains a nullable field
  or a new enum value.
- An error changes kind or exit code (unless it was exit 1, a bug, before), or
  an observable default changes.

Any of these is breaking: deprecate first where the policy's notice period
applies, then put `!` in the PR title (`feat(cli)!: …`) and a
`BREAKING CHANGE: <what changed, what to do>` footer in a commit. Wording,
descriptions, untyped (raw) output, `--format text` output and the library
export are not contracts. A persisted-format change ships its migration and
says so in the commit body.

**Where it is enforced:** the `commit-msg` hook runs commitlint on every
local commit, and the `Checks / Commits` job re-checks the PR's commits and
its **title** on every push and title edit. Squash merges use the title as
the commit on `main`, so name the PR the way you would name a commit.

## Git hooks

[lefthook](https://github.com/evilmartians/lefthook) installs the hooks on
`npm install` (via the `prepare` script). Fast local gates only; CI is the
authoritative check.

| Hook                          | What runs                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit`                  | prettier on staged files (auto-fixed and re-staged); oxlint on staged TS; regenerate + stage reference docs and skill copies when an operation changes; re-render + stage diagrams when a `.mmd` source changes. Skipped during merge and rebase replays. |
| `commit-msg`                  | commitlint against `commitlint.config.mjs`                                                                                                                                                                                                                |
| `pre-push`                    | typecheck + import boundaries                                                                                                                                                                                                                             |
| `post-merge`, `post-checkout` | `npm ci` when `package-lock.json` changed                                                                                                                                                                                                                 |

Escape hatches: `git commit --no-verify` skips `pre-commit` and
`commit-msg` once; `LEFTHOOK=0 git push` skips every hook for that command;
`lefthook-local.yml` (gitignored) overrides commands for your machine.

## Making changes

1. Branch from `main` (in a git worktree if you run parallel sessions); keep
   the PR focused on one change.
2. A new capability is one file in `src/core/operations/` plus one line in
   `registry.ts`. Then `make docs skills` (the pre-commit hook does it for
   you) so the generated reference and skill copies stay current; CI fails on
   drift.
3. Diagrams: edit `docs/diagrams/src/*.mmd`, then `make diagrams` (the hook
   does it). Never inline Mermaid in Markdown; embed the SVG and link the
   source, as `docs/development/architecture.md` does.
4. Anything that touches SchoolSoft's API or auth: run `make e2e` locally and
   say so in the PR (counts only, never data).
5. Open a PR with a Conventional Commits title; every check must be green.

## Live pass

Some behaviour can only be confirmed with a real guardian login. The open items are
tracked in issue #25 (E2). Do them in this order, in one sitting:

1. `make login`, then `make login-web` (both open your own browser; BankID is never
   automated).
2. `make capture`. It uses the saved sessions only, never logs in, never submits a
   form and never calls a write endpoint. It writes redacted files to `.captures/`,
   which git ignores: the structure of the absence, leave and message forms, the
   Översikt page, and a school-event agenda. Without a saved session it stops with
   the usual "not logged in" message before doing anything.
3. **Read every file in `.captures/` yourself.** No child's name, subject, teacher,
   free text, e-mail, phone number or id may remain. Fix or delete anything that
   does. Put names the check should know about in `.capture-denylist` (also ignored
   by git, one per line).
4. `make capture-promote`. It checks every file again and refuses to move anything
   if one of them still looks personal; otherwise it moves them into
   `test/fixtures/`. Then read `git diff`, run `make format`, and commit only what
   you have read.
5. The live items: `make e2e`, `make browser-verify`, the connector checks in
   [docs/deployment/connector.md](docs/deployment/connector.md#what-still-needs-a-real-acceptance-test),
   then `make fingerprints`.

## Releases

See [docs/development/releasing.md](docs/development/releasing.md). Short version: merging the
release PR that release-please opens is the release. Every push to `main`
also ships a prerelease under the `next` dist-tag.
