# OpenCode

OpenCode has no marketplace; configuration is a file.

## MCP

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global):

```json
{
  "mcp": {
    "schoolsoft": {
      "type": "local",
      "command": ["npx", "-y", "-p", "schoolsoft-agent", "schoolsoft-agent-mcp"],
      "environment": { "SCHOOLSOFT_SCHOOL": "taby" },
      "enabled": true
    }
  }
}
```

`plugins/opencode/opencode.json` in the repo is a ready-made copy.

## Skill

OpenCode reads Agent Skills from `.agents/skills/`, `.claude/skills/` and their global equivalents. From a checkout:

```bash
make install-opencode   # copies the skill into ./.agents/skills/schoolsoft
```

Or by hand: copy `skills/schoolsoft/` to `~/.config/opencode/skills/schoolsoft/`. Allow it in `opencode.json` with `"permission": { "skill": { "schoolsoft": "allow" } }`.

The skill runs `schoolsoft-agent`; install it globally (`npm install -g schoolsoft-agent`) or let the wrapper fall back to `npx`.

## Optional: headless browser

Contact lists, subject rooms, bookings and shared files exist only as SchoolSoft web pages. Those operations need the optional headless browser: run `npx -y schoolsoft-agent browser install` once (downloads Chromium). Everything else works without it. Set `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP=<endpoint>` to use an external engine instead. Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are behind SchoolSoft's "log in again" gate and additionally need one `npx -y schoolsoft-agent login --web` (the normal web login opens in a browser window; nothing is automated), after which they read through the same headless browser.
