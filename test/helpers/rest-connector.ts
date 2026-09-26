/** The connector over real HTTP for REST tests: the real OAuth provider, the real runtime
 * and provider, and the fake portal from the connector smoke at the injected fetch seam.
 * Tokens come from the ordinary owner consent flow; nothing is minted behind its back.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import {
  MemoryPendingLoginStore,
  MemorySessionHistoryStore,
  MemorySessionStore,
  resolveConfig,
  type Lang,
  type RequestBudget,
} from "../../src/core/index.js";
import { CountingBudget } from "./budget.js";
import type { ConnectorConfig } from "../../src/http/config.js";
import { ConnectorOAuthProvider, type OAuthState } from "../../src/http/oauth.js";
import { CONNECTOR_OPERATIONS, ConnectorRuntime } from "../../src/http/runtime.js";
import { createConnectorApp } from "../../src/http/server.js";
import {
  FAKE_GUARDIAN,
  FAKE_UPSTREAM_CODE,
  fakeUpstream,
} from "../packaging/connector-smoke/fake-upstream.mjs";

export const origin = "https://connector.example";
export const resource = origin + "/mcp";
export const callback = "https://claude.ai/api/mcp/auth_callback";
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");
export const ALL = [...CONNECTOR_OPERATIONS];
export const [ALVA, BO] = FAKE_GUARDIAN.children.map((child) => child.studentId);
export const CSP =
  "default-src 'none'; form-action 'self' https://claude.ai https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'";

export interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: () => Record<string, unknown>;
}
type UpstreamReply = { status: number; data: unknown; headers: object; setCookies: string[] };

export async function fixture(
  t: TestContext,
  options: { lang?: Lang; proxyHops?: number; budget?: RequestBudget; now?: () => number } = {},
) {
  let clock = Date.now();
  const upstream = fakeUpstream();
  /** Runs before every upstream request; may answer instead of the fake portal. */
  let intercept: ((path: string) => Promise<UpstreamReply | undefined> | undefined) | undefined;
  const config: ConnectorConfig = {
    publicUrl: origin,
    adminPassword: "synthetic-admin-password-for-the-rest-test",
    storageKey: Buffer.alloc(32, 1),
    stateDir: "/unused",
    port: 3000,
    school: "synthetic-fixture",
    proxyHops: options.proxyHops ?? 1,
  };
  let state: OAuthState | undefined;
  const oauth = new ConnectorOAuthProvider({
    resourceUrl: resource,
    scopes: ALL,
    now: () => clock,
    repository: {
      read: () => state,
      write: (value) => {
        state = value;
      },
    },
  });
  let identity: string | undefined;
  const runtime = new ConnectorRuntime({
    config: resolveConfig([{ school: config.school }], { home: "/unused", platform: "linux" }),
    store: new MemorySessionStore(),
    identityStore: {
      read: () => identity,
      write: (value) => {
        identity = value;
      },
    },
    redirectUri: origin + "/schoolsoft/callback",
    deps: {
      pending: new MemoryPendingLoginStore(),
      history: new MemorySessionHistoryStore(),
      // The real budget where a test asks for it; elsewhere nothing throttles the many reads here.
      budget: options.budget ?? new CountingBudget(),
      fetchImpl: async (
        url: string,
        school: string,
        request?: { method?: string; headers?: Record<string, string> },
      ) => {
        const path = new URL(url).pathname.replace(/^\/[^/]+/, "");
        const replaced = await intercept?.(path);
        return replaced ?? upstream.fetchImpl(url, school, request);
      },
    },
  });
  const app = createConnectorApp({ config, oauth, runtime, lang: options.lang, now: options.now });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await runtime.close();
    server.close();
    server.closeAllConnections();
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        { method: init.method ?? "GET", headers: { Host: "connector.example", ...init.headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers))
              if (value !== undefined)
                headers.set(key, Array.isArray(value) ? value.join(", ") : value);
            const text = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode!, headers, text, json: () => JSON.parse(text) });
          });
        },
      );
      req.on("error", reject);
      req.end(init.body);
    });
  const form = (path: string, values: URLSearchParams, headers: Record<string, string> = {}) =>
    request(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, ...headers },
      body: values.toString(),
    });

  // The connector signs in to the (fake) portal; the parent's BankID step is simulated.
  const { url } = await runtime.beginLogin();
  const upstreamState = decodeURIComponent(/[?&#]state=([^&#]+)/.exec(url)![1]);
  assert.equal(runtime.callback(upstreamState, FAKE_UPSTREAM_CODE), true);
  for (let attempt = 0; !(await runtime.status()).authenticated; attempt++) {
    assert.ok(attempt < 50, "the fake sign-in did not complete");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const login = await form("/owner/login", new URLSearchParams({ password: config.adminPassword }));
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(
    (await request("/owner", { headers: { Cookie: cookie } })).text,
  )![1];

  /** An app connected through the ordinary consent flow; returns its access token. */
  async function connect(scopes: string[] = ALL, children: number[] = [ALVA]) {
    const registered = await request("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic UI",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    const clientId = registered.json().client_id as string;
    const authorized = await request(
      "/authorize?" +
        new URLSearchParams({
          client_id: clientId,
          response_type: "code",
          redirect_uri: callback,
          resource,
          code_challenge: challenge,
          code_challenge_method: "S256",
          scope: scopes.join(" "),
        }),
    );
    const id = new URL(authorized.headers.get("location")!, origin).searchParams.get("request")!;
    const approved = await form(
      "/owner/approve",
      new URLSearchParams([
        ["csrf", csrf],
        ["request", id],
        ...children.map((child) => ["children", String(child)]),
        ...scopes.map((scope) => ["scopes", scope]),
      ]),
      { Cookie: cookie },
    );
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const tokens = (
      await form(
        "/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: callback,
          resource,
        }),
      )
    ).json();
    const grantId = oauth.listGrants().find((grant) => grant.clientId === clientId)!.id;
    return {
      access: tokens.access_token as string,
      refresh: tokens.refresh_token as string,
      grantId,
      clientId,
    };
  }
  const api = (path: string, token: string, headers: Record<string, string> = {}) =>
    request("/api/v1" + path, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  return {
    config,
    oauth,
    runtime,
    upstream,
    request,
    connect,
    api,
    intercept: (fn: typeof intercept) => {
      intercept = fn;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

export function assertProblem(reply: Reply, status: number, name: string) {
  assert.equal(reply.status, status, reply.text);
  assert.match(reply.headers.get("content-type")!, /^application\/problem\+json/);
  const body = reply.json();
  assert.equal(body.type, "urn:schoolsoft-agent:problem:" + name);
  assert.equal(body.status, status);
  return body;
}
export const lessonReads = (calls: string[]) =>
  calls.filter((c) => c.includes("/lessons/week/")).length;
