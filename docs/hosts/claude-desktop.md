# Connect SchoolSoft to Claude Desktop

**Start here if you have a Mac or Windows computer and want a graphical setup.** You will install Claude, add a SchoolSoft extension, log in and ask a question. No terminal is needed.

This guide uses **Chat in the desktop app**. If you are using Claude in a browser or on your phone, open the desktop app on your computer first. [Cowork and other environments](claude-web-cowork.md) have separate requirements.

Before starting, have your usual SchoolSoft website address and BankID ready. Requested school information will enter your Claude conversation. [Read about privacy](../../README.md#privacy).

## Step 1: Install Claude and sign in

1. [Download Claude Desktop](https://claude.ai/download) for your computer and install it.
2. Open the app and sign in or create an account.
3. Send **“Hej!”** in a normal chat.
4. Open **Settings → Extensions** and check that installing an extension is available on your account.

**Check:** Claude answers your greeting and you can open the extension settings.

**If this does not work:** finish Claude's account setup first. If Extensions is missing, update the app and check [Claude's extension instructions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop). A work/school account may restrict extensions. Do not buy a plan just on the assumption that it solves this.

Already have Claude Desktop working? Continue below.

## Step 2: Find your school's short name

1. Open the SchoolSoft website you normally use in your computer's browser.
2. Look at its address. For `https://sms.schoolsoft.se/taby/…`, the short name is **taby**.
3. Keep that short name handy. The extension calls it **School slug**.

**Check:** you have the part immediately after `sms.schoolsoft.se/`, not the whole address.

**If this does not work:** ask your school for its SchoolSoft website address. The short name may be your municipality's name. Do not guess from the school's display name.

## Step 3: Download and install the SchoolSoft extension

1. Open the project's [latest release](https://github.com/grimen/schoolsoft-agent/releases/latest).
2. Under **Assets** (expand it if needed), download **schoolsoft-agent.mcpb**. Do not choose “Source code”.
3. In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…**.
4. Select the downloaded file. It is usually in your **Downloads** folder.
5. Enter the short name from Step 2 in **School slug** and finish installation. Leave optional settings at their defaults.

**Check:** SchoolSoft appears in Claude's installed extensions and is enabled.

**If this does not work:** make sure the filename ends in `.mcpb` and the School slug field is filled in. Re-download the file if it is damaged. If the release has no `.mcpb` asset, stop here and report the missing asset; the source-code archive is not a replacement.

## Step 4: Log in to SchoolSoft

1. Open a new **Chat** in Claude Desktop.
2. Send **“Logga in på SchoolSoft.”**
3. Approve use of the SchoolSoft tool if Claude asks.
4. Complete the login in the browser window that opens on your computer, using BankID as usual.
5. Return to Claude.

**Check:** Claude reports that SchoolSoft is connected, rather than asking you to paste credentials.

**If this does not work:** if Claude cannot find SchoolSoft, check that the extension is enabled and restart Claude. If the browser does not open, ask Claude to show the login link and open it on this same computer. For a long login, ask **“Starta SchoolSoft-inloggningen i bakgrunden och kontrollera när den är klar.”** Never paste BankID codes into the chat.

## Step 5: Ask your first question

Send **“Vad är det till lunch den här veckan?”** Select your child if Claude asks. Compare the answer with SchoolSoft and check the dates.

**You are ready when:** Claude retrieves the correct school's information. You can now try **“Vad har barnen på schemat imorgon?”** or **“Vilka läxor finns den här veckan?”**

If Claude gives a general answer without using SchoolSoft, ask it explicitly to use the SchoolSoft tool. If the school or child is wrong, revisit the extension setting or name the child in your question.

## Later: extra features, updates and removal

You can skip this until the first question works.

- For contacts, files or other extra information, follow [optional features](README.md#4-optional-extras-only-if-you-want-them).
- When SchoolSoft asks for login again, repeat Step 4.
- To update, download the new `.mcpb` release and install it using Step 3.
- To remove access, first ask Claude to log out of SchoolSoft, then remove the extension in Settings. Removing an extension does not delete previous Claude conversations.

[More troubleshooting](../troubleshooting.md) · [Choose a different assistant](README.md)

## For developers

`make mcpb` builds the bundle from `plugins/mcpb/manifest.json`. The bundle format is [MCPB](https://github.com/anthropics/mcpb).
