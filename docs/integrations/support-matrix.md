# Support matrix: where SchoolSoft runs

Checked against project configuration and vendor documentation on **2026-09-07**. Account eligibility and app interfaces can change.

**Existing guide** means a local integration path is supplied, not that every app/OS version is live-tested. **Documented configuration** is a new configuration based on vendor support, without a completed SchoolSoft live test. **Conditional** requires validation in that particular runtime. **Release candidate** means implementation and deployment instructions exist with offline tests, but SchoolSoft public-callback login and real AI client/mobile acceptance remain pending. It is not yet a supported parent deployment.

Effort includes installing the assistant and signing into a model: **Low** = graphical setup; **Medium** = commands/configuration; **High** = server, sandbox or remote-access setup. These are estimates, not measured times. An existing agent installation reduces the extra work.

## Claude

| Product / surface                                             | SchoolSoft status    | Where / how it connects                                          | Effort                     | Guide                                             |
| ------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| Claude Desktop Chat, Mac/Windows                              | Existing guide       | Local `.mcpb` extension                                          | Low                        | [App + extension](claude/desktop.md)              |
| Claude Code local CLI/IDE                                     | Existing guide       | Local MCP plugin or CLI skill                                    | Medium                     | [Code + plugin](claude/code.md)                   |
| Claude Code desktop Code tab, local session                   | Conditional          | Code's MCP/plugin settings, separate from Chat                   | Medium                     | [Code setup](claude/code.md)                      |
| Claude Code cloud/web execution                               | No ready local setup | Cloud runner has no inherited local SchoolSoft session/browser   | High                       | [Cloud limits](claude/web-cowork.md)              |
| Claude Code Remote Control from web/mobile                    | Conditional          | Controls Code running on your computer                           | Medium after local setup   | [Remote Control](claude/web-cowork.md)            |
| Claude Cowork on desktop                                      | Conditional          | Local connector through desktop; different environment from Chat | Medium                     | [Cowork guide](claude/web-cowork.md)              |
| Cowork web/mobile with connected desktop                      | Conditional          | Local tools depend on an available desktop connection/session    | Medium after desktop setup | [Cowork across devices](claude/web-cowork.md)     |
| Claude Chat web/mobile or Cowork without a connected computer | Release candidate    | Parent-operated remote MCP server                                | Medium–High; own hosting   | [Parent-hosted setup](../deployment/connector.md) |

## OpenAI

| Product / surface                             | SchoolSoft status                 | Where / how it connects                                                  | Effort                   | Guide                                                               |
| --------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------- |
| Codex local CLI/IDE                           | Documented configuration          | Local stdio MCP; CLI skill also possible                                 | Medium                   | [Codex setup](openai/codex.md)                                      |
| ChatGPT desktop app, local Codex host         | Documented configuration          | Desktop MCP settings start the local server                              | Medium                   | [Desktop setup](openai/codex.md)                                    |
| ChatGPT desktop Chat/Work                     | Conditional on active environment | Local-host MCP where available; hosted chats do not inherit local config | Medium                   | [Choose environment](openai/chatgpt.md)                             |
| ChatGPT mobile Remote controlling Mac/Windows | Conditional                       | Tools/session remain on connected computer                               | Medium after local setup | [Remote setup](openai/codex.md#use-from-your-phone)                 |
| ChatGPT web/mobile standalone Chat/Work       | Release candidate                 | Parent-operated remote connector/plugin                                  | Medium–High; own hosting | [Parent-hosted setup](../deployment/connector.md)                   |
| Codex cloud/web execution                     | No ready local setup              | Needs its own browser/login and state arrangement                        | High                     | [Cloud environments](openai/codex.md#cloud-and-remote-environments) |

The desktop app can contain multiple experiences. Verify SchoolSoft appears in the local host's tools; having an app installed alone does not establish where tools run.

## Other agents and the command line

| Assistant                                      | SchoolSoft status                                   | Where / how                                                      | Effort from scratch | Guide                                                                                                |
| ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| OpenClaw on your computer                      | Existing guide; CLI syntax updated from vendor docs | Local MCP or repository skill                                    | Medium              | [Install OpenClaw + SchoolSoft](openclaw.md)                                                         |
| Hermes Agent on your computer                  | Existing guide                                      | CLI skill or local MCP                                           | Medium              | [Install Hermes + SchoolSoft](hermes.md)                                                             |
| Pi on your computer                            | Existing guide                                      | CLI skill                                                        | Medium              | [Install Pi + SchoolSoft](pi.md)                                                                     |
| OpenCode local session                         | Existing guide                                      | MCP config or CLI skill                                          | Medium              | [Install OpenCode + SchoolSoft](opencode.md)                                                         |
| Other local stdio MCP host                     | Conditional                                         | Starts SchoolSoft on your computer                               | Medium              | [Generic setup](other-mcp-hosts.md)                                                                  |
| OpenClaw/Hermes messaging channel or remote UI | Conditional                                         | Messages reach an agent on your always-on computer/server        | Medium–High         | [OpenClaw](openclaw.md), [Hermes](hermes.md)                                                         |
| Any agent in Docker, WSL, SSH or cloud         | Advanced; login needs validation                    | Browser callback, network and storage must reach correct runtime | High                | [Runtime requirements](../getting-started/README.md#running-on-another-computer-in-docker-or-in-wsl) |
| Terminal only, no AI assistant                 | Existing CLI                                        | Direct commands on your computer                                 | Medium              | [Commands](../reference/commands.md)                                                                 |

## Using a phone

1. **Phone with a computer running SchoolSoft:** install and log in locally first, then enable a vendor-supported remote-control or messaging path. Keep the computer/app awake and connected. Re-login may require its browser. Combined SchoolSoft/mobile paths remain conditional until validated.
2. **Phone only, no computer running at home:** the [parent-hosted connector](../deployment/connector.md) runs on a server in your own hosting account. Deployment recipes and an owner setup page are implemented as a release candidate. Real SchoolSoft callback login, AI account eligibility and mobile availability must still be checked. Start setup in a desktop browser where possible; this is not yet a proven phone-only route. The project author does not host families' sessions.

The remote connector currently offers **children, schedule and lunch**. Local guides cover the broader operation set. A successful local login does not validate the remote HTTPS callback.

Remote control is different from uploading a local skill into a cloud chat. Support for the skill format or MCP alone does not prove that the existing browser login works.

## Data and accounts

Your session is stored on the machine running SchoolSoft. Requested results go to the assistant/model provider; messaging routes can also involve a messaging provider. Local tools do not imply a local model. Hosting providers operate any server you rent. This package includes neither AI access nor a hosting subscription. Read [Privacy](../../README.md#privacy).

## Evidence and vendor references

- [Claude connector types](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors), [Code desktop](https://code.claude.com/docs/en/desktop), [Code Remote Control](https://code.claude.com/docs/en/remote-control), [Cowork across devices](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile).
- [Official OpenAI MCP docs](https://learn.chatgpt.com/docs/extend/mcp), [Remote connections](https://learn.chatgpt.com/docs/remote-connections), [plugins](https://learn.chatgpt.com/docs/plugins).
- [OpenClaw setup](https://docs.openclaw.ai/start/getting-started), [MCP](https://docs.openclaw.ai/cli/mcp), [Hermes setup](https://hermes-agent.nousresearch.com/docs/getting-started/installation), [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent), [OpenCode](https://opencode.ai/docs/).

Repository protocol/packaging tests do not log into every vendor app. A live support record should name the app version, OS, account type, install path, first login/read, expiry/re-login and removal, without personal data.
