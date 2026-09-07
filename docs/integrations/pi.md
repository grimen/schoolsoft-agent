# Pi

[Pi](https://pi.dev) uses this project's CLI skill in this guide; no MCP bridge is required.

**New to commands?** Read [how to open a terminal and where to type](../getting-started/computer-basics.md). Follow this guide on one computer; skip alternative installation methods until your first school question works.

## Starting from scratch

1. Install a current [Node.js LTS](https://nodejs.org/en/download) that meets Pi's requirements and SchoolSoft's minimum of Node 22.
2. Follow [Pi's official quickstart](https://github.com/earendil-works/pi/tree/main/packages/coding-agent#quick-start) to install Pi.
3. Start `pi`, use `/login` to connect a supported provider, and send a normal message. Provider eligibility/billing is separate from installing Pi.
4. Exit to your terminal and install SchoolSoft below. Return to `pi` afterwards.

This guide uses Pi locally on a computer with a browser. It does not provide an iPhone/Android app or a hosted connector.

**Check before continuing:** the assistant answers a normal “Hej!” and any required commands are available. If not, finish the assistant's installation/sign-in first; adding SchoolSoft will not fix an account or model-access problem.

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

## Check that SchoolSoft was added

Start a new assistant conversation after installation. Ask **“Vilka SchoolSoft-verktyg eller färdigheter har du tillgång till?”** The assistant should identify the SchoolSoft integration. This checks installation only; you have not logged into SchoolSoft yet.

If it cannot find the integration, revisit the installation step and restart the assistant. Check that you used the same computer and user account. Do not proceed by pasting school data or login credentials into the chat.

## First use

Ask: **"Logga in på SchoolSoft."**, or run `schoolsoft-agent login` in a terminal. A browser tab opens SchoolSoft's login; complete BankID there. Pi runs commands without a timeout, so the login can wait the full five minutes.

**Check:** after login, ask **“Vad är det till lunch den här veckan?”** and compare the school and dates with SchoolSoft. If there are several children, choose one explicitly.

**If this does not work:** “not configured” means repeat the school-selection step; “not authenticated” means repeat login. If the browser does not open, use the login recovery instructions in this guide on the same computer. For another error, see [Troubleshooting](../getting-started/troubleshooting.md).

## Try asking

- "Vad har Ella på schemat på fredag?"
- "Vad är det till lunch i veckan?"
- "Vilka läxor finns den här veckan?"

## Optional: contact lists, bookings, files, grades

Run `schoolsoft-agent browser install` once. For grades, documents, absence and assessment criteria also run `schoolsoft-agent login --web` once. Details in [Get started](../getting-started/README.md#4-optional-extras-only-if-you-want-them).

## Update and remove

`npm install -g schoolsoft-agent` again updates the command; re-run `pi install` for the skill. `schoolsoft-agent logout` deletes the saved session.

Problems? [Troubleshooting](../getting-started/troubleshooting.md).
