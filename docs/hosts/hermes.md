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

## Optional: headless browser

Contact lists, subject rooms, bookings and shared files exist only as SchoolSoft web pages. Those operations need the optional headless browser: run `npx -y schoolsoft-agent browser install` once (downloads Chromium). Everything else works without it. Set `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP=<endpoint>` to use an external engine instead. Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are behind SchoolSoft's "log in again" gate and additionally need one `npx -y schoolsoft-agent login --web` (the normal web login opens in a browser window; nothing is automated), after which they read through the same headless browser.
