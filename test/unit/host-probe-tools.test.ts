/**
 * The probe's tools against a real MCP client over an in-memory transport: what each
 * tool declares, answers and records, with and without the host's elicitation support.
 */
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
  ErrorCode,
  McpError,
  type ClientCapabilities,
  type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { memoryLog } from "../../src/http/probe/log.js";
import { ProbeConfirmations } from "../../src/http/probe/confirmations.js";
import {
  PROBE_TOOLS,
  PROBE_SCOPES,
  advertiseSecuritySchemes,
  UrlPages,
  createProbeServer,
  tapMessages,
} from "../../src/http/probe/tools.js";

type Answer = (params: Record<string, unknown>) => ElicitResult | Promise<ElicitResult>;

async function harness(
  t: TestContext,
  {
    surface = "stdio" as "stdio" | "http",
    capabilities = {} as ClientCapabilities,
    answer,
    scopes,
  }: {
    surface?: "stdio" | "http";
    capabilities?: ClientCapabilities;
    answer?: Answer;
    scopes?: string[];
  } = {},
) {
  let clock = Date.UTC(2026, 8, 26, 12);
  const log = memoryLog(surface, () => clock);
  const pages = new UrlPages(async () => "https://probe.example", { now: () => clock });
  const confirmations = new ProbeConfirmations({ now: () => clock });
  const server = createProbeServer({
    surface,
    log,
    session: "s1",
    confirmations,
    pages,
    now: () => clock,
    resourceMetadataUrl: "https://probe.example/.well-known/oauth-protected-resource/mcp",
  });
  const client = new Client({ name: "unit-host", version: "9.9" }, { capabilities });
  const completed: string[] = [];
  if (capabilities.elicitation) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      clock += 1500;
      return answer!(request.params as Record<string, unknown>);
    });
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, (n) => {
      completed.push(n.params.elicitationId);
    });
  }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  if (scopes) {
    // What the http transport hands the server from the bearer token.
    const send = clientSide.send.bind(clientSide);
    const authInfo = { token: "t", clientId: "c", scopes, extra: { grantId: "g1" } };
    clientSide.send = (message, options) => send(message, { ...options, authInfo });
  }
  await server.connect(serverSide);
  tapMessages(serverSide, log, "s1");
  if (surface === "http") advertiseSecuritySchemes(serverSide);
  await client.connect(clientSide);
  // Raw server messages, before the client's schemas strip fields it does not know.
  const raw: Record<string, unknown>[] = [];
  const deliver = clientSide.onmessage!;
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP transports take one onmessage callback.
  clientSide.onmessage = (message, extra) => {
    raw.push(message as Record<string, unknown>);
    deliver(message, extra);
  };
  t.after(() => client.close());
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  return {
    client,
    call,
    log,
    pages,
    completed,
    raw,
    tick: (ms: number) => {
      clock += ms;
    },
    events: (name: string) => log.events.filter((e) => e.event === name),
  };
}

const text = (result: unknown) => (result as { content: { text: string }[] }).content[0].text;
const structured = (result: unknown) =>
  (result as { structuredContent: Record<string, unknown> }).structuredContent;

test("every probe tool is prefixed, declared with its annotations, and step-up tools are http only", async (t) => {
  const stdio = await harness(t);
  const listed = (await stdio.client.listTools()).tools;
  assert.deepEqual(
    listed.map((tool) => tool.name),
    PROBE_TOOLS.filter((tool) => !tool.scope).map((tool) => tool.name),
  );
  for (const tool of listed) {
    assert.match(tool.name, /^probe_/);
    assert.match(tool.description ?? "", /probe/i);
    const declared = PROBE_TOOLS.find((candidate) => candidate.name === tool.name)!;
    assert.deepEqual(tool.annotations, { title: declared.title, ...declared.annotations });
  }
  const destructive = listed.find((tool) => tool.name === "probe_write_destructive")!;
  assert.deepEqual(destructive.annotations, {
    title: "Probe: destructive write (does nothing)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
  const http = await harness(t, { surface: "http" });
  const names = (await http.client.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(
    names,
    PROBE_TOOLS.map((tool) => tool.name),
  );
  assert.deepEqual(Object.values(PROBE_SCOPES), [
    "probe_read",
    "probe_step_up",
    "probe_step_up_meta",
    "probe_step_up_hidden",
  ]);
});

test("initialize records the host's name, version, protocol and raw declared capabilities", async (t) => {
  const h = await harness(t, {
    capabilities: { elicitation: { form: {}, url: {} }, roots: {} },
    answer: () => ({ action: "cancel" }),
  });
  const [init] = h.events("initialize");
  assert.match(String(init.protocolVersion), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(
    { ...init, at: undefined, protocolVersion: undefined },
    {
      at: undefined,
      protocolVersion: undefined,
      surface: "stdio",
      event: "initialize",
      session: "s1",
      client: "unit-host",
      clientVersion: "9.9",
      elicitationForm: true,
      elicitationUrl: true,
      elicitation: ["form", "url"],
      sampling: false,
      roots: true,
      declared: ["elicitation", "roots"],
    },
  );
  const rpc = h.events("rpc").map((e) => e.method);
  assert.deepEqual(rpc.slice(0, 2), ["initialize", "notifications/initialized"]);
});

test("a legacy elicitation: {} counts as form; missing client info is recorded as unknown", () => {
  const log = memoryLog("stdio");
  const transport = {} as { onmessage?: (message: unknown) => void };
  tapMessages(transport as never, log, "s3");
  transport.onmessage!({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { capabilities: { elicitation: {}, sampling: {} } },
  });
  transport.onmessage!({ jsonrpc: "2.0", id: 2, method: "initialize" });
  const [legacy, bare] = log.events.filter((e) => e.event === "initialize");
  assert.deepEqual(
    [
      legacy.elicitationForm,
      legacy.elicitationUrl,
      legacy.elicitation,
      legacy.sampling,
      legacy.client,
    ],
    [true, false, [], true, "unknown"],
  );
  assert.deepEqual([bare.elicitationForm, bare.elicitation, bare.declared], [false, null, []]);
});

test("annotation probes change nothing, say so, and log argument names only", async (t) => {
  const h = await harness(t);
  for (const name of [
    "probe_read",
    "probe_read_open_world",
    "probe_write_reversible",
    "probe_write_destructive",
  ]) {
    const result = await h.call(name);
    assert.equal(result.isError, undefined);
    assert.match(
      text(result),
      new RegExp(`^Probe: ${name} ran at 12:00:00 UTC and changed nothing`),
    );
  }
  await h.call("probe_read", {});
  const calls = h.events("tool_call");
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0], {
    at: calls[0].at,
    surface: "stdio",
    event: "tool_call",
    session: "s1",
    tool: "probe_read",
    args: [],
  });
});

test("form elicitation: unsupported hosts are told so; accept, decline, cancel and errors are recorded", async (t) => {
  const none = await harness(t);
  const unsupported = await none.call("probe_elicit_form");
  assert.match(text(unsupported), /did not declare form elicitation/);
  assert.deepEqual(
    none.events("elicitation").map((e) => e.outcome),
    ["unsupported"],
  );

  const answers: ElicitResult[] = [
    { action: "accept", content: { confirm: true } },
    { action: "accept", content: { confirm: false } },
    { action: "decline" },
    { action: "cancel" },
  ];
  const seen: Record<string, unknown>[] = [];
  const h = await harness(t, {
    capabilities: { elicitation: { form: {} } },
    answer: (params) => {
      seen.push(params);
      return answers.shift()!;
    },
  });
  const replies = [];
  for (let i = 0; i < 4; i++) replies.push(text(await h.call("probe_elicit_form")));
  assert.match(replies[0], /answered "accept" with "yes, send"/);
  assert.match(replies[1], /answered "accept" with "no"/);
  assert.match(replies[2], /answered "decline"/);
  assert.match(replies[3], /answered "cancel"/);
  assert.equal(seen[0].mode, "form");
  assert.match(String(seen[0].message), /Nothing has been sent/);
  assert.deepEqual(Object.keys((seen[0].requestedSchema as { properties: object }).properties), [
    "confirm",
  ]);
  const logged = h.events("elicitation");
  assert.deepEqual(
    logged.map((e) => [e.mode, e.outcome, e.confirmed, e.ms]),
    [
      ["form", "accept", true, 1500],
      ["form", "accept", false, 1500],
      ["form", "decline", false, 1500],
      ["form", "cancel", false, 1500],
    ],
  );
});

test("form elicitation: a host that fails the request is recorded with the error code", async (t) => {
  const h = await harness(t, {
    capabilities: { elicitation: { form: {} } },
    answer: () => {
      throw new McpError(ErrorCode.InvalidRequest, "no dialogs here");
    },
  });
  const result = await h.call("probe_elicit_form");
  assert.equal(result.isError, true);
  assert.match(text(result), /elicitation failed \(code -32600\)/);
  assert.deepEqual(
    h.events("elicitation").map((e) => [e.outcome, e.code]),
    [["error", "-32600"]],
  );
});

test("URL elicitation: unsupported, accepted with the probe's page, and completed by the page", async (t) => {
  const none = await harness(t, {
    capabilities: { elicitation: { form: {} } },
    answer: () => ({ action: "cancel" }),
  });
  assert.match(text(await none.call("probe_elicit_url")), /did not declare URL elicitation/);
  assert.match(
    text(await none.call("probe_elicit_url_required")),
    /did not declare URL elicitation/,
  );

  const seen: Record<string, unknown>[] = [];
  const h = await harness(t, {
    capabilities: { elicitation: { url: {} } },
    answer: (params) => {
      seen.push(params);
      return { action: "accept" };
    },
  });
  const result = await h.call("probe_elicit_url");
  assert.match(text(result), /answered "accept"/);
  assert.equal(seen[0].mode, "url");
  const url = String(seen[0].url);
  assert.match(url, /^https:\/\/probe\.example\/probe\/elicit\/[A-Za-z0-9_-]{43}$/);
  const id = url.split("/").pop()!;
  assert.equal(seen[0].elicitationId, id);
  assert.equal(h.pages.open(id)?.opened, true);
  assert.equal(await h.pages.complete(id), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.completed, [id]);
  assert.deepEqual(
    h.events("elicitation").map((e) => [e.mode, e.outcome]),
    [["url", "accept"]],
  );
});

test("URL elicitation by error: -32042 carries the page, and the retry after completion succeeds", async (t) => {
  const h = await harness(t, {
    capabilities: { elicitation: { url: {} } },
    answer: () => ({ action: "accept" }),
  });
  const first = await h.call("probe_elicit_url_required").catch((error: unknown) => error);
  assert.ok(first instanceof McpError);
  assert.equal(first.code, ErrorCode.UrlElicitationRequired);
  const [elicitation] = (first.data as { elicitations: { url: string; elicitationId: string }[] })
    .elicitations;
  assert.match(elicitation.url, /\/probe\/elicit\//);
  // Retried before the page was completed: a fresh page, the same error.
  const again = await h.call("probe_elicit_url_required").catch((error: unknown) => error);
  assert.ok(again instanceof McpError);
  const [second] = (again.data as { elicitations: { elicitationId: string }[] }).elicitations;
  assert.notEqual(second.elicitationId, elicitation.elicitationId);
  await h.pages.complete(second.elicitationId);
  h.tick(4000);
  const retried = await h.call("probe_elicit_url_required");
  assert.match(text(retried), /retried after the page was completed/);
  assert.deepEqual(
    h.events("url_required").map((e) => e.step),
    ["required", "retried_early", "required", "retried_after_completion"],
  );
});

test("the confirmed write mirrors #59: preview with a token, one send, replay, voided on change", async (t) => {
  const h = await harness(t);
  const args = { date: "2026-09-28", part: "morning" };
  const preview = await h.call("probe_confirmed_write", args);
  const shown = structured(preview);
  assert.equal(shown.status, "preview");
  assert.match(String(shown.confirmation), /^wct_/);
  assert.match(text(preview), /Nothing has been sent\./);
  assert.match(text(preview), /Probe Child/);
  assert.match(text(preview), /morning/);
  assert.match(text(preview), /only after the user says yes/);
  h.tick(12_000);
  const sent = await h.call("probe_confirmed_write", { ...args, confirmation: shown.confirmation });
  assert.equal(structured(sent).status, "sent");
  assert.match(text(sent), /pretend-sent once/);
  const replay = await h.call("probe_confirmed_write", {
    ...args,
    confirmation: shown.confirmation,
  });
  assert.equal(structured(replay).status, "replayed");
  const second = structured(await h.call("probe_confirmed_write", { date: "2026-09-29" }));
  const changed = await h.call("probe_confirmed_write", {
    date: "2026-09-30",
    confirmation: second.confirmation,
  });
  assert.equal(changed.isError, true);
  assert.equal(structured(changed).reason, "input_changed");
  assert.match(text(changed), /changed since the preview/);
  const unknown = await h.call("probe_confirmed_write", {
    date: "2026-09-30",
    confirmation: "wct_x",
  });
  assert.equal(structured(unknown).reason, "invalid");
  const writes = h.events("write");
  assert.deepEqual(
    writes.map((e) => [e.step, e.outcome ?? null, e.secondsSincePreview ?? null]),
    [
      ["preview", null, null],
      ["confirm", "sent", 12],
      ["confirm", "replayed", 12],
      ["preview", null, null],
      ["confirm", "input_changed", null],
      ["confirm", "invalid", null],
    ],
  );
  const calls = h.events("tool_call").map((e) => e.args);
  assert.deepEqual(calls[1], ["confirmation", "date", "part"]);
  const everything = JSON.stringify(h.log.events);
  for (const secret of [shown.confirmation, "2026-09-28", "morning"])
    assert.ok(!everything.includes(String(secret)), `${secret} must not be logged`);
});

test("expired confirmations are refused with their own reason", async (t) => {
  const h = await harness(t);
  const shown = structured(await h.call("probe_confirmed_write", { date: "2026-09-28" }));
  h.tick(600_000);
  const late = await h.call("probe_confirmed_write", {
    date: "2026-09-28",
    confirmation: shown.confirmation,
  });
  assert.equal(structured(late).reason, "expired");
  assert.match(text(late), /expired/);
});

test("step-up tools answer when the call carried their scope (the http layer challenges otherwise)", async (t) => {
  const h = await harness(t, {
    surface: "http",
    scopes: ["probe_read", "probe_step_up", "probe_step_up_meta", "probe_step_up_hidden"],
  });
  for (const name of ["probe_step_up", "probe_step_up_meta", "probe_step_up_hidden"]) {
    const result = await h.call(name);
    assert.equal(result.isError, undefined);
    assert.match(text(result), new RegExp(`carried the scope ${name}`));
  }
  assert.deepEqual(
    h.events("step_up").map((e) => [e.tool, e.outcome]),
    [
      ["probe_step_up", "passed"],
      ["probe_step_up_meta", "passed"],
      ["probe_step_up_hidden", "passed"],
    ],
  );
});

test("without its scope, the result-challenge tool answers ChatGPT's documented www_authenticate result", async (t) => {
  const h = await harness(t, { surface: "http", scopes: ["probe_read"] });
  const result = await h.call("probe_step_up_meta");
  assert.equal(result.isError, true);
  assert.deepEqual(result["_meta"], {
    "mcp/www_authenticate": [
      'Bearer resource_metadata="https://probe.example/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="probe_read probe_step_up_meta", error_description="The probe needs the probe_step_up_meta permission"',
    ],
  });
  assert.deepEqual(h.events("step_up")[0].granted, ["probe_read"]);
  // Stdio has no grant at all: the http-only tools are not even listed there.
  const none = await harness(t, { surface: "http" });
  const bare = await none.call("probe_step_up_meta");
  assert.match(String(bare["_meta"]?.["mcp/www_authenticate"]), /scope="probe_step_up_meta"/);
});

test("http tool lists carry ChatGPT's securitySchemes; the binding is the grant", async (t) => {
  const h = await harness(t, { surface: "http", scopes: ["probe_read"] });
  await h.client.listTools();
  const { tools } = h.raw.find((m) => (m.result as { tools?: unknown })?.tools)!.result as {
    tools: { name: string }[];
  };
  const schemes = Object.fromEntries(
    tools.map((tool) => [tool.name, (tool as { securitySchemes?: unknown }).securitySchemes]),
  );
  assert.deepEqual(schemes.probe_read, [{ type: "oauth2", scopes: ["probe_read"] }]);
  assert.deepEqual(schemes.probe_step_up_hidden, [
    { type: "oauth2", scopes: ["probe_read", "probe_step_up_hidden"] },
  ]);
  const shown = structured(await h.call("probe_confirmed_write", { date: "2026-09-28" }));
  assert.equal(
    structured(
      await h.call("probe_confirmed_write", {
        date: "2026-09-28",
        confirmation: shown.confirmation,
      }),
    ).status,
    "sent",
  );
});

test("a 2026-07-28 host's per-request capabilities are recorded by name", () => {
  const log = memoryLog("http");
  const transport = {} as { onmessage?: (message: unknown) => void };
  tapMessages(transport as never, log, "s2");
  transport.onmessage!({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { _meta: { "io.modelcontextprotocol/clientCapabilities": { elicitation: {} } } },
  });
  assert.deepEqual(log.events[0].metaCapabilities, ["elicitation"]);
});

test("URL pages expire, are bounded, and complete at most once", async () => {
  let clock = 0;
  let n = 0;
  const pages = new UrlPages(async () => "http://127.0.0.1:1", {
    now: () => clock,
    random: (size) => Buffer.alloc(size, ++n),
    max: 2,
  });
  const notified: string[] = [];
  const a = await pages.create("s", async () => void notified.push("a"));
  const b = await pages.create("s", async () => {
    throw new Error("session gone");
  });
  const c = await pages.create("s");
  assert.equal(pages.get(a.id), undefined, "oldest page makes room");
  assert.equal(await pages.complete(b.id), true, "a failed notification still completes");
  assert.equal(await pages.complete(b.id), false, "only once");
  assert.equal(await pages.complete("missing"), false);
  assert.equal(pages.open("missing"), undefined);
  assert.equal(await pages.complete(c.id), true);
  clock += 30 * 60_000;
  assert.equal(pages.get(c.id), undefined, "expired");
  assert.deepEqual(notified, []);
  const defaults = new UrlPages(async () => "https://x.example");
  const d = await defaults.create("s");
  assert.equal(defaults.get(d.id)?.session, "s");
});

test("tapping a transport without a handler still records messages", () => {
  const log = memoryLog("stdio");
  const transport = {} as { onmessage?: (message: unknown) => void };
  tapMessages(transport as never, log, "s9");
  transport.onmessage!({ jsonrpc: "2.0", id: 1, result: {} });
  transport.onmessage!({ jsonrpc: "2.0", method: "tools/list", id: 2 });
  assert.deepEqual(
    log.events.map((e) => e.method),
    ["response", "tools/list"],
  );
});
