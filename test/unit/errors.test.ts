/**
 * The error contract: every AgentError renders in both languages and for
 * both surfaces with the right exit code; unknown errors are bugs; the
 * network guard recognises transport failures and lets everything else
 * through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentError,
  NetworkError,
  UpstreamError,
  InputError,
  EXIT_CODE_BY_KIND,
  describeError,
  detectLang,
  guardNetwork,
  MESSAGES,
  HINTS,
  type MessageKey,
  type HintKey,
} from "../../src/core/errors/index.js";

test("every message key renders in both languages with its parameters; every hint has both surfaces in both languages", () => {
  const params = {
    reason: "r",
    detail: "d",
    status: "500",
    what: "w",
    page: "p",
    provider: "x",
    id: "1",
    known: "k",
    subject: "s",
    available: "a",
    minutes: "5",
    error: "e",
    port: "1",
    seconds: "2",
    userType: "parent",
    location: "L",
  };
  for (const key of Object.keys(MESSAGES) as MessageKey[]) {
    for (const lang of ["en", "sv"] as const) {
      for (const p of [params, Object.fromEntries(Object.keys(params).map((k) => [k, ""]))]) {
        const text = MESSAGES[key][lang](p);
        assert.ok(text.length > 10, `${key}.${lang}`);
        assert.doesNotMatch(text, /undefined/, `${key}.${lang} leaks an undefined parameter`);
      }
    }
  }
  for (const key of Object.keys(HINTS) as HintKey[]) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(HINTS[key][lang].cli.length > 5, `${key}.${lang}.cli`);
      assert.ok(HINTS[key][lang].mcp.length > 5, `${key}.${lang}.mcp`);
    }
  }
});

test("describeError: kind → exit code, message in the requested language, hint for the surface; optional params render empty", () => {
  const e = new AgentError({
    kind: "not_authenticated",
    key: "not_authenticated",
    params: { reason: "expired" },
    hint: "login",
  });
  const en = describeError(e, "en", "cli");
  assert.deepEqual(en, {
    kind: "not_authenticated",
    exitCode: 2,
    message: "Not logged in to SchoolSoft (expired).",
    hint: "Run: schoolsoft-agent login (opens your browser for BankID)",
    retryable: false,
  });
  const sv = describeError(e, "sv", "mcp");
  assert.equal(sv.message, "Inte inloggad på SchoolSoft (expired).");
  assert.match(sv.hint ?? "", /^Anropa schoolsoft_login/);
  const noHint = new AgentError({
    kind: "not_available",
    key: "capability_not_supported",
    params: { what: "x", provider: "p" },
  });
  assert.equal(describeError(noHint, "en", "cli").hint, undefined);
  const optional = new AgentError({
    kind: "not_configured",
    key: "not_configured",
    params: { reason: undefined },
  });
  assert.equal(optional.message, "Not configured: no school is set.");
  assert.equal(
    new AgentError({ kind: "internal", key: "internal", params: { detail: 5 } }).message,
    "Unexpected error: 5",
  );
  const withCause = new AgentError({
    kind: "internal",
    key: "internal",
    params: { detail: "x" },
    cause: "root",
  });
  assert.equal((withCause as { cause?: unknown }).cause, "root");
  assert.equal(
    new AgentError({ kind: "network", key: "network", params: { detail: "d" } }).name,
    "AgentError",
  );
});

test("describeError: anything that is not an AgentError is a bug (exit 1, report hint)", () => {
  for (const thrown of [new Error("boom"), "text", undefined, 42]) {
    const d = describeError(thrown, "en", "cli");
    assert.equal(d.kind, "internal");
    assert.equal(d.exitCode, 1);
    assert.match(d.message, /^Unexpected error: /);
    assert.match(d.hint ?? "", /bug/);
    assert.equal(d.retryable, false);
  }
  assert.deepEqual(Object.values(EXIT_CODE_BY_KIND).sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test("UpstreamError: 401/403 mark the session rejected (not_authenticated, login hint); 5xx is retryable upstream; 404 is not", () => {
  const rejected = new UpstreamError(401, "/x");
  assert.equal(rejected.kind, "not_authenticated");
  assert.equal(rejected.sessionRejected, true);
  assert.equal(rejected.hint, "login");
  const outage = new UpstreamError(503, "/x");
  assert.equal(outage.kind, "upstream");
  assert.equal(outage.retryable, true);
  assert.match(outage.message, /HTTP 503 for \/x/);
  assert.equal(new UpstreamError(404, "/x").retryable, false);
  assert.equal(new InputError("bad").kind, "input");
  assert.equal(new NetworkError("ENOTFOUND").retryable, true);
});

test("guardNetwork: DNS/TCP/TLS/timeout failures become NetworkError; AgentErrors and other errors pass through; success passes", async () => {
  const codes = [
    "ENOTFOUND",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
    "CERT_HAS_EXPIRED",
  ];
  for (const code of codes) {
    await assert.rejects(
      guardNetwork(async () => {
        throw Object.assign(new Error("request failed"), { code });
      }),
      (e: unknown) => e instanceof NetworkError && e.message.includes(code),
      code,
    );
  }
  // undici style: TypeError("fetch failed") with a cause carrying the code
  await assert.rejects(
    guardNetwork(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNRESET", message: "socket hang up" },
      });
    }),
    (e: unknown) => e instanceof NetworkError && e.message.includes("ECONNRESET"),
  );
  await assert.rejects(
    guardNetwork(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }),
    (e: unknown) => e instanceof NetworkError && e.message.includes("AbortError"),
  );
  await assert.rejects(
    guardNetwork(async () => {
      throw new Error("network is unreachable");
    }),
    (e: unknown) => e instanceof NetworkError && e.message.includes("(network is unreachable)"),
    "without a code the message is the detail",
  );
  const up = new UpstreamError(500, "/x");
  await assert.rejects(
    guardNetwork(async () => {
      throw up;
    }),
    (e: unknown) => e === up,
  );
  await assert.rejects(
    guardNetwork(async () => {
      throw new Error("a plain bug");
    }),
    /a plain bug/,
  );
  await assert.rejects(
    guardNetwork(async () => {
      throw "not even an error";
    }),
    (e: unknown) => e === "not even an error",
  );
  assert.equal(await guardNetwork(async () => 7), 7);
});

test("detectLang: SCHOOLSOFT_LANG wins, then a Swedish locale, else English", () => {
  assert.equal(detectLang({}), "en");
  assert.equal(detectLang({ LANG: "sv_SE.UTF-8" }), "sv");
  assert.equal(detectLang({ LC_ALL: "sv_SE" }), "sv");
  assert.equal(detectLang({ LC_MESSAGES: "sv" }), "sv");
  assert.equal(detectLang({ LANG: "en_US.UTF-8" }), "en");
  assert.equal(detectLang({ LANG: "sv_SE", SCHOOLSOFT_LANG: "en" }), "en");
  assert.equal(detectLang({ SCHOOLSOFT_LANG: "SV" }), "sv");
  assert.equal(
    detectLang({ SCHOOLSOFT_LANG: "de", LANG: "de_DE" }),
    "en",
    "unsupported explicit value falls back to the locale rule",
  );
});
