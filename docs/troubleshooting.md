# Troubleshooting

Plain-language explanations of what you may see, what it means, and what to do. Every message below comes from the tool itself, always as two lines: the problem, then "Next: what to do". Your assistant will usually relay it and often fix it on its own. Set `SCHOOLSOFT_LANG=sv` for Swedish messages (the tool also follows a Swedish system locale).

Behind the messages sits one exit code per kind of problem, so an assistant using the command line knows what to do without reading English: 2 not logged in, 3 not configured, 4 SchoolSoft unreachable, 5 not available in this setup, 6 bad input, 7 SchoolSoft answered with an error, 1 a bug in the tool.

## "Not configured: no school is set"

The tool does not know which school you belong to. Run, in a terminal:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

Replace the name with your school's. It lists matches; pick yours. Claude Desktop users set the school when installing the extension instead.

## "Not logged in to SchoolSoft"

There is no saved session, or it has expired for good. If a session dies in the middle of a conversation, the tool first re-establishes it silently and repeats the request; you only see this message when that did not help. Ask the assistant to log in, or run:

```bash
npx -y schoolsoft-agent login
```

A browser tab opens SchoolSoft's login page. Complete BankID there. The command waits up to five minutes and then confirms. You do this rarely: the session is refreshed silently for as long as SchoolSoft allows.

## The login takes long and my assistant gives up

Some assistants stop waiting for a command after a minute or three; BankID can legitimately take longer. Ask the assistant to start the login in the background (`login --background`, or the login tool with `background: true`): it returns at once with the login URL while the login finishes on its own. Complete BankID, then ask again; the assistant checks `auth-status`, which shows whether a login is still running, finished, or failed and why.

## "A login is already in progress"

A login window is already open from an earlier attempt. Complete BankID there. If that window is gone, wait a few minutes (the marker expires) or run `login` again after `logout`.

## "Could not reach SchoolSoft"

Your computer could not connect: no internet, a VPN or proxy in the way, or SchoolSoft is down. Check the connection and try again in a moment. `doctor` shows whether `sms.schoolsoft.se` answers from your machine.

## "SchoolSoft answered HTTP 5xx"

SchoolSoft had a problem serving the request. This is usually temporary; try again in a moment.

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

## "…which need the headless browser"

Contact lists, bookings, shared files and the gated pages below are read from SchoolSoft's web pages through a hidden browser on your computer. Install it once:

```bash
npx -y schoolsoft-agent browser install
```

It downloads Chromium (about 150 MB). Everything else works without it.

## "…needs the web login session"

Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are only shown by SchoolSoft to a "real" web login, not to the kind of session apps use. Do the second login once:

```bash
npx -y schoolsoft-agent login --web
```

A visible browser window opens SchoolSoft's login. Complete BankID as usual (it may continue in a second tab; that is fine). The window closes when you land on the start page.

## "…the web login session has expired (inactivity)"

SchoolSoft logs web sessions out after a period without activity. Run `login --web` again; your normal session is unaffected.

## "No child with id …"

The assistant used a child id that does not exist for your account. It should call `list-children` first; the message lists the known ids and first names.

## "No subject matching …"

The subject name did not match any of your child's subjects. The message lists the ones that exist; `get-subject-rooms` shows them too. Partial names work ("matte" finds "Matematik").

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
