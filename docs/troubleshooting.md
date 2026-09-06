# Troubleshooting

Plain-language explanations of what you may see, what it means, and what to do. Every message below comes from the tool itself; your assistant will usually relay it and often fix it on its own.

## "SchoolSoft is not configured"

The tool does not know which school you belong to. Run, in a terminal:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

Replace the name with your school's. It lists matches; pick yours. Claude Desktop users set the school when installing the extension instead.

## "Not authenticated with SchoolSoft"

There is no saved session, or it has expired for good. Ask the assistant to log in, or run:

```bash
npx -y schoolsoft-agent login
```

A browser tab opens SchoolSoft's login page. Complete BankID there. The command waits up to five minutes and then confirms. You do this rarely: the session is refreshed silently for as long as SchoolSoft allows.

## The browser did not open

Some assistants run in a sandbox that cannot open windows. The login URL is always printed as well; the assistant shows it to you. Open it yourself in any browser on the same computer and complete BankID. The tool notices when SchoolSoft redirects back.

If you use a remote or containerised assistant, run `login` once in a normal terminal on the same machine; the saved session is shared.

## "Vi kunde inte hitta användaren" after BankID

SchoolSoft says it cannot find the user. This happens when the login was made as a student instead of a guardian. The tool always logs in on the guardian route, so if you see this, check that the BankID you used is the one registered as guardian at the school, and that you completed the login on the page the tool opened (not a page you navigated to yourself). Try `logout`, then `login` again.

## Login seems stuck in a loop

Clear the saved session and start over:

```bash
npx -y schoolsoft-agent logout
npx -y schoolsoft-agent login
```

If it still loops, clear your browser's cookies for `sms.schoolsoft.se` and your municipality's login site, then try again.

## "…needs the headless browser: run schoolsoft-agent browser install"

Contact lists, bookings, shared files and the gated pages below are read from SchoolSoft's web pages through a hidden browser on your computer. Install it once:

```bash
npx -y schoolsoft-agent browser install
```

It downloads Chromium (about 150 MB). Everything else works without it.

## "…needs a WEB login session: run schoolsoft-agent login --web"

Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are only shown by SchoolSoft to a "real" web login, not to the kind of session apps use. Do the second login once:

```bash
npx -y schoolsoft-agent login --web
```

A visible browser window opens SchoolSoft's login. Complete BankID as usual (it may continue in a second tab; that is fine). The window closes when you land on the start page.

## "…the web login session expired (inactivity). Run login --web again"

SchoolSoft logs web sessions out after a period without activity. Run `login --web` again; your normal session is unaffected.

## "npm ERR! 404 Not Found: schoolsoft-agent"

The package has not reached npm yet (first release pending). Until then, install from the source:

```bash
git clone https://github.com/grimen/schoolsoft-agent && cd schoolsoft-agent
make setup && npm run build && npm link
schoolsoft-agent configure --query "<school name>"
```

`npm link` puts `schoolsoft-agent` and `schoolsoft-agent-mcp` on your PATH; the host guides then work with the `npx -y schoolsoft-agent` parts replaced by the bare command.

## Check everything at once

```bash
npx -y schoolsoft-agent doctor
```

Reports Node version, configuration, saved session, network reachability, the hidden browser and how the login window is opened. Each line says what to do if it is not OK. `doctor --fix` moves a session saved by an older version into place.

## Still stuck?

Open an issue at <https://github.com/grimen/schoolsoft-agent/issues>. Paste the output of `doctor` (it contains no personal data) and the exact message you saw.
