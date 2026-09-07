# Codex and the ChatGPT desktop app

Use a **local Codex host** to run SchoolSoft on your computer. This configuration follows [official OpenAI MCP support](https://learn.chatgpt.com/docs/extend/mcp); the complete SchoolSoft journey in each app version remains to be live-tested.

**New to commands?** Read [how to open a terminal and where to type](computer-basics.md). Follow this guide on one computer; skip alternative installation methods until your first school question works.

## Starting from scratch

1. Follow the [OpenAI quickstart](https://learn.chatgpt.com/docs/quickstart) to install the desktop app or Codex CLI and sign in with an eligible account.
2. Start a local Codex session and confirm an ordinary chat works.
3. Install [Node.js](https://nodejs.org/en/download) 22 or newer. In a new terminal, check `node --version` and `npx --version`.
4. Find your school, replacing the example:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

Use the same operating-system account as the assistant.

**Check before continuing:** the assistant answers a normal “Hej!” and any required commands are available. If not, finish the assistant's installation/sign-in first; adding SchoolSoft will not fix an account or model-access problem.

## Desktop setup

In **Settings → MCP servers → Add server**, choose STDIO:

| Field               | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| Name                | `schoolsoft`                                           |
| Command             | `npx`                                                  |
| Arguments, in order | `-y`, `-p`, `schoolsoft-agent`, `schoolsoft-agent-mcp` |

Save and restart as requested. If the app cannot find `npx`, restart after installing Node or use the full executable path.

## CLI alternative

```bash
codex mcp add schoolsoft -- npx -y -p schoolsoft-agent schoolsoft-agent-mcp
codex mcp list
```

Desktop, CLI and IDE share MCP configuration for the same local Codex host; choose one setup method. Check `/mcp` in that local session.

## Check that SchoolSoft was added

Start a new assistant conversation after installation. Ask **“Vilka SchoolSoft-verktyg eller färdigheter har du tillgång till?”** The assistant should identify the SchoolSoft integration. This checks installation only; you have not logged into SchoolSoft yet.

If it cannot find the integration, revisit the installation step and restart the assistant. Check that you used the same computer and user account. Do not proceed by pasting school data or login credentials into the chat.

## First use

Ask **“Logga in på SchoolSoft.”** Complete BankID in the computer's browser, then ask **“Vad har barnen på schemat imorgon?”**

If the agent cannot open the browser, run `npx -y schoolsoft-agent login` in a terminal on that computer. Reconnect the server if needed. Permit only the necessary operation rather than disabling the entire sandbox. `codex mcp login` is for remote OAuth MCP servers, not this stdio SchoolSoft login.

**Check:** after login, ask **“Vad är det till lunch den här veckan?”** and compare the school and dates with SchoolSoft. If there are several children, choose one explicitly.

**If this does not work:** “not configured” means repeat the school-selection step; “not authenticated” means repeat login. If the browser does not open, use the login recovery instructions in this guide on the same computer. For another error, see [Troubleshooting](../troubleshooting.md).

## Use from your phone

After local setup works, follow [OpenAI Remote connections](https://learn.chatgpt.com/docs/remote-connections) to pair your phone. Keep the computer available. Remote uses the host's environment; a new standalone mobile chat is different. Verify a SchoolSoft read remotely before relying on it. Re-login may require returning to the computer's browser.

## Cloud and remote environments

Codex cloud/web execution does not inherit your laptop's SchoolSoft session. An SSH/cloud runtime needs its own browser/callback and storage arrangement. These are not ready phone-only setups in this project. Standalone connectors are [planned](chatgpt.md).

## Update and remove

The example uses an unpinned package; select a reviewed version for repeatable installs. Remove it through MCP settings or `codex mcp remove schoolsoft`. First run `npx -y schoolsoft-agent logout` to delete saved SchoolSoft state. Existing AI conversations are separate.

[Optional browser features](README.md#4-optional-extras-only-if-you-want-them) · [Troubleshooting](../troubleshooting.md) · [Support matrix](support-matrix.md)
