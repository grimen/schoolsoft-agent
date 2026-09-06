# Hermes Agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/) supports both surfaces. The skill is one command.

## What you need

- Hermes Agent installed ([installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)).
- [Node.js](https://nodejs.org/en/download) 22 or newer.
- Your school's name, and BankID.

## Install: skill

```bash
hermes skills install github:grimen/schoolsoft-agent/skills/schoolsoft
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

The skill is filed under `education` in Hermes' hub. Hermes' docs: [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

**Timeout note.** Hermes runs commands with a 180-second default timeout; the BankID login waits up to five minutes. Raise `terminal.timeout` in `~/.hermes/config.yaml`, or run `npx -y schoolsoft-agent login` once in a normal terminal. The session is shared.

## Install: MCP

In `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  schoolsoft:
    command: npx
    args: ["-y", "-p", "schoolsoft-agent", "schoolsoft-agent-mcp"]
    env:
      SCHOOLSOFT_SCHOOL: taby
```

Replace `taby` with your school slug (`npx -y schoolsoft-agent find-school --query "<school name>"` prints it). Hermes' docs: [MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp). Tools appear as `mcp_schoolsoft_schoolsoft_<operation>`.

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login; complete BankID there.

## Try asking

- "Vad har barnen på schemat imorgon?"
- "Vad är det till lunch i veckan?"
- "Sammanfatta olästa meddelanden från skolan."

## Optional: contact lists, bookings, files, grades

Run `npx -y schoolsoft-agent browser install` once. For grades, documents, absence and assessment criteria also run `npx -y schoolsoft-agent login --web` once. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

Re-run the install command to update. Remove the skill folder under `~/.hermes/skills/education/schoolsoft` or the `schoolsoft` block from the config; `npx -y schoolsoft-agent logout` deletes the saved session.

Problems? [Troubleshooting](../troubleshooting.md).

## For developers

`make install-hermes` copies the skill to `~/.hermes/skills/education/schoolsoft` from a checkout.
