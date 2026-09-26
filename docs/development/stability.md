# Stability policy

What users and integrators can rely on from one release to the next, what counts
as a breaking change, and how something is deprecated before it goes. It applies
from the first version published to a registry; everything before that may change
without notice.

## Versions

Versions follow [Semantic Versioning](https://semver.org), chosen by
release-please from Conventional Commits ([releasing](releasing.md#how-the-version-is-chosen)).

| Change                                  | While < 1.0.0                                   | From 1.0.0                      |
| --------------------------------------- | ----------------------------------------------- | ------------------------------- |
| Breaking (anything this page calls so)  | next **minor** (0.3.x → 0.4.0), marked breaking | next **major**, marked breaking |
| New capability, compatible addition     | next minor                                      | next minor                      |
| Fix, performance, compatible correction | next patch                                      | next patch                      |

**The pre-1.0 rule.** A patch release never breaks anything. A minor release
before 1.0 may, and when it does the changelog says so under **⚠ BREAKING
CHANGES**. npm's caret range already matches this: `^0.3.0` accepts `0.3.x` and
never `0.4.0`. Pin to a minor (`^0.3.0` or `~0.3.0`) if you script against
this tool.

**Marked breaking** means the change carries `!` after its type in the PR title
(`feat(cli)!: …`, `fix(mcp)!: …`) and a `BREAKING CHANGE:` footer in a commit on
the branch saying what changed and what a user has to do. Squash merges take the
PR title and the commits' messages, so both reach `main`, and release-please
reads either. A breaking change with neither marker is a release bug.

## What is stable, surface by surface

"Stable" means it changes only as a breaking change, after deprecation.
"Compatible" changes can ship in any minor. "Not a contract" can change in any
release, including a patch.

### MCP tools

| Part                                                                        | Stable                                                                                                                       | Compatible                                                                        | Breaking                                                                                                                                  | Not a contract                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Tool names (`schoolsoft_<operation>`), server binary `schoolsoft-agent-mcp` | yes                                                                                                                          | a new tool                                                                        | renaming or removing a tool                                                                                                               |                                                          |
| Input schema                                                                | names, types and meaning of every input                                                                                      | a new **optional** input; accepting more values (a wider range, a new enum value) | renaming or removing an input; making an optional input required; accepting fewer values; changing what an omitted input means            |                                                          |
| Output of a **typed** operation (declares `outputSchema`)                   | every declared field, its type, nullability and format (ISO dates, Stockholm offsets), id derivation                         | a new field                                                                       | removing, renaming or retyping a field; making a field nullable or optional; a new value in an output enum (such as `CalendarEvent.kind`) | key order, the truncated text copy                       |
| Output of an **untyped** operation (raw portal JSON)                        | nothing                                                                                                                      |                                                                                   |                                                                                                                                           | **everything, until the operation is typed** (E4.5)      |
| Annotations                                                                 | `readOnlyHint`, `destructiveHint`, `idempotentHint`                                                                          | a tool becoming safer (read-only, not destructive, idempotent)                    | a tool becoming less safe                                                                                                                 |                                                          |
| Error result                                                                | `isError: true`; two text lines (problem, then `Next: …`); for untyped tools `structuredContent.error.kind` and `.retryable` |                                                                                   | removing `kind` or `retryable` from an untyped tool's error                                                                               | the wording of both lines, `error.message`, `error.hint` |
| Tool `title` and `description`                                              |                                                                                                                              |                                                                                   |                                                                                                                                           | wording (tuned for agents)                               |

Consumers of typed outputs must ignore fields they do not know. Typing an
untyped operation is itself a breaking change for that operation's output (its
shape changes from the portal's JSON to the domain model) and is marked so;
after that, it is stable like the others.

Two untyped outputs are documented in the bundled skill and are kept stable
until they are typed: `auth_status` (`authenticated`, `loginInProgress`) and
the background `login` answer (`status`, `url`).

### CLI

| Part                                                                                                                                          | Stable                                                                                                                               | Compatible          | Breaking                                                           | Not a contract                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Binary `schoolsoft-agent`, command names (operation names in kebab case, plus `configure`, `doctor`, `browser …`)                             | yes                                                                                                                                  | a new command       | renaming or removing a command                                     |                                                                                                                   |
| Flags                                                                                                                                         | global flags (`--school`, `--org-id`, `--config-dir`, `--state-dir`, `--pretty`); per-command flags follow the MCP input rules above | a new optional flag | as for MCP inputs                                                  |                                                                                                                   |
| JSON on stdout (the default)                                                                                                                  | for typed operations, as their MCP output                                                                                            | as MCP              | as MCP                                                             | untyped operations; output of `configure`, `doctor` and `browser …` (diagnostics); whitespace (`--pretty` or not) |
| Text output (`--format text`, where available)                                                                                                |                                                                                                                                      |                     |                                                                    | **all of it**: for people, never parse it                                                                         |
| Exit codes by error kind (`EXIT_CODE_BY_KIND`: 1 bug, 2 not authenticated, 3 not configured, 4 network, 5 not available, 6 input, 7 upstream) | yes                                                                                                                                  |                     | changing a code, adding a code, moving a condition to another kind |                                                                                                                   |
| stderr                                                                                                                                        | the two-line shape (problem, then `Next:` / `Nästa steg:`)                                                                           |                     |                                                                    | the wording; warnings (such as deprecation notices) may be added                                                  |

**JSON stays the default, also on a terminal.** The CLI will not switch to text
output when stdout is a TTY; `--format text` is always opt-in. A TTY does not
mean a person is reading: agents and their hosts often run commands in a
pseudo-terminal (so that tools behave interactively, or through `script`,
`tmux` or an editor's terminal), and the bundled skill parses stdout as JSON
wherever it runs. A TTY-dependent default would hand those agents text they
cannot parse, depending on how their host happens to spawn processes. Changing
the default format in any form is a breaking change, and there is no plan to
make it.

### Error contract

- **Kinds** (`not_configured`, `not_authenticated`, `network`, `not_available`,
  `input`, `upstream`, `internal`) and what each means: stable. Adding a kind
  or moving a condition from one kind to another is breaking, with one
  exception: a condition that reached the user as a bug (`internal`, exit 1)
  and becomes a proper error of its kind is a fix.
- **`retryable`**: its meaning is stable (repeating the same call may succeed);
  correcting it for one condition is a fix.
- **Message keys** (`src/core/errors/messages.ts`) are internal: no surface
  exposes them, and they may be renamed in any release.
- **Message and hint wording**, in English and Swedish, is for people and
  can change in any release. Branch on the exit code, `kind`, `retryable` or
  the REST problem `type`, never on text.

### Configuration

- **Settings**: every `SCHOOLSOFT_*` environment variable and every
  `config.json` key in the [configuration table](architecture.md#configuration),
  plus `SCHOOLSOFT_LANG` and the skill wrapper's `SCHOOLSOFT_AGENT_BIN`.
  Renaming or removing one, or refusing a value it used to accept, is breaking;
  accepting a new value is compatible. The planned vendor-neutral renames of
  `SCHOOLSOFT_*` and of `userType`/`clientId` follow the deprecation process:
  the old name keeps working for the notice period.
- **Defaults** are part of the contract when a user can observe them (where
  files live, the callback port, what runs in the background, whether writes,
  the cache or keepalive are on). Changing one of those is breaking. A default
  that makes the tool do more on the user's behalf (writes, background
  requests) is never changed, breaking or not. Tuning values (cache TTLs and
  sizes, timeouts, back-off) are not a contract.
- **Precedence** (flags, then environment, then `config.json`, then defaults):
  stable.

### Persisted state

The files the tool keeps on disk are versioned
([versioned state spec](../planning/specs/2026-09-26-versioned-state.md)).
Their contents are not an interface: read them through the tool, never
directly. What is promised is the upgrade path:

- **Upgrade** migrates automatically: a newer release reads every older format
  it has a migration for, and rewrites the file on its next write. Bumping a
  format version with its migration is not a breaking change, but the commit
  body says so, because it ends the way back (next point).
- **Downgrade** is refused by design: an older build stops with
  `NewerFormatError` (exit 5, "update schoolsoft-agent") and leaves the file
  untouched. Going back means updating again or deleting the named file.
- Dropping a migration (so that an old file no longer upgrades) is breaking.
- Unversioned files (`login-pending.json`, `schools.json`, `key.bin`) are
  internal.

### Parent-hosted connector

- **REST API** (`/api/v1`, [reference](../reference/rest-api.md)). Stable
  within v1: route paths, query parameter names and meaning, response fields
  (typed outputs, with the rules above), the status code for each condition
  (in particular `401` for the app's token and `409` for the connector's
  SchoolSoft session), the problem `type` URIs
  (`urn:schoolsoft-agent:problem:*`), `kind`, `retryable`, `ownerDashboard` and
  the `/api/v1/session` fields. Compatible within v1: new routes, new optional
  query parameters, new response fields, new problem types (fall back on
  `status` for a `type` you do not know), a higher rate limit. Not a contract:
  `title`, `detail`, `hint` and `Content-Language` text. A breaking change is
  served as `/api/v2` next to v1; v1 is then deprecated and removed no earlier
  than the notice period below.
- **MCP over HTTP** (`/mcp`): the MCP tool rules above, for the tools the
  connector offers.
- **OAuth**: scope names (one per operation name) and per-child consent are
  stable. A release never widens an existing grant: a newly offered operation
  needs a new approval. Removing an operation from the connector is breaking.
  Endpoints and token lifetimes follow the MCP authorization specification and
  may change with it as long as the supported AI apps keep connecting.
- **Owner dashboard** (`/owner`): a page for the parent, not an API. Its layout,
  forms and paths may change in any release; link to it through the
  `ownerDashboard` value, not a hard-coded path.
- **Deployment settings** (`SCHOOLSOFT_PUBLIC_URL`, `SCHOOLSOFT_ADMIN_PASSWORD`,
  `SCHOOLSOFT_STORAGE_KEY`, `SCHOOLSOFT_SCHOOL`, `SCHOOLSOFT_STATE_DIR`,
  `SCHOOLSOFT_PROXY_HOPS`, `PORT`) follow the configuration rules above. The
  files in `deploy/` and the compose and Render files are examples; the
  settings they set are the contract.

### Library export

The package's `.` export (`dist/core/index.js`) is the core's internal
boundary for this project's own adapters. **It is not public API before 1.0**:
any release, including a patch, may change or remove anything in it, and it is
not covered by this page. Use the CLI, MCP or REST surfaces instead. Whether
1.0 ships a small, documented library API or drops the export is decided before
1.0.

### Skill and plugins

- The skill's name (`schoolsoft`), its wrapper path (`scripts/schoolsoft.sh`)
  and the plugin and bundle names (`schoolsoft-agent` marketplace and bundle,
  `schoolsoft-mcp`, `schoolsoft-skill`) are stable: users install and refer to
  them by name.
- The skill's instructions and the manifests' other contents may change in any
  release. Changes a host requires of its own manifest format are not breaking
  changes of this project.

### SchoolSoft itself

SchoolSoft's API is unofficial and can change at any time. Such a change is not
a breaking change of this project. For a typed operation the designed outcome
is a `response_drift` error (exit 7, REST `502` `response-drift`) that returns
nothing rather than wrong data; the repair ships as a `fix:`. If SchoolSoft
stops providing something a typed output promises, the field becomes `null`
where the schema allows it; otherwise the change to our output is a breaking
change like any other.

### Node.js

The supported range is `engines.node` in `package.json` (today `>=22`).
Dropping a Node.js major is breaking and happens no earlier than that major's
end of life. Support for a newer Node.js major is compatible.

## Deprecation

Something stable is deprecated before it is removed or changed incompatibly.

1. **Mark it** in a releasable commit (`feat(<scope>): deprecate <x> in favour
of <y>`), so it appears in the changelog, with the replacement and the
   earliest removal version in the body. The operation's description or the
   documentation starts with `Deprecated:` and names the replacement; generated
   references pick that up.
2. **Warn at run time** where the surface has a channel for it: one line on
   stderr from the CLI (stdout and the exit code unchanged); for a deprecated
   setting, a stderr line at startup and a `doctor` warning; for REST, a
   `Deprecation` header (RFC 9745) and, once the date is set, `Sunset`
   (RFC 8594). MCP tools rely on the description.
3. **Keep it working** for the notice period: while < 1.0.0, at least one
   released minor carries the deprecation (deprecated in 0.4.0, removed in
   0.5.0 at the earliest); from 1.0.0, until the next major.
4. **Remove it** as a breaking change (`!` and a `BREAKING CHANGE:` footer
   naming what to use instead).

Exceptions: a security or privacy problem, or a capability SchoolSoft no longer
provides, may be removed without notice. It is still marked breaking.

## Is my change breaking?

A short check for contributors and agents; the sections above decide.

- Does a tool, command, flag, input, route or setting disappear or get a new
  name? Breaking.
- Does a call that worked before now fail (a new required input, a narrower
  range, a stricter setting)? Breaking.
- Does a typed output lose, rename or retype a field, or gain a nullable one or
  a new enum value? Breaking.
- Does an error move to another kind or exit code? Breaking, unless it was a bug
  (exit 1) before.
- Does an observable default change? Breaking.
- Does a persisted format change? Ship the migration; not breaking, but say so.
- Only wording, descriptions, untyped output, text output, diagnostics or the
  library export? Not breaking.

If it is breaking: deprecate first where the notice period applies, then mark
the removal with `!` and a `BREAKING CHANGE:` footer.
