/**
 * The provider's one transport (net.ts): every helper sends through the
 * budget it is given, reads the status and Retry-After of its own answer
 * shape, and keeps the budget's hints (signal, write) out of the request.
 * The live sender is exercised against a local stand-in; the redirect rules
 * (explicit per request, never for a write) against a fake sender.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { budgetedFetch, budgetedHead } from "../../src/providers/schoolsoft/net.js";
import { probePortal } from "../../src/core/index.js";
import { CountingBudget } from "../helpers/budget.js";

test("budgetedFetch: signal, write and redirect stay in net.ts, never upstream; Retry-After from a string, a list or nothing", async () => {
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
  await send(
    "https://x/taby/a",
    "taby",
    { method: "POST", signal, write: true, body: "{}", redirect: "manual" },
    "UA",
  );
  for (let i = 0; i < 3; i++) await send("https://x/taby/b", "taby", { redirect: "follow" }, "UA");
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

/** A local stand-in for the portal: records each request, answers what the route says. */
async function localPortal(
  t: { after: (fn: () => void) => void },
  answer: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const seen: { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      answer(req, res);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, seen };
}

test("the live sender: one request with the portal's headers; JSON, text and cookies back; a redirect is never followed by it", async (t) => {
  const portal = await localPortal(t, (req, res) => {
    if (req.url === "/taby/moved") {
      res.writeHead(302, {
        Location: "/taby/elsewhere",
        "Set-Cookie": ["JSESSIONID=J=1; Path=/; HttpOnly", "hash=H"],
        "Retry-After": "4",
      });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(req.url === "/taby/html" ? "<html>login</html>" : '{"ok":true}');
  });
  const budget = new CountingBudget();
  const send = budgetedFetch(budget);

  const json = await send(
    `${portal.base}/taby/json`,
    "taby",
    {
      method: "POST",
      headers: { Cookie: "JSESSIONID=synthetic", "Content-Type": "application/json" },
      body: '{"a":1}',
      redirect: "follow",
    },
    "SchoolSoftPlus-Mobile/1.0",
  );
  assert.equal(json.status, 200);
  assert.deepEqual(json.data, { ok: true });
  assert.deepEqual(json.setCookies, []);
  assert.equal(json.headers["content-type"], "application/json");
  const [first] = portal.seen;
  assert.equal(first.method, "POST");
  assert.equal(first.body, '{"a":1}');
  assert.equal(first.headers["user-agent"], "SchoolSoftPlus-Mobile/1.0");
  assert.equal(first.headers.referer, "https://sms.schoolsoft.se/taby/");
  assert.equal(first.headers.origin, "https://sms.schoolsoft.se");
  assert.equal(first.headers.cookie, "JSESSIONID=synthetic");

  const html = await send(`${portal.base}/taby/html`, "taby", { redirect: "follow" }, "UA");
  assert.equal(html.data, null, "an answer that is not JSON reads as null");
  assert.equal(portal.seen[1].method, "GET");
  const text = await send(
    `${portal.base}/taby/html`,
    "taby",
    { redirect: "follow", responseType: "text" },
    "UA",
  );
  assert.equal(text.data, "<html>login</html>");

  const moved = await send(`${portal.base}/taby/moved`, "taby", { redirect: "manual" }, "UA");
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.location, "/taby/elsewhere");
  assert.equal(moved.headers["set-cookie"], undefined, "cookies come as a list, not a header");
  assert.deepEqual(moved.setCookies, ["JSESSIONID=J=1; Path=/; HttpOnly", "hash=H"]);
  assert.equal(portal.seen.length, 4, "the manual redirect was not followed");
  assert.equal(budget.calls.length, 4);
  assert.equal(budget.answers[3].retryAfter, "4");
});

type Hop = { status: number; headers?: Record<string, string> };

/** budgetedFetch over a fake sender that answers the given hops in order and records each request. */
function hops(answers: Hop[]) {
  const budget = new CountingBudget();
  const sent: { url: string; options: Record<string, unknown> }[] = [];
  const send = budgetedFetch(budget, async (url: string, _school: string, options: object) => {
    sent.push({ url, options: { ...options } });
    return { data: null, setCookies: [], headers: {}, ...answers.shift() };
  });
  return { budget, sent, send };
}

const redirect = (status: number, location: string): Hop => ({ status, headers: { location } });

test("redirect follow: each hop is its own request through the budget, to the same origin only", async () => {
  const { budget, sent, send } = hops([
    redirect(302, "/taby/login"),
    redirect(301, "https://sms.schoolsoft.se/taby/Login.jsp"),
    { status: 200 },
  ]);
  const r = await send(
    "https://sms.schoolsoft.se/taby/rest-api/x",
    "taby",
    { headers: { Cookie: "c" }, redirect: "follow" },
    "UA",
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    sent.map((s) => s.url),
    [
      "https://sms.schoolsoft.se/taby/rest-api/x",
      "https://sms.schoolsoft.se/taby/login",
      "https://sms.schoolsoft.se/taby/Login.jsp",
    ],
  );
  assert.deepEqual(sent[2].options, { headers: { Cookie: "c" } }, "same request, next URL");
  assert.equal(budget.calls.length, 3, "one budget token per hop");

  const away = hops([redirect(302, "https://idp.example/login")]);
  const kept = await away.send(
    "https://sms.schoolsoft.se/taby/a",
    "taby",
    { headers: { token: "t" }, redirect: "follow" },
    "UA",
  );
  assert.equal(kept.status, 302, "a redirect to another host is handed back, never followed");
  assert.equal(away.sent.length, 1);
});

test("redirect follow: 303 and a POST's 301/302 become a GET without body; 307/308 repeat the request", async () => {
  const post = {
    method: "POST",
    headers: { Cookie: "c", "content-type": "application/json" },
    body: "{}",
    redirect: "follow" as const,
  };
  for (const status of [301, 302, 303]) {
    const { sent, send } = hops([redirect(status, "/taby/next"), { status: 200 }]);
    await send("https://sms.schoolsoft.se/taby/q", "taby", post, "UA");
    assert.deepEqual(sent[1].options, { method: "GET", headers: { Cookie: "c" } }, `${status}`);
  }
  for (const status of [307, 308]) {
    const { sent, send } = hops([redirect(status, "/taby/next"), { status: 200 }]);
    await send("https://sms.schoolsoft.se/taby/q", "taby", post, "UA");
    assert.deepEqual(
      sent[1].options,
      { method: "POST", headers: post.headers, body: "{}" },
      `${status}`,
    );
  }
  const put = hops([redirect(302, "/taby/next"), { status: 204 }]);
  await put.send(
    "https://sms.schoolsoft.se/taby/p",
    "taby",
    { method: "PUT", redirect: "follow" },
    "UA",
  );
  assert.deepEqual(put.sent[1].options, { method: "PUT" }, "only a POST turns into a GET on 302");
  const get = hops([redirect(303, "/taby/next"), { status: 200 }]);
  await get.send("https://sms.schoolsoft.se/taby/g", "taby", { redirect: "follow" }, "UA");
  assert.deepEqual(get.sent[1].options, { method: "GET" });
});

test("redirect follow stops after five hops and hands back the last redirect; a 3xx without a usable location is an answer", async () => {
  const loop = hops(Array.from({ length: 7 }, () => redirect(302, "/taby/again")));
  const r = await loop.send(
    "https://sms.schoolsoft.se/taby/a",
    "taby",
    { redirect: "follow" },
    "UA",
  );
  assert.equal(r.status, 302);
  assert.equal(loop.sent.length, 6, "the request and five hops");
  for (const answer of [
    { status: 302 },
    redirect(302, "http://[::1"),
    redirect(304, "/taby/b"),
    redirect(300, "/taby/b"),
  ]) {
    const one = hops([answer, { status: 200 }]);
    const got = await one.send(
      "https://sms.schoolsoft.se/taby/a",
      "taby",
      { redirect: "follow" },
      "UA",
    );
    assert.equal(got.status, answer.status);
    assert.equal(one.sent.length, 1);
  }
});

test("redirect manual hands back the 3xx; a write is never followed, whatever it is told", async () => {
  const manual = hops([redirect(302, "/taby/b"), { status: 200 }]);
  const r = await manual.send(
    "https://sms.schoolsoft.se/taby/a",
    "taby",
    { redirect: "manual" },
    "UA",
  );
  assert.equal(r.status, 302);
  assert.equal(manual.sent.length, 1);
  const write = hops([redirect(307, "/taby/b"), { status: 200 }]);
  const told = { method: "POST", body: "{}", write: true, redirect: "follow" } as unknown as {
    write: true;
    redirect: "manual";
  };
  const w = await write.send("https://sms.schoolsoft.se/taby/absence", "taby", told, "UA");
  assert.equal(w.status, 307);
  assert.equal(write.sent.length, 1, "the write reached the network once");
  assert.deepEqual(write.budget.calls, [{ signal: undefined, write: true }]);
});
