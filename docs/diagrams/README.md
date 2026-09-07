<!-- GENERATED FILE - do not edit. Sources: src/*.mmd; run `make diagrams`. -->

# Diagrams

Pre-rendered SVGs for instant loading; click a diagram to open its editable
Mermaid source in [src/](src/) (which renders natively on GitHub, in VS Code,
and in Obsidian). Regenerate with `make diagrams`.

---

## System overview

[![System overview](dist/system-overview.svg)](src/system-overview.mmd)

One vendor-neutral core, two surfaces, many hosts. Everything SchoolSoft-specific sits
behind the SchoolProvider seam in src/providers/schoolsoft; the surfaces know how agents
talk; the hosts are somebody else's software.

---

## One definition per capability

[![One definition per capability](dist/operation-registry.svg)](src/operation-registry.mmd)

An operation is written once; the MCP tool, the CLI command and the reference
docs are derived from it, and a drift test fails when the docs go stale.

---

## Login, step by step

[![Login, step by step](dist/login-flow.svg)](src/login-flow.mmd)

Two logins, both BankID in the user's own browser. The app session (top) is what every
API call uses; SchoolSoft stamps the user type into the token from the OAuth client id
(`vApp` = guardian) and the cookie exchange binds it to one child. The web session
(bottom) exists only because SchoolSoft's GDPR gate refuses app sessions on grades,
documents, absence and criteria.

---

## Cold start, refresh and the one retry

[![Cold start, refresh and the one retry](dist/cold-start-refresh.svg)](src/cold-start-refresh.mmd)

The retry exists because the alternative is a BankID round for the user.

---

## Session states

[![Session states](dist/session-states.svg)](src/session-states.mmd)

Two independent lifecycles. The app session refreshes itself; the web session is
captured once and dies on SchoolSoft's inactivity timeout, so its errors name `login --web`.

---

## Portal adapter: API first, browser where no API exists

[![Portal adapter: API first, browser where no API exists](dist/portal-adapter.svg)](src/portal-adapter.mmd)

Dashed parts are optional: Playwright is an optional dependency, installed once with
`schoolsoft-agent browser install`; the engine behind it is Chromium or any CDP endpoint.
