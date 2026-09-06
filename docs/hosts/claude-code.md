# Claude Code

Claude in your terminal or IDE. Install as a plugin from this repository's marketplace: two commands inside Claude Code.

## What you need

- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed and signed in.
- [Node.js](https://nodejs.org/en/download) 22 or newer (`node --version`).
- Your school's name, and BankID.

## Install

Inside Claude Code, add the marketplace once, then pick **one** of the two plugins:

```
/plugin marketplace add grimen/schoolsoft-agent
/plugin install schoolsoft-mcp@schoolsoft-agent
```

- `schoolsoft-mcp` is the recommended choice: an MCP server, one tool per capability.
- `schoolsoft-skill` is the alternative: Claude runs the command-line tool through a skill. Same data. Do not install both; Claude would get overlapping instructions.

The install asks for your school slug (from `https://sms.schoolsoft.se/<slug>/…`). If you do not know it, leave it empty and ask Claude afterwards: "Find my school on SchoolSoft, it is called Rösjöskolan", then run `/plugin install` again with the slug, or export `SCHOOLSOFT_SCHOOL=<slug>` in your shell.

Claude's docs: [Plugins](https://docs.claude.com/en/docs/claude-code/plugins) · [Plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces) · [MCP](https://docs.claude.com/en/docs/claude-code/mcp) · [Skills](https://docs.claude.com/en/docs/claude-code/skills).

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login page; complete BankID there. Claude continues when SchoolSoft redirects back. Tools appear as `schoolsoft_<operation>` (for example `schoolsoft_get_schedule`).

## Try asking

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "Sammanfatta veckans nyheter från skolan."
- "Vilka läxor finns den här veckan?"

## Optional: contact lists, bookings, files, grades

Ask Claude to run `browser install` once (hidden Chromium for the pages without a data feed). For grades, student documents, absence and assessment criteria, also run the web login once: `npx -y schoolsoft-agent login --web` opens a normal browser window for one more BankID. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Sandbox note

With Claude Code's sandbox on, commands cannot open a browser and network is proxied. Either allow `sms.schoolsoft.se` and your municipality's login domain in the [sandbox settings](https://docs.claude.com/en/docs/claude-code/settings), or run `npx -y schoolsoft-agent login` once in a normal terminal; the session is shared. The login URL is always printed so Claude can show it to you.

## Update and remove

`/plugin update schoolsoft-mcp@schoolsoft-agent` updates; `/plugin uninstall schoolsoft-mcp@schoolsoft-agent` removes. Run `npx -y schoolsoft-agent logout` to delete the saved session.

Problems? [Troubleshooting](../troubleshooting.md).

## For developers

```bash
make install-claude   # registers ./plugins/claude as a local marketplace
claude --plugin-dir ./plugins/claude/schoolsoft-mcp
```
