# Drop `@elias4044/ssp-node` (E6.3)

Part of #29, story E6.3. Status: built offline.

## Problem

`@elias4044/ssp-node` is a student client. This project used five things from it, none of
its student API:

| Used                             | Where                                     | For                                              |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| `schoolsoftFetch` (`rawRequest`) | `net.ts`, the live default of the budget  | every request to the portal except the two below |
| `ssUrl`                          | transport, OAuth, cookie exchange         | `https://sms.schoolsoft.se/<slug><path>`         |
| `extractCookie`                  | cookie exchange                           | a cookie's value from `Set-Cookie`               |
| `makePkcePair`, `makeState`      | OAuth                                     | PKCE S256 pair and the `state` value             |
| `SchoolsoftClient`               | session, BankID strategy, cookie exchange | an in-memory holder of tokens and cookies        |

Its HTTP helper decides redirects for the caller: it follows 301, 302, 307 and 308 by
sending the same method again (without the body), with the same `Cookie`, to any
host, and only one hop. That is why `postWrite` turns redirects off (the absence
spec, 2026-09-21), and why the write framework spec says E6.3 moves the redirect rule
into `net.ts`. The helper also sends nothing through a signal and pulls in
`node-html-parser`, which nothing here uses.

## Design

Written fresh from these needs; no code is copied from ssp-node.

- **One request, `sendToPortal` (`net.ts`)**: the global `fetch` with
  `redirect: "manual"`, so it never follows anything itself. It sends the caller's
  `User-Agent` (always given), `Referer: <origin>/<slug>/` and `Origin`, as before;
  answers `{ status, data, headers, setCookies }` with lower-case header names,
  `Set-Cookie` as a list (`getSetCookie()`), and `data` parsed as JSON (`null` when
  it is not JSON) or kept as text. The unused `buffer` answer type goes.
- **Redirects are explicit per request.** Every call through the budgeted helper says
  `redirect: "follow"` or `"manual"`; the type makes `write: true` imply `"manual"`,
  and `net.ts` never follows a write whatever it is told. `"manual"` hands the 3xx
  back with its `location`. `"follow"` follows WHATWG fetch's rules: 303 becomes a
  GET, 301 and 302 turn a POST into a GET, 307 and 308 repeat method and body; only
  to the same origin (a `Cookie` or `token` header never goes to another host; a
  redirect elsewhere is handed back), at most five hops, and **each hop is its own
  request through the budget**, so a redirect chain cannot run around the rate limit.
- **Who says what.** Reads (`get`, the legacy `postJson` read queries, the token
  endpoint) and the web session's child-focus `PUT` follow, as before: a dead
  web session is noticed because its redirect lands on the login page. The absence
  report (`postWrite`) and the cookie exchange say `"manual"`, as before. The write
  framework (E7.2) decides later whether a 301/302/303 after a form post means
  applied or rejected by sending its own GET; nothing here decides that for it.
- **Small helpers**: `portalUrl(slug, path)` next to `SCHOOLSOFT_ORIGIN`; the cookie
  value reader inside the cookie exchange; PKCE (`randomBytes(32)` as base64url,
  its SHA-256 as base64url) and `state` (12 random bytes as hex) inside `oauth.ts`,
  all on `node:crypto`.
- **`SessionTokens`** (`tokens.ts`) replaces `SchoolsoftClient` as the holder: slug,
  access and refresh token, expiry in Unix seconds, and the cookie header, `null`
  until the exchange sets it. `SchoolsoftSession.client` becomes `.tokens`. The
  persisted session keeps its shape.
- **Boundaries.** `fetch` stays allowed only in a provider's `net.ts`; the rules about
  ssp-node's helpers become one rule that refuses any import of the package.

## Behaviour changes

- A read that is redirected to another host now fails with the 3xx status instead
  of following it with the session cookie.
- A followed read spends one budget token per hop, not one for the whole chain.
- A read POST redirected by 301/302 is followed as a GET (ssp-node re-sent a POST
  without its body), and a chain is followed up to five hops (ssp-node stopped
  after one).
- `fetch` adds `accept-language`, `sec-fetch-mode` and `accept-encoding` (it
  decompresses the answer).

Nothing about writes changes: the absence report is still sent once and never
follows.

## Verification

Offline, before replacing anything: `sendToPortal` against a local HTTP server
(headers sent, JSON and text answers, cookies, no following), the redirect rules
through a fake sender and the counting budget, the PKCE pair against its definition,
the cookie reader, the token holder. `test/boundary` refuses an ssp-node import and
still shows that only `net.ts` calls `fetch`. `make e2e` (live) exercises the real
sender at the next live session.
