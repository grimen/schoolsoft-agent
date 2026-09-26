# Changelog

## [0.3.0](https://github.com/grimen/schoolsoft-agent/compare/v0.2.0...v0.3.0) (2026-09-26)


### ⚠ BREAKING CHANGES

* **core:** the CLI JSON and MCP structured content of these five operations change from SchoolSoft's field names to the domain shapes (studentId -> id, startDate -> start with a Stockholm offset, menu -> days, entries -> events, isRead -> read, ...). Nothing is published yet.

### Features

* **auth:** own OAuth/PKCE flow with configurable client id; log token claims ([b58c767](https://github.com/grimen/schoolsoft-agent/commit/b58c76739aeaf41793c25acd3b0c5955c416c302))
* **cli:** add --format text views for people ([866cfb9](https://github.com/grimen/schoolsoft-agent/commit/866cfb912e4a2c02e7d2e7d47e7d9ff293c6e1d6))
* **cli:** add --format text views for the five typed operations ([bed7b95](https://github.com/grimen/schoolsoft-agent/commit/bed7b95da24030380feee41ba629c1513ab4a761))
* **cli:** add doctor --verify and --all-children, and make verify-live ([1dd65b9](https://github.com/grimen/schoolsoft-agent/commit/1dd65b910f60df719be1a76bc7a4a0b9445b84f1))
* **cli:** doctor --verify, a live parse check of the typed operations ([6bad4ff](https://github.com/grimen/schoolsoft-agent/commit/6bad4fffa37106d17af82c42c6b50ea9d73f0d5f))
* **cli:** registry-driven commands, exit codes, configure, doctor ([ebc5176](https://github.com/grimen/schoolsoft-agent/commit/ebc517655f6d62b75037e5804205ddbccf3bfa50))
* **core:** add an http hint surface and messages for connector refusals ([2ffeb2c](https://github.com/grimen/schoolsoft-agent/commit/2ffeb2c01e0e28ce5b528f4aad2faeac768c6802))
* **core:** add full calendar access for assistant integrations ([b12ba16](https://github.com/grimen/schoolsoft-agent/commit/b12ba1693f149f9987ed3a17223e5140a6088869))
* **core:** add report_absence behind allowWrites, preview by default ([af3282a](https://github.com/grimen/schoolsoft-agent/commit/af3282a8eb3eaf44b79ee4d2b101cb8d0157fad6))
* **core:** add report_absence behind allowWrites, preview by default ([85f6c9f](https://github.com/grimen/schoolsoft-agent/commit/85f6c9f86a44085d2a05a67093d812090ffeb49b))
* **core:** add the domain model and the response drift error ([6f5d679](https://github.com/grimen/schoolsoft-agent/commit/6f5d6797c383ac1b0ff5db70ce4cc98d64e4a1af))
* **core:** add the request budget: token bucket, in-flight cap, backoff and circuit breaker ([6ee833f](https://github.com/grimen/schoolsoft-agent/commit/6ee833f3b0ae0d17f9ad017f1058663f2032e9a5))
* **core:** browser provider for capabilities SchoolSoft only offers as web pages ([ffd9e65](https://github.com/grimen/schoolsoft-agent/commit/ffd9e65ab5aa36b34d2fd1a999ec5aeee9a41716))
* **core:** declared page contracts, structure verification, subject rooms via REST ([8a8dd96](https://github.com/grimen/schoolsoft-agent/commit/8a8dd968cfb0721a70b0a102052b8d208c237ea4))
* **core:** gated reads through the web-login session (GDPR gate) ([bf7956b](https://github.com/grimen/schoolsoft-agent/commit/bf7956b70f5293c3b35bbd27222be2c1815b7c0a))
* **core:** key saved sessions, history and settings by account ([034edcd](https://github.com/grimen/schoolsoft-agent/commit/034edcd1603f6842975df8b04b929cf9260644f9))
* **core:** key saved sessions, session history and settings by account ([134ff8c](https://github.com/grimen/schoolsoft-agent/commit/134ff8cb01352c5ae9ff27930f422dc3d21f38e5)), closes [#26](https://github.com/grimen/schoolsoft-agent/issues/26)
* **core:** one request budget and a circuit breaker towards the school portal ([e889657](https://github.com/grimen/schoolsoft-agent/commit/e88965709ee86f655e7e1b8529d835ca9687eab4))
* **core:** point the drift hint at doctor --verify ([a1c3e3a](https://github.com/grimen/schoolsoft-agent/commit/a1c3e3abd138da87e8fcf3c62371ab9fe39ae05f))
* **core:** portal adapter — API first, headless browser where SchoolSoft has no API ([#3](https://github.com/grimen/schoolsoft-agent/issues/3)) ([3847afb](https://github.com/grimen/schoolsoft-agent/commit/3847afb851769eeda9c9e2150f8e72f99f37ef2d))
* **core:** return validated domain objects from five operations ([c0c3713](https://github.com/grimen/schoolsoft-agent/commit/c0c371370771d474b1b0a1be9fee1c8e74721738))
* **core:** send every request to the portal through one budget per process ([c7ac340](https://github.com/grimen/schoolsoft-agent/commit/c7ac340fd59e44e2522e392fd01e66b4fabb4199))
* **core:** session history, read cache, durable refresh and opt-in keepalive ([d845357](https://github.com/grimen/schoolsoft-agent/commit/d845357ed65e721f611ca73b55133c1a5539fce2)), closes [#8](https://github.com/grimen/schoolsoft-agent/issues/8)
* **core:** session longevity, offline half (history, read cache, durable refresh, opt-in keepalive) ([0d8deec](https://github.com/grimen/schoolsoft-agent/commit/0d8deece879e40a2f1e51671aef2c8ae204b3d21))
* **core:** user-facing error contract, silent recovery, background login ([#7](https://github.com/grimen/schoolsoft-agent/issues/7)) ([69aa6b2](https://github.com/grimen/schoolsoft-agent/commit/69aa6b29daa0f6d2770038fbf8b87c580d3c88e9))
* **core:** user-facing error contract, silent session recovery, background login, swedish messages ([1ec8a8d](https://github.com/grimen/schoolsoft-agent/commit/1ec8a8d96d2aab3374b2e6b77fc8e8d0cb481503))
* **core:** verify every typed read operation against the live portal without keeping data ([afc0857](https://github.com/grimen/schoolsoft-agent/commit/afc08579d81d183b5339d621411b5d8e3a95a341))
* **core:** version config, session and history files and refuse newer ones ([fabac8c](https://github.com/grimen/schoolsoft-agent/commit/fabac8cc24b41c6093b1430158ffa9cb3c1d2ef4))
* **core:** versioned state and config files, refusing ones from a newer build ([b6f9686](https://github.com/grimen/schoolsoft-agent/commit/b6f96868e4cb2a1ce80b0f388bcc5cb2a04c01a6))
* **core:** web login session for SchoolSoft's GDPR-gated pages ([143c924](https://github.com/grimen/schoolsoft-agent/commit/143c9247430fea59b3222e2cdb7513feb486efed))
* guardian data layer (Eva + webview REST), child-in-focus, messages tools ([b083d9d](https://github.com/grimen/schoolsoft-agent/commit/b083d9d0c6c046f27cac25c58daefe6a3958e432))
* **http:** add parent-hosted connectors, calendars and setup guides ([5310830](https://github.com/grimen/schoolsoft-agent/commit/5310830554e41d13cdaeef46f8f73dcc65a9d473))
* **http:** add parent-hosted OAuth connectors ([73ad1ed](https://github.com/grimen/schoolsoft-agent/commit/73ad1edd42ef51541b7688729d1bfd8698aba506))
* **http:** generate read-only REST routes and the session endpoint from the registry ([4d4d0a6](https://github.com/grimen/schoolsoft-agent/commit/4d4d0a6d94996551fda681b739365a19b0ec1b71))
* **http:** generated REST read routes and a session endpoint for custom UIs ([6b68113](https://github.com/grimen/schoolsoft-agent/commit/6b681130d87afb9feb78e2b6e2365198953dfc57))
* **http:** mark runtime refusals with a reason and refuse ungranted children earlier ([a5df841](https://github.com/grimen/schoolsoft-agent/commit/a5df8416c2f6caf3c8876ac05099f2a7e58cc2f8))
* **http:** tell apps and the parent when the school portal pushes back ([3a8d02a](https://github.com/grimen/schoolsoft-agent/commit/3a8d02a5bd11173f8235ee1e8bcde6a115b3a6a1))
* **http:** version the connector's encrypted repositories inside the payload ([9c175cf](https://github.com/grimen/schoolsoft-agent/commit/9c175cf976cf854f6c288879465344ea858b31d5))
* **plugins:** marketplace, mcpb manifest, per-host skill metadata, validators ([2ba06f3](https://github.com/grimen/schoolsoft-agent/commit/2ba06f3f458467cdc7929c6d927add6c5de6b86b))
* **skill:** schoolsoft skill with generated command reference ([6805a59](https://github.com/grimen/schoolsoft-agent/commit/6805a5961d428523ae501bb1ad6dc1969845d07b))
* two-surface foundation — one core, MCP + CLI/skill, host plugins, docs, CI ([#1](https://github.com/grimen/schoolsoft-agent/issues/1)) ([66de77d](https://github.com/grimen/schoolsoft-agent/commit/66de77de864358ee3bdc16be1070da1f745d4034))


### Bug Fixes

* **auth:** persist JWT expiry, refresh on unknown expiry, retry once on 401 ([dfcdb97](https://github.com/grimen/schoolsoft-agent/commit/dfcdb97796d0e78cdc0acb44631a56c452de9354))
* **auth:** use the parent login route instead of ssp-node's hardcoded student route ([7820da1](https://github.com/grimen/schoolsoft-agent/commit/7820da18f128fe9482d327fea4a700289099cd07))
* **auth:** user-type-aware token→cookie exchange; keep tokens if exchange fails ([6b9442e](https://github.com/grimen/schoolsoft-agent/commit/6b9442eaeccb252eac94403a2678e909ae30e269))
* **ci:** do not fail the closed-PR hook when a run finished before it was cancelled ([9612423](https://github.com/grimen/schoolsoft-agent/commit/96124237c00a2054e4ae8a54f5c87a7c2d8deda0))
* **core:** escape the callback error page in its new home (merge main) ([452cef2](https://github.com/grimen/schoolsoft-agent/commit/452cef2866cb8611da16ea8d45cfccd871fbc616))
* **core:** escape the identity provider's error text on the callback page ([0ad9e25](https://github.com/grimen/schoolsoft-agent/commit/0ad9e258d29e5581cdd029b3a0df88a73454830e))
* **core:** web login watches every tab, the IdP may continue in a popup ([e64d691](https://github.com/grimen/schoolsoft-agent/commit/e64d6916823d991e2ba0905d6fd2d4da5bc62caa))
* gitignore e2e-report.md (stray echo -e artifact) ([86d6023](https://github.com/grimen/schoolsoft-agent/commit/86d602360e2a3803fed78bf4ae47107289ac5306))
* **http:** address authentication scan findings and CI drift ([0ee129a](https://github.com/grimen/schoolsoft-agent/commit/0ee129aac9b7239c6e3fa2697dcce6493959dfc1))
* **http:** compare the owner password in a fixed-size slot, without a hash ([2514e94](https://github.com/grimen/schoolsoft-agent/commit/2514e94f639fb46256a3f1c6dc41709dd4e4060d))
* **http:** compare the owner password in constant time regardless of length ([24b2317](https://github.com/grimen/schoolsoft-agent/commit/24b2317dd7c92c6863f08c1ae2f18caf2837cacb))
* **http:** harden the connector before live acceptance ([c2bc046](https://github.com/grimen/schoolsoft-agent/commit/c2bc04650e0fe1ea3b0e871ab01f46cd9bd536e4))
* **http:** rate limit the portal callback and warn about unsolicited consent links ([7938024](https://github.com/grimen/schoolsoft-agent/commit/7938024231392d3ef05d18a0fca3c94975d2dd74))
* **http:** revoke on authorization code replay and let anonymous caps make room ([e56cec2](https://github.com/grimen/schoolsoft-agent/commit/e56cec2ab3a572a6359a91b94bc2bf7040ba5505))
* **http:** trust no forwarding header by default and never refuse the owner ([230aff9](https://github.com/grimen/schoolsoft-agent/commit/230aff9537e89b1f7af922d83d5b79497ea0b754))

## [0.2.0](https://github.com/grimen/schoolsoft-agent/releases/tag/v0.2.0) (2026-09-06)

First release under the `schoolsoft-agent` name (backfilled in release-please's format; release-please maintains this file from here).

### Features

- One core, two surfaces: `schoolsoft-agent-mcp` (stdio MCP) and `schoolsoft-agent` (CLI) wrapped by an Agent Skills `SKILL.md`.
- Guardian support verified live: parent login route with the `vApp` client id, Eva API for profile/children/lunch/news/messages, webview REST for schedule/assignments, child-in-focus switching.
- Operation registry: MCP tools, CLI commands and reference docs derived from one definition per capability.
- `find_school` over SchoolSoft's public school directory; `configure` and `doctor` commands.
- Encrypted session store with silent refresh, retry-on-401, and token persistence even when a later login step fails.
- Plugin packaging for Claude Code (marketplace with two entries), Claude Desktop (mcpb), OpenCode, OpenClaw, Hermes, Pi.
- Test pyramid: unit, boundary (import rules, registry invariants, doc drift), functional (MCP and CLI), packaging, and a gated live E2E suite.
