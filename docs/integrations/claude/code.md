# Claude Code

Claude in your terminal or IDE. Install as a plugin from this repository's marketplace: two commands inside Claude Code.

**New to commands?** Read [how to open a terminal and where to type](../../getting-started/computer-basics.md). Follow this guide on one computer; skip alternative installation methods until your first school question works.

## Starting from scratch

1. Follow the [Claude Code quickstart](https://code.claude.com/docs/en/quickstart) for your operating system, then start `claude` and complete account sign-in.
2. Send a normal message. Claude Code account eligibility is separate from having a free Claude chat account.
3. Install [Node.js](https://nodejs.org/en/download) 22 or newer for the SchoolSoft MCP command, then add the plugin below.

Use a local terminal/IDE session. For the desktop **Code** tab, use its [local-session setup](https://code.claude.com/docs/en/desktop) and configure Code's MCP/plugins there; the desktop Chat extension is separate. Cloud Code sessions are not the local setup described here. See [the matrix](../support-matrix.md).

**Check before continuing:** the assistant answers a normal “Hej!” and any required commands are available. If not, finish the assistant's installation/sign-in first; adding SchoolSoft will not fix an account or model-access problem.

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

If installation asks for a school slug, use the part after `sms.schoolsoft.se/` in your normal SchoolSoft website address (for example `taby`). If school lookup is needed, run `npx -y schoolsoft-agent configure --query "<school name>"` in your terminal and use the resulting slug in the plugin settings. Reconnect the plugin after changing configuration.

Claude's docs: [Plugins](https://docs.claude.com/en/docs/claude-code/plugins) · [Plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces) · [MCP](https://docs.claude.com/en/docs/claude-code/mcp) · [Skills](https://docs.claude.com/en/docs/claude-code/skills).

## Check that SchoolSoft was added

Start a new assistant conversation after installation. Ask **“Vilka SchoolSoft-verktyg eller färdigheter har du tillgång till?”** The assistant should identify the SchoolSoft integration. This checks installation only; you have not logged into SchoolSoft yet.

If it cannot find the integration, revisit the installation step and restart the assistant. Check that you used the same computer and user account. Do not proceed by pasting school data or login credentials into the chat.

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login page; complete BankID there. Claude continues when SchoolSoft redirects back. Tools appear as `schoolsoft_<operation>` (for example `schoolsoft_get_schedule`).

**Check:** after login, ask **“Vad är det till lunch den här veckan?”** and compare the school and dates with SchoolSoft. If there are several children, choose one explicitly.

**If this does not work:** “not configured” means repeat the school-selection step; “not authenticated” means repeat login. If the browser does not open, use the login recovery instructions in this guide on the same computer. For another error, see [Troubleshooting](../../getting-started/troubleshooting.md).

## Try asking

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "Sammanfatta veckans nyheter från skolan."
- "Vilka läxor finns den här veckan?"

## Optional: contact lists, bookings, files, grades

Ask Claude to run `browser install` once (hidden Chromium for the pages without a data feed). For grades, student documents, absence and assessment criteria, also run the web login once: `npx -y schoolsoft-agent login --web` opens a normal browser window for one more BankID. Details in [Get started](../../getting-started/README.md#4-optional-extras-only-if-you-want-them).

## Sandbox note

With Claude Code's sandbox on, commands cannot open a browser and network is proxied. Either allow `sms.schoolsoft.se` and your municipality's login domain in the [sandbox settings](https://docs.claude.com/en/docs/claude-code/settings), or run `npx -y schoolsoft-agent login` once in a normal terminal; the session is shared. The login URL is always printed so Claude can show it to you.

## Update and remove

`/plugin update schoolsoft-mcp@schoolsoft-agent` updates; `/plugin uninstall schoolsoft-mcp@schoolsoft-agent` removes. Run `npx -y schoolsoft-agent logout` to delete the saved session.

Problems? [Troubleshooting](../../getting-started/troubleshooting.md).

## For developers

```bash
make install-claude   # registers ./plugins/claude as a local marketplace
claude --plugin-dir ./plugins/claude/schoolsoft-mcp
```
