<!-- GENERATED FILE - do not edit. Sources: src/*.mmd; run `make diagrams`. -->

# Diagrams

Pre-rendered SVGs for instant loading; click a diagram to open its editable
Mermaid source in [src/](src/) (which renders natively on GitHub, in VS Code,
and in Obsidian). Regenerate with `make diagrams`.

---

## System overview

[![System overview](dist/system-overview.svg)](src/system-overview.mmd)

One core, two surfaces, many hosts. The core knows SchoolSoft; the surfaces know
how agents talk; the hosts are somebody else's software.

---

## One definition per capability

[![One definition per capability](dist/operation-registry.svg)](src/operation-registry.mmd)

An operation is written once; the MCP tool, the CLI command and the reference
docs are derived from it, and a drift test fails when the docs go stale.

---

## Login, step by step

[![Login, step by step](dist/login-flow.svg)](src/login-flow.mmd)

SchoolSoft stamps the user type into the token from the OAuth client id
(`vApp` = guardian); the cookie exchange binds the webview session to one child.

---

## Cold start, refresh and the one retry

[![Cold start, refresh and the one retry](dist/cold-start-refresh.svg)](src/cold-start-refresh.mmd)

The retry exists because the alternative is a BankID round for the user.

---

## Session states

[![Session states](dist/session-states.svg)](src/session-states.mmd)
