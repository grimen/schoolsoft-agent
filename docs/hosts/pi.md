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
