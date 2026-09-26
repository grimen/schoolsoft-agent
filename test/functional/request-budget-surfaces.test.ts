/**
 * When the school portal pushes back, every surface tells people the same
 * thing in their language and nothing is sent: the CLI exits 7 with the
 * message and "Next:" line, MCP returns an error result (kind upstream,
 * retryable). REST (503 + Retry-After) is in http-rest.test.ts. The portal
 * here is a real PortalBudget whose breaker three 503s have opened.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli, type CliDeps } from "../../src/cli/program.js";
import { EXIT } from "../../src/cli/exit-codes.js";
import { createMcpServer } from "../../src/mcp/server.js";
import type { Lang, Portal } from "../../src/core/index.js";
import { makeContext, fakePortal } from "../helpers/fakes.js";
import { FakeClock, fakeBudget } from "../helpers/budget.js";

/** A portal whose reads go through a budget the portal has pushed back on three times. */
async function pushedBack() {
  const clock = new FakeClock();
  const budget = fakeBudget(clock);
  for (const wait of [2_000, 4_000, 0]) {
    await budget.run(
      {},
      async () => ({ status: 503 }),
      (a) => a,
    );
    await clock.advance(wait);
  }
  let sent = 0;
  const read = <T>() =>
    budget.run(
      {},
      async () => {
        sent++;
        return { status: 200 } as T & { status: number };
      },
      (a) => a,
    );
  const portal: Portal = { ...fakePortal, getScheduleWeek: read, getNews: read };
  return { portal, sent: () => sent };
}

function cli(portal: Portal, env: Record<string, string> = {}) {
  const h = makeContext({ portal });
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    getContext: () => h.ctx,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    env,
    home: mkdtempSync(join(tmpdir(), "home-")),
    platform: "linux",
    version: "9.9.9",
    fetchImpl: async () => ({ status: 200 }),
  };
  return async (...argv: string[]) => {
    err.length = 0;
    const code = await runCli(argv, deps);
    return { code, err: err.join("\n") };
  };
}

test("CLI: exit 7 with the push-back message and what to do, in English and Swedish; nothing sent", async () => {
  const back = await pushedBack();
  const en = cli(back.portal);
  assert.equal((await en("login")).code, EXIT.OK);
  const r = await en("get-schedule");
  assert.equal(r.code, EXIT.UPSTREAM);
  assert.equal(r.code, 7);
  assert.match(
    r.err,
    /SchoolSoft has pushed back several times in a row .* for about 5 minutes\. Nothing was sent\./,
  );
  assert.match(r.err, /Next: Wait until then and run the command again/);
  const sv = cli(back.portal, { SCHOOLSOFT_LANG: "sv" });
  assert.equal((await sv("login")).code, EXIT.OK);
  const s = await sv("get-news");
  assert.equal(s.code, 7);
  assert.match(
    s.err,
    /SchoolSoft har sagt ifrån flera gånger i rad .* på ungefär 5 minuter\. Inget skickades\./,
  );
  assert.match(s.err, /Nästa steg: Vänta tills dess och kör kommandot igen/);
  assert.equal(back.sent(), 0);
});

async function mcp(portal: Portal, lang: Lang) {
  const h = makeContext({ portal });
  const server = createMcpServer({ getContext: () => h.ctx, version: "test", lang });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "budget-test", version: "1.0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  await client.callTool({ name: "schoolsoft_login", arguments: {} });
  return client;
}

const text = (res: unknown) => (res as { content: { text: string }[] }).content[0].text;

test("MCP: an error result naming the wait and telling the agent not to retry on its own, in English and Swedish", async () => {
  const back = await pushedBack();
  const en = await mcp(back.portal, "en");
  const news = await en.callTool({ name: "schoolsoft_get_news", arguments: {} });
  assert.equal(news.isError, true);
  assert.match(text(news), /^Error: SchoolSoft has pushed back several times in a row/);
  assert.match(
    text(news),
    /Next: Tell the user the school portal is pushing back.*Do not retry on your own/s,
  );
  assert.deepEqual(
    (news.structuredContent as { error: { kind: string; retryable: boolean } }).error.kind,
    "upstream",
  );
  assert.equal((news.structuredContent as { error: { retryable: boolean } }).error.retryable, true);
  const typed = await en.callTool({ name: "schoolsoft_get_schedule", arguments: {} });
  assert.equal(typed.isError, true);
  assert.match(text(typed), /pushed back several times/);
  await en.close();
  const sv = await mcp(back.portal, "sv");
  const svNews = await sv.callTool({ name: "schoolsoft_get_news", arguments: {} });
  assert.match(text(svNews), /^Error: SchoolSoft har sagt ifrån flera gånger i rad/);
  assert.match(text(svNews), /Försök inte igen på eget initiativ/);
  await sv.close();
  assert.equal(back.sent(), 0);
});
