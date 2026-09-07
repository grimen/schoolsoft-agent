# How to follow a guide with commands

You can skip this page if you are using the [Claude Desktop extension](claude-desktop.md). That guide uses app settings instead of commands.

## Open a terminal

- **Mac:** press Command–Space, type **Terminal**, then open it.
- **Windows:** open Start, search for **PowerShell**, then open it normally. You do not need “Run as administrator” for the SchoolSoft commands.
- **Linux:** open your usual Terminal app.

A terminal is a window where you type instructions for your computer. The guides show exactly which commands to use.

## Copy one command at a time

1. Copy the command inside the code box, without the surrounding Markdown marks.
2. Paste it into the terminal and press Enter.
3. Wait until it finishes and the terminal is ready for another command.
4. Continue with the next line. If you see an error, use the guide's recovery step first.

For example, this checks whether Node.js is installed:

```bash
node --version
```

**Check:** you see a version such as `v24.x.x`. SchoolSoft needs version 22 or newer; your assistant may require a newer version.

If the command is not found, install [Node.js](https://nodejs.org/en/download) using the installer for your computer, then close and reopen the terminal. Node includes `npm` and `npx`, which the guides use to install or run software. Do not enter the example version text as a command.

## Know where to type

- **Terminal commands** such as `npx ...` run in Terminal or PowerShell.
- **Assistant commands** such as `/login` or `/connect` go inside the named assistant, when its guide tells you to use them.
- **School questions** such as “Vad är det till lunch?” go into the assistant's chat.
- **Settings snippets** such as JSON or TOML go in a configuration file or settings editor, not into a chat or terminal. Keep existing settings when adding the example.

An **AI provider** is the service that supplies the assistant's model. Follow the assistant's sign-in screen; model access may have its own subscription or usage bill. Enter any API key only in the provider settings that request it, never in an ordinary conversation.

## Replace the school name

When a guide shows:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

Replace only **Rösjöskolan** with your school's name. Keep the quotation marks. If several schools match, follow the command's selection instructions rather than assuming the first result is yours.

## If you get stuck

“Command not found” usually means the program is not installed or the terminal needs reopening. “Not configured” means the school-selection step is still needed. “Not authenticated” means you need to log in to SchoolSoft again.

Use the same computer and user account for setup and the assistant. SchoolSoft's browser login must return to the computer running the integration. See [Troubleshooting](../troubleshooting.md) for other errors; do not share login codes, session files or children's information when asking for help.

[Back to choosing an assistant](README.md)
