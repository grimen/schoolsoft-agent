# Pi

[Pi](https://pi.dev) has no MCP support, so the skill is the surface.

## What you need

- Pi installed ([pi-mono on GitHub](https://github.com/badlogic/pi-mono)).
- [Node.js](https://nodejs.org/en/download) 22 or newer.
- Your school's name, and BankID.

## Install

```bash
pi install git:github.com/grimen/schoolsoft-agent
npm install -g schoolsoft-agent
schoolsoft-agent configure --query "Rösjöskolan"
```

The repository declares the skill for Pi in its `package.json`. Installing the command globally avoids an `npx` start-up on every call. Pi also reads skills from `.agents/skills/` and `~/.pi/agent/skills/`; from a checkout, `make install-pi` copies it there.

## First use

Ask: **"Logga in på SchoolSoft."**, or run `schoolsoft-agent login` in a terminal. A browser tab opens SchoolSoft's login; complete BankID there. Pi runs commands without a timeout, so the login can wait the full five minutes.

## Try asking

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "Vilka läxor finns den här veckan?"

## Optional: contact lists, bookings, files, grades

Run `schoolsoft-agent browser install` once. For grades, documents, absence and assessment criteria also run `schoolsoft-agent login --web` once. Details in [Get started](README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

`npm install -g schoolsoft-agent` again updates the command; re-run `pi install` for the skill. `schoolsoft-agent logout` deletes the saved session.

Problems? [Troubleshooting](../troubleshooting.md).
