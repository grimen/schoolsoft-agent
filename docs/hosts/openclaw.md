# OpenClaw

## Skill (ClawHub)

```bash
openclaw skills install @grimen/schoolsoft
```

The published skill carries `metadata.openclaw` declaring the Node requirement and `npm install -g schoolsoft-agent` as the install step. From a checkout, `make install-openclaw` copies the OpenClaw variant to `~/.openclaw/skills/schoolsoft`.

## MCP

OpenClaw speaks MCP natively:

```bash
openclaw mcp add schoolsoft --transport stdio -- npx -y -p schoolsoft-agent schoolsoft-agent-mcp
```

Set `SCHOOLSOFT_SCHOOL` in the server's env, or run `npx -y schoolsoft-agent configure --query "<school>"` once.

## Sandbox note

In Docker sandbox mode OpenClaw blocks network and cannot open a browser. Run `schoolsoft-agent login` on the host once; the session is stored in the host config directory and the sandboxed process needs that directory mounted. Alternatively use OpenClaw's own `browser.*` tool to open the URL the CLI prints.

## Optional: headless browser

Contact lists, subject rooms, bookings and shared files exist only as SchoolSoft web pages. Those operations need the optional headless browser: run `npx -y schoolsoft-agent browser install` once (downloads Chromium). Everything else works without it. Set `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP=<endpoint>` to use an external engine instead. Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are behind SchoolSoft's "log in again" gate and additionally need one `npx -y schoolsoft-agent login --web` (the normal web login opens in a browser window; nothing is automated), after which they read through the same headless browser.
