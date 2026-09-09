# Claude Cowork, web and mobile

For a graphical starting point, use the [Claude Desktop Chat extension](desktop.md). Claude Code has a [separate guide](code.md). Other Claude environments have different runtime and login requirements.

## Cowork with desktop-connected tools

Anthropic documents local connectors through desktop and continuation across devices. Cloud sessions can continue without a computer, but local tools depend on the desktop connection. Follow [Cowork across devices](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile) for current eligibility and session-start requirements.

To evaluate SchoolSoft:

1. First install the [desktop extension](desktop.md) and verify a read in Chat.
2. Start Cowork on desktop and check that SchoolSoft is available. If absent, use Chat; a skill upload does not substitute for the local connector.
3. Verify a read and, if needed, login in the computer's browser. Cowork may use a different environment; Chat login alone does not prove access.
4. Only then continue through a supported web/mobile Cowork interface, keeping the desktop connection available.

**Conditional, not SchoolSoft end-to-end verified.** Do not assume the local connector continues working with the computer off.

## Claude Code Remote Control

Set up [Code locally](code.md), including SchoolSoft login and a successful read. Follow [Code Remote Control](https://code.claude.com/docs/en/remote-control) to continue from web/mobile while Code runs on your computer. Keep the local process running and verify a remote read. A new cloud Code task is a separate environment. Account eligibility applies; API-only Code access does not necessarily include Remote Control.

## Standalone web/mobile

The project now includes a **parent-hosted HTTPS connector release candidate** and deployment recipes for children, schedule, calendar and lunch. A local `.mcpb` or CLI skill cannot be pasted into an HTTPS URL field; you add the address of your own deployed connector instead. See [Claude's remote connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Follow [your own connector: step-by-step setup](../../deployment/connector.md). **You host it in your own account**; the project author receives no family sessions. Offline tests exercise the implementation, but SchoolSoft public-callback login and actual Claude web/mobile acceptance still need real tests. Check your account's custom-connector option before paying for hosting, and verify desktop setup before trying mobile. A connector working in one Claude environment does not prove that it is available in every Cowork or Code environment.

[Support matrix](../support-matrix.md) · [Getting started](../../getting-started/README.md)
