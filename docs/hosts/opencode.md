# OpenCode

[OpenCode](https://opencode.ai) has no marketplace; you add a few lines to its config file. Choose MCP (recommended) or the skill.

## What you need

- OpenCode installed ([docs](https://opencode.ai/docs/)).
- [Node.js](https://nodejs.org/en/download) 22 or newer.
- Your school's name, and BankID.

## Install: MCP (recommended)

Find your school first (once):

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

Then add this to `opencode.json` in your project, or to `~/.config/opencode/opencode.json` for all projects:

```json
{
  "mcp": {
    "schoolsoft": {
      "type": "local",
      "command": ["npx", "-y", "-p", "schoolsoft-agent", "schoolsoft-agent-mcp"],
      "enabled": true
    }
  }
}
```

If you skipped `configure`, add `"environment": { "SCHOOLSOFT_SCHOOL": "<slug>" }` inside the `schoolsoft` block instead. A ready-made copy is `plugins/opencode/opencode.json` in the repository. OpenCode's own docs: [MCP servers](https://opencode.ai/docs/mcp-servers/) · [Config](https://opencode.ai/docs/config/).

## Install: skill (alternative)

OpenCode reads skills from `.agents/skills/` and `~/.config/opencode/skills/`. Copy the folder `skills/schoolsoft/` from the repository there (from a checkout, `make install-opencode` does it), and allow it in `opencode.json`:

```json
{ "permission": { "skill": { "schoolsoft": "allow" } } }
```

The skill runs the `schoolsoft-agent` command; `npm install -g schoolsoft-agent` once to avoid the `npx` start-up delay. OpenCode's docs: [Skills](https://opencode.ai/docs/skills/).

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login; complete BankID. OpenCode continues when SchoolSoft redirects back.

## Try asking

- "Vad har barnen på schemat imorgon?"
- "Vad är det till lunch på torsdag?"
- "Finns det nya meddelanden från skolan?"

## Optional: contact lists, bookings, files, grades

Run `npx -y schoolsoft-agent browser install` once (hidden Chromium). For grades, documents, absence and assessment criteria also run `npx -y schoolsoft-agent login --web` once. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

`npx -y` always fetches the latest release. Remove the `schoolsoft` block from `opencode.json`; run `npx -y schoolsoft-agent logout` to delete the saved session.

Problems? [Troubleshooting](../troubleshooting.md).
