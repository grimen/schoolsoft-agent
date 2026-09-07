# OpenCode

[OpenCode](https://opencode.ai) can connect through its local MCP configuration. Choose MCP (recommended) or the skill.

**New to commands?** Read [how to open a terminal and where to type](../getting-started/computer-basics.md). Follow this guide on one computer; skip alternative installation methods until your first school question works.

## Starting from scratch

1. Install OpenCode using its [official getting-started guide](https://opencode.ai/docs/) for your operating system.
2. Start OpenCode and use `/connect` to configure a supported model provider. Send a normal message before adding SchoolSoft; provider billing is separate.
3. Install [Node.js](https://nodejs.org/en/download) 22 or newer if `node --version` is missing or older, then follow the MCP steps below.

Use a local session on a computer with a browser for SchoolSoft login. Merge the example into your existing config; do not replace other settings.

**Check before continuing:** the assistant answers a normal “Hej!” and any required commands are available. If not, finish the assistant's installation/sign-in first; adding SchoolSoft will not fix an account or model-access problem.

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

## Check that SchoolSoft was added

Start a new assistant conversation after installation. Ask **“Vilka SchoolSoft-verktyg eller färdigheter har du tillgång till?”** The assistant should identify the SchoolSoft integration. This checks installation only; you have not logged into SchoolSoft yet.

If it cannot find the integration, revisit the installation step and restart the assistant. Check that you used the same computer and user account. Do not proceed by pasting school data or login credentials into the chat.

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login; complete BankID. OpenCode continues when SchoolSoft redirects back.

**Check:** after login, ask **“Vad är det till lunch den här veckan?”** and compare the school and dates with SchoolSoft. If there are several children, choose one explicitly.

**If this does not work:** “not configured” means repeat the school-selection step; “not authenticated” means repeat login. If the browser does not open, use the login recovery instructions in this guide on the same computer. For another error, see [Troubleshooting](../getting-started/troubleshooting.md).

## Try asking

- "Vad har barnen på schemat imorgon?"
- "Vad är det till lunch på torsdag?"
- "Finns det nya meddelanden från skolan?"

## Optional: contact lists, bookings, files, grades

Run `npx -y schoolsoft-agent browser install` once (hidden Chromium). For grades, documents, absence and assessment criteria also run `npx -y schoolsoft-agent login --web` once. Details in [Get started](../getting-started/README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

The example uses an unpinned package. Restart after updating and consult npm's cache/update behavior; use a versioned package if you need a fixed release. Remove the `schoolsoft` block from `opencode.json`; run `npx -y schoolsoft-agent logout` to delete the saved session.

Problems? [Troubleshooting](../getting-started/troubleshooting.md).
