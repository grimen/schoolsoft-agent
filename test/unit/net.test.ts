/**
 * The provider's one transport (net.ts): every helper sends through the
 * budget it is given, reads the status and Retry-After of its own answer
 * shape, and keeps the budget's hints (signal, write) out of the request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetedFetch, budgetedHead } from "../../src/providers/schoolsoft/net.js";
import { probePortal } from "../../src/core/index.js";
import { CountingBudget } from "../helpers/budget.js";

test("budgetedFetch: signal and write go to the budget, never upstream; Retry-After from a string, a list or nothing", async () => {
  const budget = new CountingBudget();
  const seen: unknown[] = [];
  const answers = [
    { status: 200, data: 1, headers: {}, setCookies: [] },
    { status: 429, data: null, headers: { "retry-after": ["5", "9"] }, setCookies: [] },
    { status: 503, data: null, headers: { "retry-after": "7" }, setCookies: [] },
    { status: 200, data: 2 },
  ];
  const send = budgetedFetch(budget, async (_url: string, _school: string, options: unknown) => {
    seen.push(options);
    return answers.shift();
  });
  const signal = new AbortController().signal;
  await send("https://x/taby/a", "taby", { method: "POST", signal, write: true, body: "{}" });
  for (let i = 0; i < 3; i++) await send("https://x/taby/b", "taby", {});
  assert.deepEqual(seen[0], { method: "POST", body: "{}" });
  assert.deepEqual(budget.calls[0], { signal, write: true });
  assert.deepEqual(
    budget.answers.map((a) => a.retryAfter),
    [null, "5", "7", null],
  );
});

test("budgetedHead: the portal's front page through the budget, with the global fetch by default", async (t) => {
  const budget = new CountingBudget();
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: { method?: string }) => {
    urls.push(`${init.method} ${url}`);
    return new Response(null, { status: 204, headers: { "retry-after": "3" } });
  });
  assert.equal(await budgetedHead(budget), 204);
  assert.deepEqual(urls, ["HEAD https://sms.schoolsoft.se/"]);
  assert.deepEqual(budget.answers, [{ status: 204, retryAfter: "3" }]);
  assert.equal(
    await probePortal(
      { provider: "schoolsoft", requestBudget: {} },
      { fetchImpl: async () => ({ status: 200 }) },
    ),
    200,
    "without a budget of its own, doctor's probe gets a fresh one",
  );
});
