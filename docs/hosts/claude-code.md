# Claude Code

Both surfaces are available. Pick one; installing both gives Claude overlapping instructions.

## Option A: MCP plugin

```
/plugin marketplace add grimen/schoolsoft-agent
/plugin install schoolsoft-mcp@schoolsoft-agent
```

The install prompt asks for your school slug (from `https://sms.schoolsoft.se/<slug>/…`). If you don't know it, leave it empty and ask Claude to run the `schoolsoft_find_school` tool with your school's name, then set `SCHOOLSOFT_SCHOOL` in your environment or re-install with the value.

Tools appear as `mcp__plugin_schoolsoft-mcp_schoolsoft__schoolsoft_<operation>`. First use: ask Claude to log in; a browser tab opens for BankID.

## Option B: Skill plugin

```
/plugin marketplace add grimen/schoolsoft-agent
/plugin install schoolsoft-skill@schoolsoft-agent
```

Claude runs the `schoolsoft-agent` CLI through the skill's wrapper script, which finds the binary via `npx -y schoolsoft-agent` if nothing is installed. To avoid the `npx` startup cost, `npm install -g schoolsoft-agent` once.

Configure with `npx -y schoolsoft-agent configure --query "<school name>"` before first use, or let Claude do it when the skill reports exit code 3.

## Sandbox note

With Claude Code's sandbox enabled, commands cannot open a browser and outbound network is proxied. Either allow `sms.schoolsoft.se` (and your municipality's login domain) in the sandbox settings, or run `schoolsoft-agent login` once in a normal terminal; the session is then reused by both surfaces. The CLI always prints the login URL on stderr so Claude can show it to you.

## Developing against a checkout

```bash
make install-claude   # registers ./plugins/claude as a local marketplace
claude --plugin-dir ./plugins/claude/schoolsoft-mcp
```

## Optional: headless browser

Contact lists, subject rooms, bookings and shared files exist only as SchoolSoft web pages. Those operations need the optional headless browser: run `npx -y schoolsoft-agent browser install` once (downloads Chromium). Everything else works without it. Set `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP=<endpoint>` to use an external engine instead. Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are behind SchoolSoft's "log in again" gate and additionally need one `npx -y schoolsoft-agent login --web` (the normal web login opens in a browser window; nothing is automated), after which they read through the same headless browser.
