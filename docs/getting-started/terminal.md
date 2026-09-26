# Reading school data in a terminal

The `schoolsoft-agent` command prints JSON, because that is what AI assistants and scripts read. Add `--format text` to see the same answer laid out for a person instead. This page shows what each view looks like. All names and places below are made up.

You need Node.js 22 or newer and one BankID login; see [Try it in a terminal first](../../README.md#try-it-in-a-terminal-first-optional) if you have not logged in yet. New to terminals? Read [how to enter commands](computer-basics.md) first.

```bash
npx -y schoolsoft-agent get-schedule --format text
```

## What you can view

Five commands have a text view. Every other command still prints JSON (indented, so it is readable) and says so in one line: `Text view is not available for get-news yet; showing JSON.` The other commands get views once their answers have a stable shape.

**Your children** (`list-children --format text`). The star marks the child that other commands use when you do not pass `--child-id`.

```text
Guardian: Test Testsson

   ID   Name  School                  Class
   100  Ett   Testskolan              4B
*  101  Två   Östra Påhittade skolan  –

* child in focus
```

**The week's schedule** (`get-schedule --format text`, optionally `--week 36`).

```text
Week 36 · Ett

Mon 2026-08-31
  08:30–09:50  Matematik         A12
  10:10–11:30  Svenska           B03

Tue 2026-09-01 (today)
  13:00–14:30  Idrott och hälsa  Gymnastiksalen
```

**The calendar** (`get-calendar --format text`, optionally `--start-date` and `--end-date`). All-day entries come first under their date; an entry that lasts several days says when it ends.

```text
Calendar 2026-10-19 – 2026-10-25 · Ett

Mon 2026-10-19
  All day      Studiedag                       –
  08:30–09:50  Matematik                       A12

Fri 2026-10-23
  All day      Höstlov (until Sun 2026-10-25)  –
```

**Lunch** (`get-lunch-menu --format text`, optionally `--week 36`). Monday to Friday, with "No menu" where the school has not published one.

```text
Lunch, week 36 2026 · Ett

Mon 2026-08-31          Lunch: Köttbullar med potatismos
                        Vegetarisk: Linsbiffar
Tue 2026-09-01 (today)  No menu
Wed 2026-09-02          Fiskgratäng
```

**Messages** (`get-messages --format text`, optionally `--unread-only`). A star marks unread messages and a plus marks attachments. Read one with `get-message --id <ID>`.

```text
Inbox (1 unread)

    ID  Date              From        Subject
*+  7   2026-09-03 16:45  Åsa Lärare  Utflykt på fredag
    6   2026-08-28 09:00  –           Veckobrev

* unread · + attachment
```

## Language, time and width

- **Language.** Views are in Swedish when your system language is Swedish, like the error messages. Set `SCHOOLSOFT_LANG=sv` or `SCHOOLSOFT_LANG=en` to choose.
- **Time.** Dates and times are always Swedish time (Europe/Stockholm), also on a computer set to another time zone.
- **Width.** In a terminal, long names and subjects are shortened with `…` to fit the window. Set `COLUMNS=100` to choose a width. When you send the output to a file or another program, nothing is shortened.
- **Colour.** Unread messages and today's date are shown in bold in a terminal. Set `NO_COLOR=1` to turn that off; the stars and "(today)" still show the same thing.

Assistants and scripts are not affected: without `--format text` the output is exactly the JSON described in the [command reference](../reference/commands.md).
