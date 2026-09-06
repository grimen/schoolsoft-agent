# Get started: pick your AI app

This project lets the AI assistant you already use answer questions about your child's school day from [SchoolSoft](https://www.schoolsoft.se): schedule, lunch, homework, news, messages, and more. You log in with [BankID](https://www.bankid.com/en) in your own browser, exactly as you do on SchoolSoft's website. Nothing is automated around the login, and no password or code is ever typed into the assistant.

> Independent project. SchoolSoft is a trademark of SchoolSoft AB and BankID of Finansiell ID-Teknik BID AB; neither is involved in this project. Read [Privacy](../../README.md#privacy) before you start.

## 1. Which app do you talk to?

| You use…                                                           | Guide                                     | How it connects                                                   |
| ------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| **Claude Desktop** (the Claude app on Mac or Windows)              | [Claude Desktop guide](claude-desktop.md) | One downloadable extension file. Easiest for non-technical users. |
| **Claude Code** (Claude in the terminal or in VS Code / JetBrains) | [Claude Code guide](claude-code.md)       | Two slash commands.                                               |
| **OpenCode**                                                       | [OpenCode guide](opencode.md)             | A short config snippet.                                           |
| **OpenClaw**                                                       | [OpenClaw guide](openclaw.md)             | One command.                                                      |
| **Hermes Agent**                                                   | [Hermes guide](hermes.md)                 | One command.                                                      |
| **Pi**                                                             | [Pi guide](pi.md)                         | One command.                                                      |
| **ChatGPT**                                                        | [ChatGPT status](chatgpt.md)              | Not yet; explains why and what works today.                       |
| **Something else that speaks MCP**                                 | [Any MCP host](other-mcp-hosts.md)        | The generic configuration.                                        |

## 2. What you need

- A computer (Mac, Windows or Linux). Your phone is only used for BankID, as usual.
- [Node.js](https://nodejs.org/en/download) version 22 or newer. Claude Desktop users do not need this; the extension brings its own.
- Your SchoolSoft school, by name (for example "Rösjöskolan"). The tools find the technical identifier for you.
- BankID on your phone or computer, as you already use it with SchoolSoft.

## 3. The three things that happen on first use

1. **Configure**: the assistant (or you, in a terminal) looks up your school by name. This happens once.
2. **Log in**: a browser tab opens SchoolSoft's real login page. You complete BankID there. The assistant waits, then continues. Your session is saved encrypted on your computer, so this happens rarely.
3. **Ask**: "Vad har Ella på schemat imorgon?", "Vad är det till lunch i veckan?", "Har vi fått några meddelanden från skolan?", "Vilka läxor finns den här veckan?". If you have several children, the assistant asks which one, or you name the child.

## 4. Optional extras, only if you want them

Some SchoolSoft pages have no data feed, so the assistant reads the web page itself through a hidden browser on your computer:

- **Contact lists, bookings, shared files** need the hidden browser once: `npx -y schoolsoft-agent browser install` (downloads Chromium, about 150 MB).
- **Grades, student documents, absence, attendance report, assessment criteria** additionally need a second login, done once: `npx -y schoolsoft-agent login --web`. A normal browser window opens SchoolSoft's login; you complete BankID as usual; the window closes when you land on the start page. This is because SchoolSoft only shows these pages to a "real" web login. It expires after a while of inactivity; the assistant tells you when to run it again.

Everything else works without either step.

## 5. When something does not work

[Troubleshooting](../troubleshooting.md) covers the messages you may see, in plain language: not configured, not logged in, "Vi kunde inte hitta användaren", the browser did not open, the session expired, and the pages that need the second login.

## Words you will meet

- **MCP**: the standard AI assistants use to call tools. The "MCP server" is the piece your assistant talks to; it runs on your computer.
- **Skill**: a set of instructions plus a small command-line program that an assistant uses instead of MCP. Same data, different plumbing. Pick whichever your app supports; the guides tell you.
- **School slug**: the short name in your SchoolSoft address, `https://sms.schoolsoft.se/<slug>/…`. You do not need to know it; `configure --query "<school name>"` finds it.
- **Web login**: the second, optional login described above, for the pages SchoolSoft gates.

## For the curious

[What the assistant can ask for](../reference/tools.md) · [Every command](../reference/commands.md) · [How login works](../../README.md#how-login-works) · [What SchoolSoft actually exposes](../schoolsoft-api.md) · [How it is built](../architecture.md)
