# Start here: ask about your child's school day

This guide helps you connect SchoolSoft to an AI assistant. You will install an app, add SchoolSoft, log in with BankID and ask your first question.

**You do not need to know how to code.** Choose one route below and follow its guide. You do not need to install all the assistants.

> This is an independent project, not a SchoolSoft or BankID product. Information you ask for is sent to your chosen AI assistant. Read [where your data goes](../../README.md#privacy) before connecting an account.

## 1. Choose your starting point

**I have a Mac or Windows computer and want the easiest graphical setup.**

Start with **[Claude Desktop: step-by-step setup](claude-desktop.md)**. You install the Claude app and one SchoolSoft extension file. You do not need a terminal or a server. Check that your Claude account allows extensions before buying anything.

**I already know which assistant I want to use.**

Open just that guide. Each starts with installing the assistant if you do not have it yet:

[ChatGPT desktop / Codex](codex.md) · [OpenClaw](openclaw.md) · [Hermes](hermes.md) · [Pi](pi.md) · [OpenCode](opencode.md) · [Claude Code](claude-code.md)

These routes include commands or settings to copy. If that is unfamiliar, read [how to enter commands](computer-basics.md) first. Installing this SchoolSoft add-on is free; the assistant or model service you choose may charge for use.

**I only have a phone or tablet.**

The [parent-hosted connector](parent-connector.md) is an implemented release candidate for Claude/ChatGPT without a local agent. You need your own hosting account, and real SchoolSoft login plus AI client/mobile acceptance still need testing. Do not pay for hosting expecting a proven phone-only setup yet. Some assistants can instead control a computer you keep running; read [phone options](support-matrix.md#using-a-phone). You do not need a server for the recommended desktop setup.

If you choose the connector, [compare hosting options](hosting-options.md) and follow its guide from here: the computer instructions below cover the local routes.

Not sure whether your app is supported? The [detailed support matrix](support-matrix.md) explains desktop, web, mobile and advanced options. You can skip it if you have chosen a guide.

## 2. What you need

- Your computer and an internet connection.
- Access to your child's SchoolSoft account and the login method your school uses, such as BankID.
- Your usual SchoolSoft website address. Open it in your browser so it is easy to find.
- An account with the assistant you choose. First send it an ordinary message, such as “Hej!”, to check that it works.

Your assistant's guide tells you whether you need any extra software. Claude Desktop's extension does not require a separate Node.js installation.

## 3. The three things that happen on first use

Follow your chosen assistant's guide rather than installing anything from this overview.

1. **Choose the school.** Enter its name or the short name from its website address, as your guide explains.
2. **Log in.** The computer opens SchoolSoft in your browser. Complete BankID there yourself, then return to the assistant. Never type a BankID code or password into the chat.
3. **Ask one question.** Try: **“Vad är det till lunch den här veckan?”** If asked, select your child. Check the first answer against SchoolSoft to make sure the school, child and dates are right.

**You are finished when:** the assistant retrieves an answer from SchoolSoft for the right child. If it says it cannot access SchoolSoft, return to the “Check” or “If this does not work” instructions in your chosen guide.

Your login is saved on the computer running the integration. When it expires, the assistant will need you to log in again.

## 4. Optional extras, only if you want them

**Local installations only: skip this section until your first lunch or schedule question works.** The parent-hosted connector currently offers children, schedule and lunch; these extras do not add remote tools.

Some information needs extra setup. Contact lists, bookings and shared files need an additional browser component. Grades, documents and attendance information also need a separate SchoolSoft web login.

Ask your assistant to help with the feature you need. If your guide uses terminal commands, these are the extra steps:

```bash
npx -y schoolsoft-agent browser install
```

For information that requires the separate login:

```bash
npx -y schoolsoft-agent login --web
```

The second command opens a browser on your computer. Complete the login yourself. It may need repeating after a period of inactivity. You do not need these extras for ordinary schedule and lunch questions.

## 5. When something does not work

| What happened                                  | What to do next                                                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The assistant cannot answer an ordinary “Hej!” | Finish signing into the assistant or its model service first. SchoolSoft is not connected yet.                         |
| The assistant says it has no SchoolSoft tools  | Reopen your assistant's guide and check the installation step. Restart the app if the guide asks you to.               |
| No login browser opens                         | Follow your guide's login recovery step on the same computer. Opening a login link on a different device may not work. |
| BankID takes longer than the assistant waits   | Ask: “Starta SchoolSoft-inloggningen i bakgrunden och kontrollera när den är klar.”                                    |
| The answer concerns the wrong child or date    | Name the child and date explicitly, and check the result in SchoolSoft.                                                |
| It worked before but asks for login again      | Ask “Logga in på SchoolSoft” and complete the browser login again.                                                     |

For other errors, see [Troubleshooting](../troubleshooting.md). If asking for help, share the error wording and the app/OS you use. Do not share children's information, login codes or session files.

## Running on another computer, in Docker or in WSL

**Advanced: skip this for the normal desktop setup.** The login returns to a local address (`127.0.0.1`). The browser and the program waiting for that return must be able to reach each other. A link opened on your phone does not automatically log in an agent on a server.

Containers, WSL and remote servers running the local agent need additional browser, network and saved-session configuration. The separate [parent-hosted connector recipe](parent-connector.md) uses an HTTPS callback instead of localhost. Follow the [support matrix](support-matrix.md) before choosing one of these environments.

## Words you will meet

- **Extension:** an add-on installed in your assistant; the Claude Desktop route uses one.
- **MCP:** a way for an assistant to use tools. In a setup form, it identifies the connection you are adding.
- **Skill:** instructions that let an assistant use the SchoolSoft command.
- **School slug:** a short name from the website address. In `https://sms.schoolsoft.se/taby/…`, it is `taby`. It can name a municipality rather than an individual school.
- **Terminal:** the app where you paste commands. [How to open it](computer-basics.md).

[What you can ask](../reference/tools.md) · [Privacy](../../README.md#privacy) · [Support matrix](support-matrix.md)
