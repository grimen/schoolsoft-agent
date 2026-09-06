---
name: schoolsoft
description: Read a guardian's SchoolSoft data (schedule, lunch, assignments, news, messages) for Swedish schools via the schoolsoft-agent CLI, with BankID login in the user's browser. Use when a parent asks about their child's school day, homework, lunch, school news or messages from school, or mentions SchoolSoft.
license: MIT
compatibility: Requires node >= 22 and network access to sms.schoolsoft.se. Login opens the user's browser; in sandboxed hosts show the printed login URL instead.
metadata:
  author: Jonas Grimfelt
  homepage: https://github.com/grimen/schoolsoft-agent
---

# SchoolSoft for guardians

> Independent project: SchoolSoft is a trademark of SchoolSoft AB, which is not involved in, affiliated with, or endorsing this MIT-licensed tool.

You are helping a parent ("vårdnadshavare") with information from SchoolSoft,
the school platform used by many Swedish schools. All data access goes
through one command-line tool. Every command prints JSON on stdout; errors
are two lines on stderr (the problem, then "Next: <what to do>"); the exit
code tells you what kind of problem it is:

| Exit | Meaning                         | What to do                                                      |
| ---- | ------------------------------- | --------------------------------------------------------------- |
| 0    | OK                              | Use the JSON on stdout.                                         |
| 1    | Bug in the tool                 | Show the user the message; suggest `doctor` and an issue.       |
| 2    | Not logged in (or session lost) | Run `login` (or `login --web` when the message says web login). |
| 3    | Not configured                  | Run `configure --query "<school name>"`.                        |
| 4    | SchoolSoft unreachable          | Network problem: tell the user, try again later.                |
| 5    | Not available in this setup     | Follow the "Next" line (usually `browser install`).             |
| 6    | Bad input                       | Fix the flag or id named in the message and retry once.         |
| 7    | SchoolSoft answered with error  | Usually temporary: try again in a moment, then tell the user.   |

Set `SCHOOLSOFT_LANG=sv` to get these messages in Swedish; the "Next" line
then reads "Nästa steg".

Run commands through the wrapper so the binary is found wherever it is installed:

```bash
${CLAUDE_SKILL_DIR:-.}/scripts/schoolsoft.sh <command> [flags]
```

If `CLAUDE_SKILL_DIR` is not set, use the directory this file lives in.

## Workflow

1. **Check the session first.** Run `auth-status`. If `authenticated` is
   `true`, continue. Exit code `3` means the tool is not configured: run
   `configure --query "<school name>"` (ask the user for the school's name),
   or `configure --school <slug>` if they know the SchoolSoft URL slug.
2. **Log in only when needed.** Exit code `2` from any command means no valid
   session. Run `login` and tell the user: "A browser tab opens with
   SchoolSoft's login. Complete BankID there; I'll continue when it's done."
   `login` blocks up to five minutes. If your host limits command time, run
   `login --background` instead: it returns at once with
   `{ status: "login_started", url }` while a detached process finishes the
   login; show the URL if the browser did not open, then poll `auth-status`
   (its `loginInProgress` field shows `running`, `failed` with the reason, or
   `null` when done) until `authenticated` is `true`. Never start a second
   login while one is running; the tool refuses and says so.
3. **Know which child.** Run `list-children`. If there is more than one
   child and the user did not say which, ask. Pass `--child-id <studentId>`
   on later commands; it stays in focus afterwards.
4. **Answer from the JSON.** Use `get-schedule`, `get-lunch-menu`,
   `get-assignments` (then `get-assignment-detail --id`), `get-news`,
   `get-messages` (then `get-message --id`). Weeks are ISO weeks; omit
   `--week` for the current week. Answer in the user's language (usually
   Swedish) and convert times and dates to natural phrasing.
5. **Never write.** This skill is read-only. Do not attempt to report
   absence or send messages; say that is not supported yet.

## Rules

- Never ask the user for a SchoolSoft password or personal number. Login is
  BankID in their own browser.
- Children's data is sensitive: only include what the user asked for in the
  answer, never paste raw JSON into files, tickets or other tools, and do not
  summarise messages from school to third parties.
- Prefer the smallest query: `--limit` for lists, one week at a time.
- Exit code `6` means your input was wrong: fix the flag or id named on
  stderr and retry once. Exit codes `4` and `7` are outside your control:
  retry once after a moment, then tell the user what happened. Exit code `1`
  is a bug: show the message and stop.
- A session that dies mid-conversation is repaired silently once; if you
  still get exit code `2`, the user must log in again.

## Command reference

See [references/commands.md](references/commands.md) for every command, its
flags and an example. The reference is generated from the same source as the
CLI, so it is always accurate for the installed version.
