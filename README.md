# schoolsoft-mcp-server

Unofficial MCP server for [SchoolSoft](https://www.schoolsoft.se/) with a
BankID-friendly auth flow. Built on [`@elias4044/ssp-node`](https://www.npmjs.com/package/@elias4044/ssp-node).

> Not affiliated with, endorsed by, or sponsored by SchoolSoft AB.
> Uses your own account via SchoolSoft's own login page. Respect the ToS.

## How auth works

`schoolsoft_login` opens SchoolSoft's real login page in **your** browser.
You authenticate with BankID (or password/SSO) there — credentials never
touch this server or the AI conversation. The resulting session is stored
encrypted in `~/.schoolsoft-mcp/` and silently refreshed, so BankID is
only needed when the session truly expires.

## Setup

```bash
npm install && npm run build
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "schoolsoft": {
      "command": "node",
      "args": ["/absolute/path/to/schoolsoft-mcp-server/dist/index.js"],
      "env": { "SCHOOLSOFT_SCHOOL": "taby" }
    }
  }
}
```

Claude Code: `claude mcp add schoolsoft --env SCHOOLSOFT_SCHOOL=taby -- node /absolute/path/to/dist/index.js`

## Tools

| Tool | Status |
|---|---|
| `schoolsoft_login` / `schoolsoft_auth_status` / `schoolsoft_logout` | ⚠️ needs live verification (see CLAUDE.md) |
| `schoolsoft_get_schedule`, `schoolsoft_get_lunch_menu` | scaffolded |
| `schoolsoft_get_assignments`, `schoolsoft_get_assignment_detail` | scaffolded |
| `schoolsoft_get_news`, `schoolsoft_get_subjects` | scaffolded |
| write ops (absence, messages, leave) | planned — see CLAUDE.md roadmap |

## Development

See **CLAUDE.md** for architecture decisions, open questions to verify
live, roadmap, and GDPR notes.
