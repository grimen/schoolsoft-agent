# Hermes Agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/) supports both surfaces. The guide below includes installing Hermes first.

**New to commands?** Read [how to open a terminal and where to type](computer-basics.md). Follow this guide on one computer; skip alternative installation methods until your first school question works.

## Starting from scratch

1. Follow the [official Hermes installation guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation); it offers desktop installers and terminal installation options.
2. Complete model/provider setup and send a normal message in Hermes. Check that `hermes` and `node --version` work in a new terminal; SchoolSoft needs Node 22 or newer.
3. Use the skill steps below on that same computer. You can add messaging channels later; first get SchoolSoft working locally with its browser login.

The AI provider may require a subscription or separately billed API access. [Platform support](https://hermes-agent.nousresearch.com/docs/getting-started/platform-support) belongs to Hermes; Android/Termux or remote-server support there is not proof that this SchoolSoft browser flow works there.

**Check before continuing:** the assistant answers a normal “Hej!” and any required commands are available. If not, finish the assistant's installation/sign-in first; adding SchoolSoft will not fix an account or model-access problem.

## What you need

- Hermes Agent installed ([installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation)).
- [Node.js](https://nodejs.org/en/download) 22 or newer.
- Your school's name, and BankID.

## Install: skill

```bash
hermes skills install grimen/schoolsoft-agent/skills/schoolsoft
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

The skill is installed from this repository; check Hermes' installed-skills list for its location. Hermes' docs: [Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

**Timeout note.** Hermes runs commands with a 180-second default timeout; BankID can take longer. The skill therefore uses `login --background`, which returns at once with the login URL and finishes the login in a detached process; Hermes then polls `auth-status`. You can also raise `terminal.timeout` in `~/.hermes/config.yaml`, or run `npx -y schoolsoft-agent login` once in a normal terminal; the session is shared.

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

## Check that SchoolSoft was added

Start a new assistant conversation after installation. Ask **“Vilka SchoolSoft-verktyg eller färdigheter har du tillgång till?”** The assistant should identify the SchoolSoft integration. This checks installation only; you have not logged into SchoolSoft yet.

If it cannot find the integration, revisit the installation step and restart the assistant. Check that you used the same computer and user account. Do not proceed by pasting school data or login credentials into the chat.

## First use

Ask: **"Logga in på SchoolSoft."** A browser tab opens SchoolSoft's login; complete BankID there.

**Check:** after login, ask **“Vad är det till lunch den här veckan?”** and compare the school and dates with SchoolSoft. If there are several children, choose one explicitly.

**If this does not work:** “not configured” means repeat the school-selection step; “not authenticated” means repeat login. If the browser does not open, use the login recovery instructions in this guide on the same computer. For another error, see [Troubleshooting](../troubleshooting.md).

## Try asking

- "Vad har barnen på schemat imorgon?"
- "Vad är det till lunch i veckan?"
- "Sammanfatta olästa meddelanden från skolan."

## Optional: contact lists, bookings, files, grades

Run `npx -y schoolsoft-agent browser install` once. For grades, documents, absence and assessment criteria also run `npx -y schoolsoft-agent login --web` once. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

Re-run the install command to update. Remove the installed SchoolSoft skill using Hermes' skill management or the `schoolsoft` block from the config; `npx -y schoolsoft-agent logout` deletes the saved session.

Problems? [Troubleshooting](../troubleshooting.md).

## For developers

`make install-hermes` copies the skill to `~/.hermes/skills/education/schoolsoft` from a checkout.
