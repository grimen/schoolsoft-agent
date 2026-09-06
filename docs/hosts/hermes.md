# Hermes Agent

## Skill

```bash
hermes skills install github:grimen/schoolsoft-agent/skills/schoolsoft
```

The skill is category `education` in Hermes' hub metadata. From a checkout, `make install-hermes` copies it to `~/.hermes/skills/education/schoolsoft`.

Hermes runs commands with a 180-second default timeout. `schoolsoft-agent login` waits up to five minutes for BankID; raise `terminal.timeout` in `~/.hermes/config.yaml` or run the login in a normal terminal once.

## MCP

In `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  schoolsoft:
    command: npx
    args: ["-y", "-p", "schoolsoft-agent", "schoolsoft-agent-mcp"]
    env:
      SCHOOLSOFT_SCHOOL: taby
```

Tools appear as `mcp_schoolsoft_schoolsoft_<operation>`.
