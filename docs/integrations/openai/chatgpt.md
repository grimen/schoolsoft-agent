# ChatGPT: desktop, web and mobile

**Choose by execution environment, not just the ChatGPT name.** The desktop app can use a local Codex host; standalone hosted conversations use remote tools. [Official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

| What you want                                            | Current SchoolSoft path                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Desktop app's local Codex environment                    | [Local MCP setup](codex.md); documented configuration, live app validation still needed                            |
| Desktop Chat/Work                                        | Check that the active environment exposes the local MCP server; otherwise use local Codex                          |
| Phone controlling your computer                          | [Remote setup](codex.md#use-from-your-phone); computer stays available                                             |
| Standalone ChatGPT web/mobile with no connected computer | [Parent-hosted connector](../../deployment/connector.md); release candidate, real client/mobile acceptance pending |
| Codex cloud/web execution                                | [Separate environment requirements](codex.md#cloud-and-remote-environments)                                        |

## Starting from scratch

If you have a supported computer, follow the [Codex guide](codex.md), beginning with installing the app and signing in. For an extension-file setup, [Claude Desktop](../claude/desktop.md) is another option. You do not need an existing OpenClaw or other agent.

## Remote connector status

The project now includes a **parent-hosted HTTPS connector release candidate**, with setup and deployment recipes. It offers children, schedule, calendar and lunch. You deploy your own copy and add its `/mcp` address to an eligible ChatGPT account; the project author supplies no shared SchoolSoft endpoint. A skill upload does not perform this setup.

Follow [your own connector: step-by-step setup](../../deployment/connector.md) for hosting, SchoolSoft login, permissions and the first question. The implementation has offline tests; live SchoolSoft public-callback acceptance and real ChatGPT web/mobile operation remain unverified. Check account eligibility before paying for hosting. Desktop setup should be tested first, then the phone app.

Vendor tunnels and remote-control features are separate options; installing this package does not configure them. See the [support matrix](../support-matrix.md).

## Terminal-only alternative

On your computer, without an AI assistant:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
npx -y schoolsoft-agent login
npx -y schoolsoft-agent get-schedule --pretty
```

These commands display results in the terminal; they do not connect a standalone ChatGPT conversation to SchoolSoft. [Command reference](../../reference/commands.md).
