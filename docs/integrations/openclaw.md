# OpenClaw

Start on your own computer; add remote or messaging interfaces after SchoolSoft login works locally. This path does not require a public connector server.

**New to commands?** Read [how to open a terminal and where to type](../getting-started/computer-basics.md). Follow this guide on one computer; skip alternative installation methods until your first school question works.

## Starting from scratch

1. Follow [OpenClaw's official setup](https://docs.openclaw.ai/start/getting-started) for your OS. Use its current Node requirement, which may exceed SchoolSoft's Node 22 minimum.
2. Complete onboarding and connect an eligible model account/API provider. Existing supported access may be reused; installing the agent does not include AI usage.
3. Open the dashboard and send an ordinary message. Check `openclaw` and `npx` in a new terminal.
4. Add SchoolSoft below, on the computer with the browser you will use for BankID.

Already using OpenClaw? Start below. From scratch, this is assistant onboarding plus integration setup, not just one command.

**Check before continuing:** the assistant answers a normal “Hej!” and any required commands are available. If not, finish the assistant's installation/sign-in first; adding SchoolSoft will not fix an account or model-access problem.

## Add SchoolSoft through MCP

Replace the example school name:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
openclaw mcp add schoolsoft --command npx --arg -y --arg -p --arg schoolsoft-agent --arg schoolsoft-agent-mcp
openclaw mcp probe schoolsoft
```

This syntax follows [OpenClaw's MCP reference](https://docs.openclaw.ai/cli/mcp). Its dashboard also has MCP settings if you prefer entering the command and arguments there. Reload/restart the running agent or Gateway after configuration, then start a new chat. Saving configuration alone does not prove the agent loaded it.

Use the same OS account as OpenClaw. If the GUI cannot find `npx`, restart after installing Node or use its full executable path.

## Skill alternative

The repository provides an [OpenClaw skill](../../skills/schoolsoft/SKILL.md). Follow [OpenClaw's skill-loading instructions](https://docs.openclaw.ai/tools/skills) to install the folder; from a development checkout, `make install-openclaw` copies the generated variant. If needed, install the command with `npm install -g schoolsoft-agent`.

Choose MCP or the skill, not both. The MCP route does not depend on finding the project in a third-party marketplace.

## Check that SchoolSoft was added

Start a new assistant conversation after installation. Ask **“Vilka SchoolSoft-verktyg eller färdigheter har du tillgång till?”** The assistant should identify the SchoolSoft integration. This checks installation only; you have not logged into SchoolSoft yet.

If it cannot find the integration, revisit the installation step and restart the assistant. Check that you used the same computer and user account. Do not proceed by pasting school data or login credentials into the chat.

## First use

Ask **“Logga in på SchoolSoft.”** Complete BankID in the computer's browser, then ask **“Vad har barnen på schemat imorgon?”**

If a sandbox blocks the browser, run `npx -y schoolsoft-agent login` in a normal terminal on that computer. Containers also need permitted network access and the correct session directory mounted; a mount alone does not enable networking. Opening the localhost-return URL on another device is not a complete remote-login solution.

**Check:** after login, ask **“Vad är det till lunch den här veckan?”** and compare the school and dates with SchoolSoft. If there are several children, choose one explicitly.

**If this does not work:** “not configured” means repeat the school-selection step; “not authenticated” means repeat login. If the browser does not open, use the login recovery instructions in this guide on the same computer. For another error, see [Troubleshooting](../getting-started/troubleshooting.md).

## Use from your phone

After local reads work, configure an OpenClaw-supported channel or remote interface using its official guide. Keep the agent's computer running. Replies can pass through the messaging provider and model provider. Re-login may require the computer's browser. This project has not verified every channel/device combination; see [the matrix](support-matrix.md).

## Update and remove

The MCP command selects an unpinned package; use a reviewed version for repeatable installs. Remove it with `openclaw mcp unset schoolsoft`, or remove the installed skill. Run `npx -y schoolsoft-agent logout` first to delete saved state. Existing chats are separate.

[Optional browser features](../getting-started/README.md#4-optional-extras-only-if-you-want-them) · [Troubleshooting](../getting-started/troubleshooting.md)
