# Troubleshooting

Plain-language explanations of what you may see, what it means, and what to do. Every message below comes from the tool itself, always as two lines: the problem, then "Next: what to do". Your assistant will usually relay it and often fix it on its own. Set `SCHOOLSOFT_LANG=sv` for Swedish messages (the tool also follows a Swedish system locale).

Behind the messages sits one exit code per kind of problem, so an assistant using the command line knows what to do without reading English: 2 not logged in, 3 not configured, 4 SchoolSoft unreachable, 5 not available in this setup, 6 bad input, 7 SchoolSoft answered with an error, 1 a bug in the tool.

## "Not configured: no school is set"

The tool does not know which school you belong to. Run, in a terminal:

```bash
npx -y schoolsoft-agent configure --query "Rösjöskolan"
```

Replace the name with your school's. It lists matches; pick yours. Claude Desktop users set the school when installing the extension instead.

### Children in two schools or municipalities

One SchoolSoft login covers every child in one municipality, even in different schools there. A child in another municipality, or in an independent school with its own SchoolSoft address, needs a second login. Run `configure` for that school and log in: the tool keeps both logins and both schools' settings side by side, and neither replaces the other. It works with one school at a time: the one you configured last, or the one you name with `--school` (or `SCHOOLSOFT_SCHOOL`). Switching back is `configure` again, or `--school`, with no new BankID login while that school's login is still alive. Choosing the school from within the assistant is planned.

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

## "SchoolSoft is asking for fewer requests…" or "SchoolSoft has pushed back several times in a row…"

This means SchoolSoft is asking us to slow down. It either said so directly (too many requests), kept answering with errors, or did not answer at all. schoolsoft-agent then stops sending it anything for a while: first a few seconds, and after three such answers within two minutes, five minutes (longer if it keeps happening, at most an hour). The message says how long.

What to do: wait, then ask again. Asking again sooner does not reach SchoolSoft at all; the tool refuses on its own, so you cannot make it worse, but it will not work either. Logging in again does not help either: your login is fine and is kept. Nothing you asked to change was sent while it was paused; if you reported an absence just as SchoolSoft said "too many requests", check in SchoolSoft whether it arrived before trying again.

Why the tool does this: it uses SchoolSoft in a way SchoolSoft has not approved, and every person using it shares that. If SchoolSoft decided the tool was a nuisance and blocked it, it would stop working for everyone. So it keeps its own pace slow on purpose (by default at most 20 requests a minute, 10 at once after a pause, 2 at the same time), well above what a person needs, and backs off as soon as SchoolSoft complains.

`auth-status` in a running assistant shows `portal` (`ok`, `backing_off`, `paused` or `probing`) and `retryAt`, when it will try again. After the wait, the first thing you ask is sent as a test; if SchoolSoft answers normally everything is back to normal, and if not the pause starts again, longer. Background keepalive stays quiet the whole time and never does that test on its own. Each running copy of the tool (every assistant window, every command) keeps its own count.

The pace can be changed within limits, for example if a family dashboard needs more: `SCHOOLSOFT_REQUESTS_PER_MINUTE` (1 to 60, default 20), `SCHOOLSOFT_REQUEST_BURST` (1 to 20, default 10) and `SCHOOLSOFT_MAX_CONCURRENT_REQUESTS` (1 to 4, default 2), or the same names without the prefix in `config.json` (`requestsPerMinute`, `requestBurst`, `maxConcurrentRequests`). How long it pauses after SchoolSoft pushes back cannot be changed. SchoolSoft's real limits are not known; if you see these messages during normal use, please report it.

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

SchoolSoft logs web sessions out after a period without activity. Run `login --web` again; your normal session is unaffected. When the tool knows how long the login had gone unused, the message says so ("expired after about 40 minutes without use").

## I have to log in with BankID too often

There are two logins, and they age differently. The normal login renews itself quietly and should last for weeks. The second one (`login --web`, for grades, documents and attendance) is an ordinary web login, and SchoolSoft ends it after a while without activity. Nobody outside SchoolSoft knows the exact limits, so the tool keeps a small diary of timestamps: when you logged in, when the login was renewed or used, and when SchoolSoft ended it. It contains no school data, no names and no passwords. Ask your assistant for the login status, or run:

```bash
npx -y schoolsoft-agent auth-status --pretty
```

Look at `sessionHistory`. `losses` lists each ended login with its age (`ageMinutes`) and how long it had gone unused (`idleMinutes`); `longestGapSurvivedMinutes` is the longest pause a login is known to have survived. `doctor` shows a one-line version. After a few weeks these numbers tell you what SchoolSoft really allows.

Three things reduce logins without any setup: a renewed login is saved the instant SchoolSoft issues it; a lost internet connection or a SchoolSoft outage no longer throws the saved login away; and answers that rarely change (lunch menu, schedule, contact lists) are remembered for a short while, so fewer requests meet an expired login.

### Keeping the login alive in the background (optional, off by default)

If your assistant runs the MCP server (Claude Desktop, Claude Code, Codex and similar) or you host the connector, you can let the tool keep the login warm while that program is open. Set one of these where you set `SCHOOLSOFT_SCHOOL` (or as `"keepalive"` in `config.json`):

| Setting                    | What happens in the background                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `SCHOOLSOFT_KEEPALIVE=off` | Nothing. This is the default.                                                             |
| `SCHOOLSOFT_KEEPALIVE=app` | The normal login is renewed a few minutes before it would expire, about every 12 minutes. |
| `SCHOOLSOFT_KEEPALIVE=all` | Also: every 10 minutes one small request tells SchoolSoft the web login is still in use.  |

Optional extras: `SCHOOLSOFT_KEEPALIVE_WEB_MINUTES=15` changes the 10 minutes (5 to 120), and `SCHOOLSOFT_KEEPALIVE_QUIET_HOURS=22-6` sends nothing between 22:00 and 06:00 (your computer's clock). With quiet hours the web login will probably have ended by morning.

What to know before turning it on:

- It only works while the program is running and your computer is awake. It cannot beat a hard time limit on SchoolSoft's side, and whether it lengthens the web login at all is not yet measured; your `sessionHistory` will show it.
- It never logs in for you and never touches BankID. If SchoolSoft ends a login, the background work for that login stops until you log in again yourself.
- It reads one small piece of information the web page itself asks for on every page view. It never changes anything at SchoolSoft.
- If SchoolSoft is unreachable or struggling it waits longer between attempts (up to an hour), and while SchoolSoft is pushing back it sends nothing at all (see "SchoolSoft is asking for fewer requests" above).
- This project is independent. SchoolSoft AB has not approved or been asked about background requests. Turning this on means your computer contacts SchoolSoft when you are not asking for anything; leave it off if you are unsure. The command-line tool on its own never does this, because it only runs while a command runs.

### The assistant shows an older version of something I just changed

Some answers are remembered in the program's memory for a short time: the lunch menu, subject list and contact lists for up to 6 hours, shared files 1 hour, schedule and calendar 30 minutes, news, assignments and the activity log 10 minutes. Messages, bookings, grades, documents, absence and attendance are always read from SchoolSoft. Ask for "the latest" (the assistant passes `fresh: true`, on the command line `--fresh`), or set `SCHOOLSOFT_CACHE=off`. Nothing remembered this way is written to disk; it is gone when the program closes, when you log in or out, and when you switch child.

## "… was written by a newer version of schoolsoft-agent"

You have used a newer version of schoolsoft-agent on this computer, and now an older one is running. That happens when one assistant starts the latest version and another still uses a copy it saved earlier. The newer version stored your settings, login or login history in a form the older one does not understand, so the older one stops instead of guessing, and leaves the file exactly as it is.

Update, and the message goes away:

```bash
npx -y schoolsoft-agent@latest doctor
```

If you installed it with `npm install -g`, run `npm install -g schoolsoft-agent@latest`. For an assistant's extension or plugin, update or reinstall it there, then restart the assistant. Do not delete the file to make the message go away: the newest version reads it fine, and deleting your login means another BankID login. For a parent-hosted connector, update the connector to the latest version.

## "The setting … has the value …, but it must be …"

One of the settings above has a value the tool does not understand, for example `SCHOOLSOFT_KEEPALIVE=yes`. The message names the setting and the values it accepts.

## "No child with id …"

The assistant used a child id that does not exist for your account. It should call `list-children` first; the message lists the known ids and first names.

## "No subject matching …"

The subject name did not match any of your child's subjects. The message lists the ones that exist; `get-subject-rooms` shows them too. Partial names work ("matte" finds "Matematik").

## "npm ERR! 404 Not Found: schoolsoft-agent"

The package is not on npm yet; releases currently go to GitHub Packages, which needs a GitHub token to install from even though the package is public. Two ways around it.

**From GitHub Packages** (needs a [GitHub token](https://github.com/settings/tokens) with the `read:packages` scope):

```bash
echo "@grimen:registry=https://npm.pkg.github.com" >> ~/.npmrc
echo "//npm.pkg.github.com/:_authToken=<your token>" >> ~/.npmrc
npm install -g @grimen/schoolsoft-agent
schoolsoft-agent configure --query "<school name>"
```

The commands are still called `schoolsoft-agent` and `schoolsoft-agent-mcp`; only the package name carries the `@grimen/` prefix. In the host guides, replace `npx -y schoolsoft-agent` with the bare `schoolsoft-agent`, and `npx -y -p schoolsoft-agent schoolsoft-agent-mcp` with `schoolsoft-agent-mcp`.

**From the source**, no token needed:

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

Reports Node version, configuration, saved session, how long logins have lasted so far, the format version of each saved file, network reachability, the hidden browser and how the login window is opened. Each line says what to do if it is not OK. `doctor --fix` moves a session saved by an older version into place. `doctor --verify` is a different check: see [Check whether SchoolSoft changed something](#check-whether-schoolsoft-changed-something).

## "The school portal's answer for … has changed shape"

SchoolSoft answered, but not in the form this tool knows, so it returned nothing rather than show you something that might be wrong. It usually means SchoolSoft changed something on their side. Trying again will not help. Update schoolsoft-agent first, the same way as in the "written by a newer version" section above; a newer version may already understand the new form. If the newest version fails too, check which parts are affected, as described next.

## Check whether SchoolSoft changed something

When one thing stops working with the message above, you can check everything else in one go, using the login you already have:

```bash
npx -y schoolsoft-agent doctor --verify --pretty
```

It asks SchoolSoft once for each kind of information the tool understands in detail (children, schedule, calendar, lunch menu, messages), one after the other, the way you would by asking for them yourself, and reads each answer from SchoolSoft directly rather than from the short-lived memory. It shows only whether each answer still looks right: `ok`, `drift` (SchoolSoft changed its form), `skipped` (this setup cannot check it, for example without the hidden browser or the second login) or `error` (SchoolSoft or the connection failed; try again later). For `drift` it names which field changed, never what the field contained. The output has no names, messages, lessons or other school data, so it is safe to paste into an issue.

It checks the child that is selected by default and names children by their position in your list ("child 1 of 2"), never by name. Add `--all-children` to check every child; the selected child stays selected afterwards. It never logs in, never opens BankID and never changes anything at SchoolSoft. Without a saved login it stops with "Not logged in" before asking SchoolSoft anything.

The command ends with exit code 0 when nothing changed, 7 when something drifted, and otherwise the code of the first problem (4 for a connection failure, for example).

## Still stuck?

Open an issue at <https://github.com/grimen/schoolsoft-agent/issues>. Paste the output of `doctor` (it contains no personal data) and the exact message you saw. If a message said an answer "has changed shape", paste the output of `doctor --verify` as well.
