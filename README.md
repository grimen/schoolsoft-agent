# schoolsoft-agent

[![Unit](https://github.com/grimen/schoolsoft-agent/raw/gh-pages/badges/main/unit.svg)](https://github.com/grimen/schoolsoft-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![E2E](https://github.com/grimen/schoolsoft-agent/raw/gh-pages/badges/main/e2e.svg)](https://github.com/grimen/schoolsoft-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![Coverage](https://github.com/grimen/schoolsoft-agent/raw/gh-pages/badges/main/coverage.svg)](https://github.com/grimen/schoolsoft-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![npm](https://img.shields.io/npm/v/schoolsoft-agent)](https://www.npmjs.com/package/schoolsoft-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

<img src="docs/assets/readme-hero.svg" alt="Independent project; SchoolSoft and BankID are trademarks of their owners, who are not involved. A parent asks their AI agent about school. The agent reaches schoolsoft-agent through its MCP server or its CLI skill; both share one core that logs in with BankID in the parent's own browser and reads schedule, lunch, assignments, news and messages from SchoolSoft. SchoolSoft is a trademark of SchoolSoft AB, not involved in this project." width="960">

[SchoolSoft](https://www.schoolsoft.se) for AI agents. Lets an agent (Claude, OpenCode, OpenClaw, Hermes, Pi, …) read a guardian's SchoolSoft data: schedule, lunch menu, assignments, news and the message inbox. Login is [BankID](https://www.bankid.com) in your own browser; nothing is automated around it, and the session is stored encrypted on your machine.

Two surfaces, one core. Pick the one your host supports or you prefer:

| Surface                               | What it is                                                                          | Best for                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **MCP server** `schoolsoft-agent-mcp` | A stdio MCP server exposing one tool per operation                                  | Claude Code, Claude Desktop, OpenCode, OpenClaw, Hermes, any MCP host |
| **CLI + skill** `schoolsoft-agent`    | A JSON-emitting CLI wrapped by an [Agent Skills](https://agentskills.io) `SKILL.md` | Hosts without MCP (Pi), shell-first agents, scripting                 |

Both are the same npm package and behave identically, because every capability is defined once as an _operation_ and both surfaces are generated from that list. See [docs/architecture.md](docs/architecture.md).

> **Independent project.** [SchoolSoft](https://www.schoolsoft.se) is a trademark of SchoolSoft AB. This is an independent, MIT-licensed community project: it is not affiliated with, endorsed by, or supported by SchoolSoft AB, and SchoolSoft has no involvement in it. It talks to SchoolSoft through the same unofficial APIs the SchoolSoft app uses; read [Trademark and independence](#trademark-and-independence) and [Privacy](#privacy) before installing.

## Start here: which AI app do you use?

You do not need to be technical. Pick your app; each guide is a few steps with copy-paste commands, written for parents.

| Your app                                        | Guide                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| Claude Desktop (the Claude app, Mac or Windows) | [Install the extension](docs/hosts/claude-desktop.md)  |
| Claude Code (terminal, VS Code, JetBrains)      | [Two slash commands](docs/hosts/claude-code.md)        |
| OpenCode                                        | [A short config snippet](docs/hosts/opencode.md)       |
| OpenClaw                                        | [One command](docs/hosts/openclaw.md)                  |
| Hermes Agent                                    | [One command](docs/hosts/hermes.md)                    |
| Pi                                              | [One command](docs/hosts/pi.md)                        |
| ChatGPT                                         | [Not yet, and why](docs/hosts/chatgpt.md)              |
| Another MCP-capable assistant                   | [Generic configuration](docs/hosts/other-mcp-hosts.md) |

Not sure? Start with the [getting-started overview](docs/hosts/README.md): what you need, the three things that happen on first use, and the words you will meet. When something does not work, [Troubleshooting](docs/troubleshooting.md) explains every message in plain language.

## Try it in a terminal first (optional)

Prerequisite: [Node.js](https://nodejs.org/en/download) 22 or newer.

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"   # finds your school
npx -y schoolsoft-agent login                              # BankID in your browser
npx -y schoolsoft-agent get-schedule --pretty              # this week's schedule
```

Every command is in the [command reference](docs/reference/commands.md); every crucial one is also a `make` target in a checkout (`make help`). Messages come in Swedish when your system language is Swedish (or with `SCHOOLSOFT_LANG=sv`), always as "what went wrong" plus "Next: what to do".

## What you can ask

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "Har vi fått några meddelanden från skolan?"
- "Vilka läxor finns den här veckan?"

The agent picks the child (`list_children`), the week, and the right operation. Contact lists, bookings and shared files have no data feed at SchoolSoft; those are read through an optional hidden browser (`npx -y schoolsoft-agent browser install`, once). Grades, student documents, absence reports and assessment criteria additionally sit behind SchoolSoft's "log in again" gate and need `npx -y schoolsoft-agent login --web` once, a normal web login in a browser window. Both extras are explained step by step in [Get started](docs/hosts/README.md#4-optional-extras-only-if-you-want-them). Full list of what an agent can ask for: [MCP tools](docs/reference/tools.md) · [CLI commands](docs/reference/commands.md).

## How login works

1. The agent calls `login`. Your browser opens SchoolSoft's real login page for guardians.
2. You authenticate with BankID (or whatever your municipality offers). The integration never sees credentials.
3. SchoolSoft redirects to `http://127.0.0.1:43117/callback` with a one-time code; the integration exchanges it for tokens and session cookies.
4. Tokens are stored encrypted (AES-256-GCM, key file `0600`) and refreshed silently. You log in again only when the refresh token expires.

Login problems are covered in [Troubleshooting](docs/troubleshooting.md). Details and diagrams: [docs/architecture.md](docs/architecture.md). What SchoolSoft actually exposes: [docs/schoolsoft-api.md](docs/schoolsoft-api.md).

## Privacy

- Your children's data is only ever sent to SchoolSoft and to the AI model you are talking to, in the conversation you started. No telemetry, no third party.
- The only thing stored on disk is the encrypted session (tokens, cookies, the list of your children with names and class) under your platform's config directory (`schoolsoft-agent doctor` shows where). `schoolsoft-agent logout` deletes it.
- Nothing is written to log files. Diagnostics on stderr never include personal data.
- This is unofficial automated access. Check SchoolSoft's terms of service for your municipality before relying on it.
- Nothing is ever written to SchoolSoft: every tool is read-only, and the hidden browser blocks any request that could change something.

## Development

```bash
git clone https://github.com/grimen/schoolsoft-agent && cd schoolsoft-agent
make setup          # node check + npm ci + git hooks
make check          # lint, typecheck, format, boundaries, manifests, tests with coverage
make e2e-artifact   # shipped-artifact + host E2E in a sandbox (what CI runs)
make e2e            # live suite against SchoolSoft (needs configure + one login)
make help           # everything else
```

Layout, boundaries, design principles and the test pyramid are in [docs/architecture.md](docs/architecture.md); conventions, hooks and the CI stages in [CONTRIBUTING.md](CONTRIBUTING.md); how versions ship in [docs/releasing.md](docs/releasing.md); the rules every coding agent follows in [AGENTS.md](AGENTS.md). What we know about SchoolSoft's unofficial APIs and web pages, page by page, is in [docs/schoolsoft-api.md](docs/schoolsoft-api.md). Adding an operation touches one file under `src/core/operations/` plus the registry; both surfaces and the docs follow.

## Roadmap

- Write operations: report absence, send message (separate spec; confirmation-gated).
- Remote transport (streamable HTTP with per-user storage) so ChatGPT and hosted agents can use it.
- Claude Desktop extension directory listing.
- Other school portals: everything vendor-specific sits behind one `SchoolProvider` seam (`src/providers/`), so a second Swedish portal is a new provider directory, not a rewrite. All of them end their login in BankID, which the core already handles two ways.

## Trademark and independence

SchoolSoft is a trademark of SchoolSoft AB. This is an independent, MIT-licensed community project: it is not affiliated with, endorsed by, or supported by SchoolSoft AB, and SchoolSoft has no involvement in it. The name is used only to describe what the software connects to. [BankID](https://www.bankid.com) is a trademark of Finansiell ID-Teknik BID AB; Claude, ChatGPT, OpenCode, OpenClaw, Hermes and Pi are trademarks of their respective owners. All are named descriptively, and none of these organisations is involved in or endorses this project. No logos or brand assets are used. If any rights holder objects to a use of their name, open an issue and it will be addressed.

## License

MIT © Jonas Grimfelt. Runtime dependency on [elias4044/ssp-node](https://github.com/elias4044/ssp-node) (MIT) for HTTP helpers. The unofficial API knowledge and its sources are documented in [docs/schoolsoft-api.md](docs/schoolsoft-api.md).
