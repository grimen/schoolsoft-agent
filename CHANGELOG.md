# Changelog

## [0.3.0](https://github.com/grimen/schoolsoft-agent/compare/v0.2.0...v0.3.0) (2026-09-06)


### Features

* **auth:** own OAuth/PKCE flow with configurable client id; log token claims ([b58c767](https://github.com/grimen/schoolsoft-agent/commit/b58c76739aeaf41793c25acd3b0c5955c416c302))
* **cli:** registry-driven commands, exit codes, configure, doctor ([ebc5176](https://github.com/grimen/schoolsoft-agent/commit/ebc517655f6d62b75037e5804205ddbccf3bfa50))
* **core:** browser provider for capabilities SchoolSoft only offers as web pages ([ffd9e65](https://github.com/grimen/schoolsoft-agent/commit/ffd9e65ab5aa36b34d2fd1a999ec5aeee9a41716))
* **core:** declared page contracts, structure verification, subject rooms via REST ([8a8dd96](https://github.com/grimen/schoolsoft-agent/commit/8a8dd968cfb0721a70b0a102052b8d208c237ea4))
* **core:** gated reads through the web-login session (GDPR gate) ([bf7956b](https://github.com/grimen/schoolsoft-agent/commit/bf7956b70f5293c3b35bbd27222be2c1815b7c0a))
* **core:** portal adapter — API first, headless browser where SchoolSoft has no API ([#3](https://github.com/grimen/schoolsoft-agent/issues/3)) ([3847afb](https://github.com/grimen/schoolsoft-agent/commit/3847afb851769eeda9c9e2150f8e72f99f37ef2d))
* **core:** user-facing error contract, silent recovery, background login ([#7](https://github.com/grimen/schoolsoft-agent/issues/7)) ([69aa6b2](https://github.com/grimen/schoolsoft-agent/commit/69aa6b29daa0f6d2770038fbf8b87c580d3c88e9))
* **core:** user-facing error contract, silent session recovery, background login, swedish messages ([1ec8a8d](https://github.com/grimen/schoolsoft-agent/commit/1ec8a8d96d2aab3374b2e6b77fc8e8d0cb481503))
* **core:** web login session for SchoolSoft's GDPR-gated pages ([143c924](https://github.com/grimen/schoolsoft-agent/commit/143c9247430fea59b3222e2cdb7513feb486efed))
* guardian data layer (Eva + webview REST), child-in-focus, messages tools ([b083d9d](https://github.com/grimen/schoolsoft-agent/commit/b083d9d0c6c046f27cac25c58daefe6a3958e432))
* **plugins:** marketplace, mcpb manifest, per-host skill metadata, validators ([2ba06f3](https://github.com/grimen/schoolsoft-agent/commit/2ba06f3f458467cdc7929c6d927add6c5de6b86b))
* **skill:** schoolsoft skill with generated command reference ([6805a59](https://github.com/grimen/schoolsoft-agent/commit/6805a5961d428523ae501bb1ad6dc1969845d07b))
* two-surface foundation — one core, MCP + CLI/skill, host plugins, docs, CI ([#1](https://github.com/grimen/schoolsoft-agent/issues/1)) ([66de77d](https://github.com/grimen/schoolsoft-agent/commit/66de77de864358ee3bdc16be1070da1f745d4034))


### Bug Fixes

* **auth:** persist JWT expiry, refresh on unknown expiry, retry once on 401 ([dfcdb97](https://github.com/grimen/schoolsoft-agent/commit/dfcdb97796d0e78cdc0acb44631a56c452de9354))
* **auth:** use the parent login route instead of ssp-node's hardcoded student route ([7820da1](https://github.com/grimen/schoolsoft-agent/commit/7820da18f128fe9482d327fea4a700289099cd07))
* **auth:** user-type-aware token→cookie exchange; keep tokens if exchange fails ([6b9442e](https://github.com/grimen/schoolsoft-agent/commit/6b9442eaeccb252eac94403a2678e909ae30e269))
* **core:** escape the callback error page in its new home (merge main) ([452cef2](https://github.com/grimen/schoolsoft-agent/commit/452cef2866cb8611da16ea8d45cfccd871fbc616))
* **core:** escape the identity provider's error text on the callback page ([0ad9e25](https://github.com/grimen/schoolsoft-agent/commit/0ad9e258d29e5581cdd029b3a0df88a73454830e))
* **core:** web login watches every tab, the IdP may continue in a popup ([e64d691](https://github.com/grimen/schoolsoft-agent/commit/e64d6916823d991e2ba0905d6fd2d4da5bc62caa))
* gitignore e2e-report.md (stray echo -e artifact) ([86d6023](https://github.com/grimen/schoolsoft-agent/commit/86d602360e2a3803fed78bf4ae47107289ac5306))

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
