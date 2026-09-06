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
are one line on stderr; the exit code tells you what to do next.

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
   `login` blocks up to five minutes; run it in the background if your host
   limits command time, then poll `auth-status`. If the browser could not
   open, the URL is printed on stderr: show it to the user.
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
- If a command fails with exit code `1`, read stderr, fix the flags, and retry
  once. If it still fails, tell the user what SchoolSoft said.

## Command reference

See [references/commands.md](references/commands.md) for every command, its
flags and an example. The reference is generated from the same source as the
CLI, so it is always accurate for the installed version.
