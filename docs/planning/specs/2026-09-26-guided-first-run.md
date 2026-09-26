---
title: Guided first run
type: feature
created: 2026-09-26
status: in-review
route: dispatch
baseline_commit: 5c68e44
context:
  - AGENTS.md
  - docs/development/architecture.md
  - docs/development/stability.md
  - docs/planning/specs/2026-09-26-cli-text-output.md
  - docs/planning/specs/2026-09-26-doctor-verify.md
  - docs/planning/specs/2026-09-26-accounts-by-school.md
  - docs/getting-started/data-handling.md
  - https://github.com/grimen/schoolsoft-agent/issues/35
---

# Guided first run (E11.2)

A parent who types `npx -y schoolsoft-agent` today gets a list of 30 commands and exit 6. To reach a schedule they must know to run `configure --query`, then `login`, then `get-schedule --format text`, in that order, from a README. This change makes the first run a guide: in plain Swedish or English it finds the school, saves it, opens BankID in the parent's own browser, checks that the portal answers, shows this week's schedule, and says where the data lives and how to add the tool to an AI assistant. Built offline: no SchoolSoft login, no BankID round and no request to schoolsoft.se took place.

<frozen-after-approval>

## Intent

On a fresh machine, `schoolsoft-agent` with no arguments, in a terminal, walks a non-technical parent from nothing to their child's schedule without any documentation open. The same flow is a command, `setup`, that scripts and CI can run without a single prompt, and that a parent can run again to continue where they stopped.

## Scope

In: a new `setup` command; the bare invocation starting it under strict conditions; five steps (school, settings, login, check, schedule) and a closing section (where data lives, how to add an assistant, useful commands); English and Swedish text for all of it; two new error messages; docs (command reference, terminal page, README, stability policy, architecture).

Out, each a later story if wanted: writing an assistant's configuration file (Claude Desktop, Codex, OpenCode) for the parent, which touches files other programs own; `login --web` and `browser install` inside the guide (the five typed reads need neither); a text view of `setup`'s JSON result; choosing among several children during the guide (the schedule is the child in focus, and the closing section says how to see the others); changing `configure`'s existing exit codes (its "nothing to configure", "no match" and Ctrl+C exits are exit 1 today; making them proper kinds is a fix for a separate change).

**No split is needed.** The story is one command and one entry-point rule over existing parts (school directory, config writer, `login`, `verifyOperations`, the schedule's text view); everything fits one reviewable pull request.

## Entry points

**`schoolsoft-agent setup`** is a new command (compatible: a new command). It always runs the guide.

**`schoolsoft-agent` with no arguments** starts the guide only when all of these hold; otherwise it prints the help on stderr and exits 6, exactly as before:

- stdin is a terminal (the CLI only has a prompt then) and stdout is a terminal;
- `CI` is unset or empty;
- no school is configured: resolving the configuration (flags, environment, `config.json`) raises `not_configured`. A broken or newer `config.json` is not "unconfigured": the help is printed and the next command reports the problem as usual.

A script, a pipe, a CI job or an agent's non-interactive shell therefore sees no change. The one risk is an agent running the bare command in a pseudo-terminal on an unconfigured machine: it gets a question instead of the help. The first lines say how to leave (Ctrl+C) and the guide never does anything before an answer, so nothing happens on the parent's behalf; the stability policy records the rule.

## Interactive and non-interactive

The guide asks questions only when it is **interactive**: a prompt exists (stdin is a TTY) and none of the answer flags is given. The answer flags are `--query <name>`, `--no-login` and the global `--school` and `--org-id`. With any of them, or without a TTY on stdin, the guide never prompts:

| Question | Interactive | Non-interactive |
| --- | --- | --- |
| Which school? | asks for a name; lists the matches and asks for a number when there is more than one; asks again (at most three tries) on no match, an empty answer or an invalid number | `--school` (with optional `--org-id`) is saved as given; `--query` takes the best match, as `configure --query` does, and prints its name; neither and nothing configured: `not_configured`, exit 3 |
| Open the browser? | explains BankID and waits for Enter | opens it at once, unless `--no-login` |
| No saved login and `--no-login` | (not interactive) | `not_authenticated`, exit 2, after the school is saved |

Steps already done are reported and skipped: a configured school without answer flags is kept ("Already done"), a saved login that still restores is used. So `setup` is safe to run again, and a parent who pressed Ctrl+C continues where they stopped.

## The steps

Everything a person reads goes to **stderr**, like the prompts (the readline interface writes there) and `configure`'s list of matches. Stdout stays machine-readable (see Output).

1. **Find the school.** `find_school`'s directory (the provider's public list, cached in `schools.json`), five best matches, shown by name only; a parent does not need the slug or orgId to choose.
2. **Save the settings.** The same write as `configure`: the school becomes the current account in `config.json`, other schools keep their settings (accounts by school). Prints the name, the short name and the file.
3. **Log in with BankID.** First `ensureSession()`: a saved login that restores is kept. Otherwise the `login` operation through `runOperation`, as `schoolsoft-agent login` does: the parent's own browser opens SchoolSoft's page; BankID is never automated. While it waits, the guide watches the pending-login marker and prints the login address once it is known, so a parent whose browser did not open can open it on the same computer. Says "Never type BankID codes or passwords here".
4. **Check that it works.** `verifyOperations` from `doctor --verify` for the child in focus, with the browser's readiness measured locally as `doctor --verify` does: the typed reads, once each, fresh, nothing shown. "Everything works: 5 of 5 checks passed", plus the number of children. Skipped checks are named as skipped, not failed. On drift or an error it stops with two lines (what failed, then "Next:" `doctor --verify` and the troubleshooting guide) and `verifyExitCode`'s code (7 for drift, the error's kind otherwise), the same code `doctor --verify` would give.
5. **Show something real.** `get_schedule` through `runOperation` with its defaults (this ISO week, the child in focus), rendered with the existing `--format text` view, without colour (the view goes to stderr, whose terminal the CLI does not probe). With more than one child, one line says how to see the others.

**Closing section.** Where the data lives (the configuration folder and the state folder with the encrypted login, from the resolved config); that answers are not saved and nothing reaches the project's author; a link to `docs/getting-started/data-handling.md`; that what the parent asks an assistant about goes to that assistant's company; one link each for Claude Desktop (with the school's short name, which its extension asks for), ChatGPT and the list of other assistants, per the host guides; and three everyday commands. Commands are printed as `npx -y schoolsoft-agent …` when the guide itself runs under `npx` (`npm_command=exec`), else as `schoolsoft-agent …`. Links point to the guides on GitHub's `main` branch; a test fails if a linked file does not exist in the repository.

## Language

Every sentence is in one English/Swedish table in the CLI adapter (`src/cli/guide/words.ts`), with a test that every key has both languages and no empty text, like the text views' labels. The language is `detectLang` (`SCHOOLSOFT_LANG`, else the locale), the same as errors and views. The welcome says, in both languages, that the project is independent and not made by SchoolSoft AB or BankID. BankID and SchoolSoft are named descriptively only.

## Output and exit codes

- **Stdout for `setup`:** one JSON object at the end, the same way every command answers (`--pretty` applies): `{ status: "ready" | "check_failed", school, orgId?, configDir, stateDir, children, check: { ok, drift, skipped, error } }`. No names, ids or school data. Like `configure` and `doctor`, it is a diagnostic: not a contract. With `--format text` nothing is printed on stdout, because the guide on stderr is already the text.
- **Stdout for the bare invocation:** nothing; it is for people only.
- **Exit codes:** unchanged contract. 0 when the schedule was shown; 3 not configured (non-interactive, no school); 2 not logged in (`--no-login`, a failed or timed-out login); 4 network; 6 input (no school matched, cancelled); 7 drift or upstream; whatever kind an error has, through `describeError`'s two lines. A bug is still 1.
- **Cancelled.** Ctrl+C or Ctrl+D at a question rejects the prompt; the guide turns that into a new `cancelled` input error (exit 6, "Stopped before finishing; nothing more was changed" and "Next: run setup to continue where you left off"), never an "unexpected error".
- **No match.** A lookup without a match is a new `school_not_found` input error (exit 6) with a hint to try part of the name or the municipality. Interactive runs ask again first.

## Compatibility

Checked against the stability policy's list: no command, flag, output or setting is renamed or removed; `setup` and its two flags are additions; exit codes and error kinds are unchanged for every existing command; JSON stays the default everywhere and nothing reads `isTTY` to choose a format. The bare invocation changes only on an interactive terminal with nothing configured, where it used to print help and exit 6; the policy gains a line saying so. `configure` behaves byte-for-byte as before (its lookup and write are shared with `setup`, not changed). No persisted format changes.

## Where it lives

All in the CLI adapter; core gains two message keys and two hint keys and nothing else.

- `src/cli/guide/words.ts`: the English/Swedish text and `say(lang, key, params)`.
- `src/cli/guide/first-run.ts`: the steps, over `CliDeps` and the injected context. It uses core's public API only: the provider's school directory (through `configure`'s shared helper), `runOperation` for `login` and `get_schedule`, `ensureSession` and `pendingLogin` on the session manager, `verifyOperations`, `browserStatus`. It never touches provider or state-storage internals.
- `src/cli/commands/setup.ts`: registers `setup` and decides whether the bare invocation starts the guide.
- `src/cli/commands/configure.ts`: the lookup and the account write, exported for `setup`; its own behaviour unchanged.
- `src/cli/program.ts`: registers `setup`; `runCli` starts the guide for the bare invocation when the rule above holds.
- `src/core/errors/messages.ts`: `cancelled`, `school_not_found`, hints `run_again`, `school_query`.

## I/O and edge cases

| Input or condition | Required behaviour |
| --- | --- |
| Bare, TTY in and out, `CI` unset, nothing configured | the guide, interactive; no JSON on stdout |
| Bare, any of those not true | help on stderr, exit 6, as before |
| `setup` on a TTY, no answer flags, nothing configured | asks for the school, lists matches, asks for Enter before the browser |
| `setup --query X`, or stdin not a TTY with `--query X` | best match saved, no prompt |
| `setup` without a TTY, no flags, nothing configured | `not_configured`, exit 3, no request |
| `setup --school s [--org-id n]` | saved as given, no lookup |
| No match | interactive: ask again (three tries); otherwise `school_not_found`, exit 6 |
| Invalid number or empty answer | ask again (three tries), then `cancelled`, exit 6 |
| Ctrl+C / Ctrl+D at a question | `cancelled`, exit 6, two lines |
| Already configured, no answer flags | "Already done", the school kept |
| Saved login restores | login skipped |
| No saved login, `--no-login` | school saved, then `not_authenticated`, exit 2 |
| Login fails or times out | the login's own error and exit code |
| Login URL known while waiting | printed once, with "on this computer" |
| A check drifts or fails | two lines, JSON with `check_failed`, exit by `verifyExitCode` |
| All checks pass | schedule view, closing section, JSON `ready`, exit 0 |
| More than one child | one line on how to see the others |
| Run under `npx` | commands printed with `npx -y schoolsoft-agent` |
| `--format text` | the guide as usual, nothing on stdout |
| Swedish locale or `SCHOOLSOFT_LANG=sv` | every line in Swedish |

</frozen-after-approval>

## Code Map

- `src/cli/guide/words.ts`, `src/cli/guide/first-run.ts`, `src/cli/commands/setup.ts`.
- `src/cli/commands/configure.ts` (shared helpers), `src/cli/program.ts`.
- `src/core/errors/messages.ts`.
- `scripts/gen-docs.ts`: the `setup` row and the bare-invocation sentence.
- `test/functional/first-run.test.ts`: the flow in-process over the fake session manager and fake portal, both languages, every edge case above.
- `test/unit/guide-words.test.ts`: both languages for every key; every linked guide exists.
- `test/functional/cli-spawn.test.ts`: the built binary's bare invocation without a TTY still prints help and exits 6, and `setup` without a school exits 3.
- `docs/reference/commands.md` (generated), `docs/getting-started/terminal.md`, `README.md`, `docs/development/stability.md`, `docs/development/architecture.md`, `docs/planning/README.md`.

## Tasks & Acceptance

- [x] Spec (this file).
- [ ] Given a fresh config dir and a TTY, when the parent runs the bare command and answers a name, a number and Enter, then the school is saved, the fake login runs, five checks pass, the schedule view is printed and the exit code is 0.
- [ ] Given no TTY, then the bare command prints help and exits 6, and `setup` without flags exits 3 without a request.
- [ ] Given `setup --query X` on a TTY, then there is no prompt at all.
- [ ] Given `--no-login` and no saved login, then the school is saved and the exit code is 2.
- [ ] Given a drifting check, then two lines, `check_failed` and exit 7.
- [ ] Given Ctrl+C at a question, then `cancelled` and exit 6.
- [ ] Given a Swedish locale, then every line is Swedish.

## Verification

See the pull request for the gate results.
