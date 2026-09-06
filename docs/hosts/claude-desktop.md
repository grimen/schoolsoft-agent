# Claude Desktop

Claude Desktop installs MCP servers as `.mcpb` bundles.

1. Download `schoolsoft-agent.mcpb` from the latest [GitHub release](https://github.com/grimen/schoolsoft-agent/releases).
2. Double-click it, or Settings → Extensions → Advanced → Install Extension.
3. Enter your school slug when asked (from `https://sms.schoolsoft.se/<slug>/…`). To find it, run `npx -y schoolsoft-agent find-school --query "<school name>"` in a terminal.
4. In a chat, ask Claude to log in to SchoolSoft. A browser tab opens for BankID.

The bundle vendors Node dependencies and runs `node server/index.js` locally; Claude Desktop ships its own Node runtime. Data never leaves your machine except to SchoolSoft and the conversation.

Build the bundle yourself: `make mcpb` produces `dist/schoolsoft-agent.mcpb` from `plugins/mcpb/manifest.json`.

Claude Desktop's extension directory requires every tool to carry `readOnlyHint`/`destructiveHint`, which the operation registry guarantees; a directory submission is on the roadmap.

## Optional: headless browser

Contact lists, bookings and shared files exist only as SchoolSoft web pages. Those operations need the optional headless browser: run `npx -y schoolsoft-agent browser install` once (downloads Chromium). Everything else works without it. Set `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP=<endpoint>` to use an external engine instead. Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are behind SchoolSoft's "log in again" gate and additionally need one `npx -y schoolsoft-agent login --web` (the normal web login opens in a browser window; nothing is automated), after which they read through the same headless browser.
