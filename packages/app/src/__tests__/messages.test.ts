import { ConnectorError, type ErrorKind, type ProblemName } from "schoolsoft-agent/client";
import { deviceLanguage, explain, t } from "../messages";

// Exhaustive by type: a new kind or problem in the client fails `tsc` here until it is listed.
const KINDS: Record<ErrorKind, true> = {
  internal: true,
  not_authenticated: true,
  not_configured: true,
  network: true,
  not_available: true,
  input: true,
  upstream: true,
};
const PROBLEMS: Record<ProblemName, true> = {
  "invalid-input": true,
  "oauth-token": true,
  "scope-not-granted": true,
  "child-not-permitted": true,
  "foreign-origin": true,
  "not-found": true,
  "schoolsoft-session": true,
  "web-session": true,
  "rate-limited": true,
  internal: true,
  "not-implemented": true,
  "response-drift": true,
  upstream: true,
  "connector-busy": true,
  "portal-pushback": true,
  "not-available": true,
  network: true,
};

const err = (kind: ErrorKind, problem: ProblemName | null, body?: Record<string, unknown>) =>
  new ConnectorError({
    kind,
    retryable: false,
    status: 400,
    problem,
    message: "x",
    body: body as never,
  });

test("device language is Swedish only for a Swedish first locale", () => {
  expect(deviceLanguage([{ languageCode: "sv" }, { languageCode: "en" }])).toBe("sv");
  expect(deviceLanguage([{ languageCode: "en" }, { languageCode: "sv" }])).toBe("en");
  expect(deviceLanguage([{ languageCode: null }])).toBe("en");
  expect(deviceLanguage([])).toBe("en");
});

test("every kind and every problem has a message in both languages", () => {
  for (const lang of ["sv", "en"] as const) {
    for (const kind of Object.keys(KINDS) as ErrorKind[]) {
      const e = explain(err(kind, null), lang);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.next.length).toBeGreaterThan(0);
    }
    for (const problem of Object.keys(PROBLEMS) as ProblemName[]) {
      const e = explain(err("upstream", problem), lang);
      expect(e.title.length).toBeGreaterThan(0);
    }
  }
});

test("a spent or revoked grant asks to connect again", () => {
  expect(explain(err("not_authenticated", "oauth-token"), "en").action).toBe("reconnect");
  expect(explain(err("not_authenticated", null), "en").action).toBe("reconnect");
  expect(explain(err("input", "scope-not-granted"), "en").action).toBe("reconnect");
});

test("a SchoolSoft sign-in points to the dashboard it names", () => {
  const e = explain(
    err("not_authenticated", "schoolsoft-session", { ownerDashboard: "https://c.example/owner" }),
    "en",
  );
  expect(e).toMatchObject({ action: "dashboard", dashboard: "https://c.example/owner" });
});

test("push-back waits and carries retryAt", () => {
  const e = explain(err("upstream", "portal-pushback", { retryAt: "2026-09-26T12:00:00Z" }), "sv");
  expect(e).toMatchObject({ action: "wait", retryAt: "2026-09-26T12:00:00Z" });
  expect(explain(err("upstream", "rate-limited"), "en").action).toBe("wait");
  expect(explain(err("upstream", "connector-busy"), "en").action).toBe("wait");
});

test("anything that is not a ConnectorError is an unexpected error with retry", () => {
  expect(explain(new Error("boom"), "en")).toMatchObject({ action: "retry" });
  expect(explain("boom", "sv")).toMatchObject({ action: "retry" });
});

test("t returns the text in the chosen language", () => {
  expect(t("sv", "children")).toBe("Barn");
  expect(t("en", "children")).toBe("Children");
});
