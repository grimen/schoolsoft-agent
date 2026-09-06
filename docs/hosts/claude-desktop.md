# Claude Desktop

The Claude app on Mac and Windows. Easiest route for non-technical users: one file to install, no terminal needed.

## What you need

- Claude Desktop ([download](https://claude.ai/download)) with a plan that supports extensions.
- Your school's name.
- BankID, as you already use it with SchoolSoft.

## Install

1. Download `schoolsoft-agent.mcpb` from the [latest release](https://github.com/grimen/schoolsoft-agent/releases/latest).
2. Double-click the file, or in Claude Desktop go to **Settings → Extensions → Advanced settings → Install Extension…** and pick it.
3. When asked for **School slug**, type the short name from your SchoolSoft address (`https://sms.schoolsoft.se/<slug>/…`, for example `taby`). Not sure? Leave it empty, finish the install, and ask Claude: "Find my school on SchoolSoft, it is called Rösjöskolan". Then enter the slug it reports under **Settings → Extensions → SchoolSoft**.

Claude's own guide to extensions: [Getting started with Claude Desktop extensions](https://support.claude.com/en/articles/11175166-getting-started-with-claude-desktop-extensions).

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's real login page. Complete BankID. Come back to Claude; it continues on its own.

## Try asking

- "Vad har barnen på schemat imorgon?"
- "Vad är det till lunch den här veckan?"
- "Finns det olästa meddelanden från skolan?"
- "Vilka läxor har Ella till fredag?"

## Optional: contact lists, bookings, files, grades

These SchoolSoft pages have no data feed. Ask Claude to run `browser install` (it downloads a hidden Chromium once), and for grades, documents, absence and assessment criteria ask it to run the web login (`login --web`), which opens a normal browser window for one more BankID. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

Install the new `.mcpb` over the old one to update. Remove under **Settings → Extensions**. Your saved session lives in your user config folder; ask Claude to run `logout` first if you want it gone.

## Good to know

- The extension runs entirely on your computer; Claude Desktop ships its own Node runtime, so nothing else needs installing.
- Your data goes only to SchoolSoft and into your conversation with Claude. See [Privacy](../../README.md#privacy).
- Problems? [Troubleshooting](../troubleshooting.md).

## For developers

`make mcpb` builds the bundle from `plugins/mcpb/manifest.json`. The bundle format is [MCPB](https://github.com/anthropics/mcpb).
