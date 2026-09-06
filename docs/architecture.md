# Architecture

This document goes from the big picture down to the mechanics. If you only read one section, read [The shape of it](#the-shape-of-it).

## The shape of it

One core, two surfaces, many hosts. The core knows SchoolSoft; the surfaces know how agents talk; the hosts are somebody else's software.

```mermaid
flowchart LR
  subgraph hosts[Agent hosts]
    CC[Claude Code]
    CD[Claude Desktop]
    OC[OpenCode]
    OW[OpenClaw]
    HA[Hermes]
    PI[Pi]
  end
  subgraph pkg[npm package schoolsoft-agent]
    MCP[src/mcp<br/>stdio MCP server]
    CLI[src/cli<br/>commands, JSON out]
    SK[skills/schoolsoft<br/>SKILL.md + wrapper script]
    subgraph core[src/core]
      REG[operations registry]
      SES[session manager + encrypted store]
      AUTH[auth: OAuth/PKCE, browser flow, cookie exchange]
      API[api: guardian, school directory]
      CFG[config]
    end
  end
  subgraph ss[SchoolSoft]
    LOGIN[core/login + municipality SAML IdP]
    EVA[Eva API<br/>Bearer token]
    WEB[Webview REST<br/>session cookies]
  end
  CC & CD & OC & OW & HA -->|MCP over stdio| MCP
  CC & OC & OW & HA & PI -->|shell| SK --> CLI
  MCP --> REG
  CLI --> REG
  REG --> SES --> AUTH --> LOGIN
  REG --> API --> EVA & WEB
```

Three rules keep this honest, and a script enforces them (`make boundaries`):

1. `src/core` never imports from an adapter and never reads `process.env`. It receives a `Config` object.
2. Adapters (`src/mcp`, `src/cli`, `src/shared`) import core only through `src/core/index.ts`.
3. Adapters never import each other. Common adapter code lives in `src/shared`.

## One definition per capability

Every capability is an **operation**: a name, a description with "Use when:" guidance, a Zod input schema, safety annotations, and a `run` function that returns plain data.

```mermaid
flowchart TB
  OP["src/core/operations/get_schedule.ts<br/>name · description · input schema · annotations · run()"]
  REG[registry.ts<br/>ordered list of operations]
  OP --> REG
  REG -->|registerTool per op| MCP["MCP tool<br/>schoolsoft_get_schedule<br/>inputSchema = Zod shape<br/>readOnlyHint / destructiveHint"]
  REG -->|command per op| CLI["CLI command<br/>schoolsoft-agent get-schedule --week 37<br/>flags derived from the schema<br/>exit codes 0/1/2/3"]
  REG -->|make docs| DOCS["docs/reference/tools.md<br/>docs/reference/commands.md<br/>skills/schoolsoft/references/commands.md"]
  DOCS -.->|drift test fails if stale| REG
```

Adding an operation is one new file plus one line in the registry. The MCP tool, the CLI command and three reference documents appear without further work, and a boundary test refuses operations that lack annotations or a "Use when:" line.

## Login, step by step

SchoolSoft's guardian app uses OAuth 2 with PKCE. We use the same flow, with a local callback instead of the app's deep link. The one thing that took real effort to discover: SchoolSoft stamps the **user type** into the token from the OAuth **client id** (`vApp` = guardian app, `eApp` = student app), and resolves the actual user at request time. A guardian with a student-typed token fails every call with "Vi kunde inte hitta användaren".

```mermaid
sequenceDiagram
  autonumber
  participant A as Agent
  participant S as schoolsoft-agent
  participant B as User's browser
  participant L as SchoolSoft login (+ municipality IdP / BankID)
  participant E as Eva API
  participant W as Webview REST

  A->>S: login
  S->>S: start one-shot HTTP server on 127.0.0.1:43117
  S->>B: open https://sms.schoolsoft.se/<school>/react/#/login/parent?client_id=vApp&code_challenge=…&redirect_uri=http://127.0.0.1:43117/callback
  B->>L: user picks municipality login, completes BankID
  L-->>B: 302 http://127.0.0.1:43117/callback?code=…&state=…
  B->>S: GET /callback (state verified, page says "Inloggad")
  S->>L: POST /rest-api/login/token?clientId=vApp&grantType=code&codeVerifier=…
  L-->>S: access_token (JWT, user_type=PARENT, 15 min) + refresh_token
  S->>E: GET /eva/api/v1/parent (Bearer)
  E-->>S: userId, children[{studentId, schools[{orgId}]}]
  S->>W: GET /eva-apps/auth/login/parent  headers: token, userId, orgId, childInFocus
  W-->>S: Set-Cookie JSESSIONID, hash, usertype=2
  S->>S: persist tokens + cookies + guardian context (AES-256-GCM)
  S-->>A: { status: "logged_in", user: { name, schoolName, children } }
```

Two backends serve the data afterwards. The **Eva API** takes the Bearer token and serves profile, lunch, news and messages. The **webview REST** API takes the cookies, which are bound to one child (`childInFocus`), and serves schedule and assignments. Switching child means one more cookie exchange; the operations do that when `child_id` changes.

## Cold start, refresh and the one retry

Access tokens live 15 minutes. Every process start (an MCP server launching, a CLI command) goes through `ensureSession`:

```mermaid
sequenceDiagram
  autonumber
  participant O as Operation
  participant M as SessionManager
  participant St as Encrypted store
  participant Str as BankIdBrowserStrategy
  participant L as SchoolSoft token endpoint
  participant E as Eva API

  O->>M: ensureSession()
  M->>St: load()
  alt nothing saved / other school
    M-->>O: NotAuthenticatedError ("run login")
  else saved session
    M->>Str: restore(saved)
    alt token expired or expiry unknown
      Str->>L: grantType=refresh_token (clientId=vApp)
      L-->>Str: new access + rotated refresh
    end
    Str->>E: GET /eva/api/v1/parent
    alt 401
      Str->>L: refresh once more
      Str->>E: retry
    end
    Str->>Str: cookie exchange for remembered childInFocus
    M->>St: save(refreshed tokens, cookies, context)
    M->>M: verifySession() via cookies
    M-->>O: live client
  end
```

The retry exists because the alternative is a BankID round for the user. Refreshing when the expiry is _unknown_ protects sessions written by older versions.

## Session states

```mermaid
stateDiagram-v2
  [*] --> None
  None --> TokensOnly: login → code exchanged
  TokensOnly --> Established: profile + cookie exchange ok
  TokensOnly --> None: exchange fails and no refresh token
  Established --> Established: operation / child switch (re-exchange)
  Established --> Expired: access token > 15 min old
  Expired --> Established: restore → refresh ok
  Expired --> None: refresh rejected (refresh token dead)
  Established --> None: logout
  note right of TokensOnly
    Persisted even when a later step fails,
    so a bug in the exchange never costs
    the user another BankID.
  end note
```

## Repository layout

```
src/core/         auth/, api/, session/, operations/, config.ts, constants.ts, index.ts
src/mcp/          server.ts (registry → tools), respond.ts, index.ts (bin)
src/cli/          flags.ts, program.ts, exit-codes.ts, commands/{configure,doctor}.ts, index.ts (bin)
src/shared/       bootstrap.ts (env + config file → context), version.ts
src/http/         reserved for the remote transport (next spec)
skills/schoolsoft SKILL.md, scripts/schoolsoft.sh, references/commands.md (generated)
plugins/          claude/ (marketplace + two plugins), mcpb/, opencode/, openclaw/, hermes/, pi/
docs/             this file, schoolsoft-api.md, hosts/, reference/ (generated)
scripts/          check-boundaries, gen-docs, gen-skills, validate-plugins, e2e-login
test/             unit/, boundary/, functional/, packaging/, e2e/, helpers/
```

## Configuration

Precedence: CLI flags → `SCHOOLSOFT_*` environment → `config.json` → defaults.

| Key            | Env                        | Default                                  |
| -------------- | -------------------------- | ---------------------------------------- |
| `school`       | `SCHOOLSOFT_SCHOOL`        | required; `configure` finds it by name   |
| `orgId`        | `SCHOOLSOFT_ORGID`         | from the child's profile                 |
| `userType`     | `SCHOOLSOFT_USER_TYPE`     | `parent`                                 |
| `clientId`     | `SCHOOLSOFT_CLIENT_ID`     | `vApp` for parent, `eApp` otherwise      |
| `callbackPort` | `SCHOOLSOFT_CALLBACK_PORT` | `43117`                                  |
| `configDir`    | `SCHOOLSOFT_CONFIG_DIR`    | platform config dir (`doctor` prints it) |
| `stateDir`     | `SCHOOLSOFT_STATE_DIR`     | `<configDir>/state`                      |

## Testing

| Layer      | Where              | What it proves                                                                                                          | Network               |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Unit       | `test/unit`        | OAuth, cookie exchange, guardian API paths, school ranking, session manager, strategy sequence, config, flag derivation | none (injected fetch) |
| Boundary   | `test/boundary`    | import rules, registry invariants, generated docs equal committed, doc links and diagrams                               | none                  |
| Functional | `test/functional`  | real MCP client over in-memory transport; CLI program in-process; one spawn of the built bin                            | none                  |
| Packaging  | `test/packaging`   | every host manifest validates; skill follows the Agent Skills spec; per-host skill builds                               | none                  |
| E2E        | `test/e2e` (gated) | the real thing: BankID once, then silent restore, forced refresh, every operation over stdio and CLI, child switching   | SchoolSoft            |

`make check` runs everything but E2E with coverage thresholds. `make e2e` runs the live suite; findings accumulate in a gitignored report.

## What lives where at runtime

| Path                            | Contents                                    | Sensitivity   |
| ------------------------------- | ------------------------------------------- | ------------- |
| `<configDir>/config.json`       | school slug, orgId                          | low           |
| `<configDir>/schools.json`      | cached public school list                   | none          |
| `<stateDir>/key.bin` (0600)     | AES key                                     | secret        |
| `<stateDir>/session.enc` (0600) | tokens, cookies, children's names/ids/class | personal data |

`schoolsoft-agent logout` removes the session; deleting the state directory removes everything.
