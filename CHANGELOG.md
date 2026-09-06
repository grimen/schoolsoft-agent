# Changelog

## 0.2.0 — 2026-09-06

First release under the `schoolsoft-agent` name.

- One core, two surfaces: `schoolsoft-agent-mcp` (stdio MCP) and `schoolsoft-agent` (CLI) wrapped by an Agent Skills `SKILL.md`.
- Guardian support verified live: parent login route with the `vApp` client id, Eva API for profile/children/lunch/news/messages, webview REST for schedule/assignments, child-in-focus switching.
- Operation registry: MCP tools, CLI commands and reference docs derived from one definition per capability.
- `find_school` over SchoolSoft's public school directory; `configure` and `doctor` commands.
- Encrypted session store with silent refresh, retry-on-401, and token persistence even when a later login step fails.
- Plugin packaging for Claude Code (marketplace with two entries), Claude Desktop (mcpb), OpenCode, OpenClaw, Hermes, Pi.
- Test pyramid: unit, boundary (import rules, registry invariants, doc drift), functional (MCP and CLI), packaging, and a gated live E2E suite.
