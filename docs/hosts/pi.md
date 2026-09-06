# Pi

Pi has no MCP support, so the skill is the only surface.

```bash
pi install git:github.com/grimen/schoolsoft-agent
```

The repository's `package.json` declares the skill under the `pi` key. Pi reads `.agents/skills/` and `~/.pi/agent/skills/` as well; from a checkout, `make install-pi` copies it to `~/.pi/agent/skills/schoolsoft`.

Install the CLI globally so the wrapper script does not fall back to `npx` on every call:

```bash
npm install -g schoolsoft-agent
schoolsoft-agent configure --query "<school name>"
schoolsoft-agent login
```

Pi runs shell commands without a default timeout; `login` blocks until BankID completes or five minutes pass.

## Optional: headless browser

Contact lists, subject rooms, bookings and shared files exist only as SchoolSoft web pages. Those operations need the optional headless browser: run `npx -y schoolsoft-agent browser install` once (downloads Chromium). Everything else works without it. Set `SCHOOLSOFT_BROWSER_ENGINE=cdp` and `SCHOOLSOFT_BROWSER_CDP=<endpoint>` to use an external engine instead. Grades, student documents, unreported absence, the attendance report, assessment criteria and Avstämning are behind SchoolSoft's "log in again" gate and additionally need one `npx -y schoolsoft-agent login --web` (the normal web login opens in a browser window; nothing is automated), after which they read through the same headless browser.
