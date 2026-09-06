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
