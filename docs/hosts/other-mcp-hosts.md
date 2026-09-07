# Any MCP host

Any assistant that can start a local MCP server over stdio can use this project. The server is `schoolsoft-agent-mcp`, shipped in the `schoolsoft-agent` npm package.

## Starting from scratch

First install your chosen assistant from its official guide, connect its model account and confirm a normal chat works. Install [Node.js](https://nodejs.org/en/download) 22 or newer. The assistant must support starting a **local stdio process** and that process must have a browser/login path and durable state. An interface asking only for an HTTPS URL cannot use this command directly. See the [support matrix](support-matrix.md) for named hosts.

## Configuration

Command and arguments:

```
npx -y -p schoolsoft-agent schoolsoft-agent-mcp
```

Environment (either set this, or run `npx -y schoolsoft-agent configure --query "<school name>"` once so the server reads the saved config):

```
SCHOOLSOFT_SCHOOL=<slug>
```

Many hosts use the common JSON shape:

```json
{
  "mcpServers": {
    "schoolsoft": {
      "command": "npx",
      "args": ["-y", "-p", "schoolsoft-agent", "schoolsoft-agent-mcp"],
      "env": { "SCHOOLSOFT_SCHOOL": "taby" }
    }
  }
}
```

The server exposes one tool per capability, all prefixed `schoolsoft_`; see the [tool reference](../reference/tools.md). Every tool carries `readOnlyHint` annotations; none writes anything to SchoolSoft.

## First use

Ask the assistant to call `schoolsoft_login`. A browser tab opens SchoolSoft's login; complete BankID there. If the host cannot open a browser, the tool result contains the URL to open yourself on the same machine as the callback listener. Opening it on another device does not move the local callback there. Hosts that time out long tool calls should call `schoolsoft_login` with `background: true`: it returns at once with the URL, and `schoolsoft_auth_status` reports `loginInProgress` until the login is done.

Every error the server returns has two lines, the problem and "Next: what to do", plus a structured `error.kind` (`not_authenticated`, `not_configured`, `network`, `not_available`, `input`, `upstream`, `internal`) and `retryable` flag, so an agent can act without parsing prose.

## Optional extras and problems

Same as for every host: [Get started](README.md#4-optional-extras-only-if-you-want-them) and [Troubleshooting](../troubleshooting.md).

## Environment variables

| Variable                    | Meaning                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `SCHOOLSOFT_SCHOOL`         | School slug (from `https://sms.schoolsoft.se/<slug>/…`)      |
| `SCHOOLSOFT_ORGID`          | Organisation id, only if your school needs it explicitly     |
| `SCHOOLSOFT_CONFIG_DIR`     | Where config and caches live                                 |
| `SCHOOLSOFT_STATE_DIR`      | Where the encrypted session lives                            |
| `SCHOOLSOFT_BROWSER_ENGINE` | `chromium` (default) or `cdp` for an external browser engine |
| `SCHOOLSOFT_BROWSER_CDP`    | The CDP endpoint when the engine is `cdp`                    |
| `SCHOOLSOFT_LANG`           | `en` or `sv` for messages; defaults from the system locale   |

`npx -y schoolsoft-agent doctor` shows the effective values and where files are.
