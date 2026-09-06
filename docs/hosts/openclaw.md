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
