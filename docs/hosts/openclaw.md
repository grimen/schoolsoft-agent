# OpenClaw

[OpenClaw](https://docs.openclaw.ai/) supports both surfaces. The skill from ClawHub is one command; MCP is one command too.

## What you need

- OpenClaw installed ([docs](https://docs.openclaw.ai/)).
- [Node.js](https://nodejs.org/en/download) 22 or newer.
- Your school's name, and BankID.

## Install: skill (ClawHub)

```bash
openclaw skills install @grimen/schoolsoft
```

The skill declares its Node requirement and installs the `schoolsoft-agent` command for you. OpenClaw's docs: [Skills](https://docs.openclaw.ai/tools/skills) · [ClawHub](https://clawhub.ai).

## Install: MCP

```bash
openclaw mcp add schoolsoft --transport stdio -- npx -y -p schoolsoft-agent schoolsoft-agent-mcp
```

Then find your school once: `npx -y schoolsoft-agent configure --query "Rösjöskolan"` (or set `SCHOOLSOFT_SCHOOL=<slug>` in the server's environment). OpenClaw's docs: [MCP](https://docs.openclaw.ai/mcp).

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login; complete BankID there.

**Sandbox note.** In Docker sandbox mode OpenClaw blocks network and cannot open a browser. Run `npx -y schoolsoft-agent login` on the host once; the session is saved in your config directory, which the sandboxed process needs mounted. Or let OpenClaw open the URL the tool prints with its own browser tool.

## Try asking

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "Har vi fått några meddelanden från skolan?"

## Optional: contact lists, bookings, files, grades

Run `npx -y schoolsoft-agent browser install` once. For grades, documents, absence and assessment criteria also run `npx -y schoolsoft-agent login --web` once. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

`openclaw skills update @grimen/schoolsoft` or re-run `openclaw mcp add`. Remove with `openclaw skills remove @grimen/schoolsoft` / `openclaw mcp remove schoolsoft`; `npx -y schoolsoft-agent logout` deletes the saved session.

Problems? [Troubleshooting](../troubleshooting.md).

## For developers

`make install-openclaw` copies the OpenClaw variant of the skill to `~/.openclaw/skills/schoolsoft` from a checkout.
