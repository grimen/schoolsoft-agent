# Reading school data in a terminal

The `schoolsoft-agent` command prints JSON, because that is what AI assistants and scripts read. Add `--format text` to see the same answer laid out for a person instead. This page shows what each view looks like. All names and places below are made up.

You need Node.js 22 or newer and one BankID login. New to terminals? Read [how to enter commands](computer-basics.md) first.

## The first time

Type this and press Enter:

```bash
npx -y schoolsoft-agent
```

On a computer where schoolsoft-agent has not been set up yet, it guides you through five steps, in Swedish when your computer's language is Swedish:

1. **Find the school.** Type its name, or part of it. If several schools match, type the number of yours.
2. **Save the settings.** Nothing to do; it says where they are saved.
3. **Log in with BankID.** Press Enter and your web browser opens SchoolSoft's login page. Log in there as usual and come back. Never type BankID codes or passwords in the terminal. If no browser window opens, it prints the address to open on the same computer.
4. **Check that it works.** It reads once from SchoolSoft and says how many checks passed.
5. **This week's schedule** for your child, as in the view below.

It ends by showing where your data is kept ([how it is handled](data-handling.md)) and which guide to follow to add an AI assistant. Press Ctrl+C to stop at any time; `npx -y schoolsoft-agent setup` continues where you left off and skips the steps that are already done.

For scripts: `setup --query "<school name>"` takes the best match and asks nothing, `--no-login` stops before BankID (exit 2 when no login is saved), and without a terminal `setup` never asks. The guide is written to stderr; `setup` prints one JSON result on stdout.

## Afterwards

Any time later, ask for a view directly:

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

**Assignments** (`get-assignments --format text`, optionally `--week 37`). A star marks the ones you have not opened. Read one with `get-assignment-detail --id <ID>` (the ID is in the JSON output).

```text
Assignments, week 37 2026 · Ett

   Date              Title                                 Status
*  2026-09-10        Läxa kapitel 3 – Bråk och decimaltal  Ej inlämnad
   2026-09-11 08:30  Glosförhör                            –

* unread
```

**News** (`get-news --format text`). Newest first; a star marks unread news and a plus attachments.

```text
News · Ett (1 unread)

    Date              From         Title
*+  2026-09-01 07:45  Rektor Test  Studiedag fredag
    2026-08-28 09:00  –            Fotografering

* unread · + attachment
```

**Subject rooms** (`get-subject-rooms --format text`): each subject with its groups and teachers.

```text
Subject rooms · Ett

Subject    Groups  Teachers
Matematik  4B, 4C  Lärare Test, Assistent
Engelska   –       –
```

**Bookings** (`get-bookings --format text`, needs the hidden browser): meetings in time order and whether a time is free.

```text
Bookings · Ett

When                    Title              Status
2026-10-01 15:00–15:30  Utvecklingssamtal  Booked
2026-11-12 18:00        Föräldramöte       Available
```

**Files and links** (`get-files --format text`, needs the hidden browser), under the school's own headings.

```text
Files and links · Ett

Skolan
  Veckobrev v37    file  right_student_file_download.jsp?fileid=2
  Fritids hemsida  link  https://example.test/fritids
```

## Language, time and width

- **Language.** Views are in Swedish when your system language is Swedish, like the error messages. Set `SCHOOLSOFT_LANG=sv` or `SCHOOLSOFT_LANG=en` to choose.
- **Time.** Dates and times are always Swedish time (Europe/Stockholm), also on a computer set to another time zone.
- **Width.** In a terminal, long names and subjects are shortened with `…` to fit the window. Set `COLUMNS=100` to choose a width. When you send the output to a file or another program, nothing is shortened.
- **Colour.** Unread messages and today's date are shown in bold in a terminal. Set `NO_COLOR=1` to turn that off; the stars and "(today)" still show the same thing.

Assistants and scripts are not affected: without `--format text` the output is exactly the JSON described in the [command reference](../reference/commands.md).
