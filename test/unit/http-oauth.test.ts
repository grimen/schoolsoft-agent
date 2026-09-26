import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { Response } from "express";
import { ConnectorOAuthProvider, approvedRedirect, type OAuthState } from "../../src/http/oauth.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
const resource = new URL("https://parent.example/mcp");
const callback = "https://claude.ai/api/mcp/auth_callback";
const scopes = ["list_children", "get_schedule", "get_lunch_menu"];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
let fixtureId = 0;
function setup(initial?: OAuthState, defaults = false) {
  const fixture = ++fixtureId;
  let clock = 1_000_000;
  let sequence = 0;
  let saved: OAuthState | undefined = initial;
  const repository = {
    read: () => saved,
    write: (value: OAuthState) => {
      saved = value;
    },
  };
  const provider = new ConnectorOAuthProvider({
    resourceUrl: resource.href,
    scopes,
    repository,
    ...(defaults ? {} : { now: () => clock, randomToken: () => `opaque-${fixture}-${++sequence}` }),
  });
  return {
    provider,
    repository,
    state: () => structuredClone(saved!),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
async function client(p: ConnectorOAuthProvider, name: string | undefined = "Claude") {
  return await p.clientsStore.registerClient!({
    redirect_uris: [callback],
    client_name: name,
    token_endpoint_auth_method: "none",
  });
}
async function consent(
  p: ConnectorOAuthProvider,
  c: OAuthClientInformationFull,
  custom: Record<string, unknown> = {},
) {
  let location = "";
  await p.authorize(
    c,
    {
      redirectUri: callback,
      resource,
      codeChallenge: "a".repeat(43),
      state: "original-state",
      ...custom,
    },
    {
      redirect: (value: string) => {
        location = value;
      },
    } as Response,
  );
  return new URL(location, resource).searchParams.get("request")!;
}
async function connected(s = setup()) {
  const c = await client(s.provider);
  const id = await consent(s.provider, c);
  const redirect = new URL(s.provider.approve(id, undefined, [1, 2, 1]));
  const code = redirect.searchParams.get("code")!;
  const tokens = await s.provider.exchangeAuthorizationCode(c, code, undefined, callback, resource);
  return { ...s, c, tokens, code };
}
test("callback allowlist rejects hostile origins, path variants and URL components", () => {
  for (const value of [
    callback,
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector/oauth/abc_123-DEF",
  ])
    assert.equal(approvedRedirect(value), true);
  for (const value of [
    "invalid",
    "http://claude.ai/api/mcp/auth_callback",
    "https://x@claude.ai/api/mcp/auth_callback",
    "https://x:y@claude.ai/api/mcp/auth_callback",
    `${callback}:123`,
    "https://claude.ai:123/api/mcp/auth_callback",
    `${callback}?evil=1`,
    `${callback}#evil`,
    "https://claude.ai.evil/api/mcp/auth_callback",
    "https://chatgpt.com/connector/oauth/",
    "https://chatgpt.com/connector/oauth/a/b",
    "https://evil.example/callback",
    "https://claude.ai/other",
  ])
    assert.equal(approvedRedirect(value), false, value);
});
test("client registration is bounded, copies data and never fetches callback URLs", async () => {
  const s = setup();
  const c = await client(s.provider);
  assert.deepEqual(await s.provider.clientsStore.getClient(c.client_id), c);
  assert.equal(await s.provider.clientsStore.getClient("toString"), undefined);
  c.redirect_uris.push("https://evil.example");
  assert.equal((await s.provider.clientsStore.getClient(c.client_id))!.redirect_uris.length, 1);
  for (const redirect_uris of [[], ["https://evil.example"]])
    assert.throws(() => s.provider.clientsStore.registerClient!({ redirect_uris }));
  const state = s.state();
  for (let i = 0; i < 256; i++) state.clients[`client-${i}`] = c;
  assert.throws(() => clientRegistration(setup(state).provider));
  function clientRegistration(p: ConnectorOAuthProvider) {
    p.clientsStore.registerClient!({ redirect_uris: [callback] });
  }
});
test("authorization binds scope, callback, resource and PKCE before creating consent", async () => {
  const s = setup();
  const c = await client(s.provider);
  delete c.client_name;
  for (const custom of [
    { resource: undefined },
    { resource: new URL("https://evil.example") },
    { redirectUri: "https://evil.example" },
    { codeChallenge: "bad" },
    { scopes: [] },
    { scopes: ["write"] },
  ])
    await assert.rejects(consent(s.provider, c, custom));
  await assert.rejects(
    consent(
      s.provider,
      { ...c, redirect_uris: ["https://evil.example"] },
      { redirectUri: "https://evil.example" },
    ),
  );
  const id = await consent(s.provider, c, {
    scopes: ["get_schedule", "get_schedule"],
    state: undefined,
  });
  const pending = s.provider.pending(id);
  assert.equal(pending.clientName, "AI connector");
  assert.deepEqual(pending.scopes, ["get_schedule"]);
  pending.scopes.push("write");
  assert.deepEqual(s.provider.pending(id).scopes, ["get_schedule"]);
  assert.throws(() => s.provider.pending("toString"));
  assert.throws(() => s.provider.approve(id));
  assert.throws(() => s.provider.approve(id, undefined, [0]));
  assert.throws(() => s.provider.approve(id, undefined, [1.5]));
  assert.throws(() => s.provider.approve(id, ["get_lunch_menu"], [1]));
  const denied = new URL(s.provider.deny(id));
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.has("state"), false);
  assert.throws(() => s.provider.deny(id));
  const expired = await consent(s.provider, c);
  s.advance(600_000);
  assert.throws(() => s.provider.pending(expired));
  const limited = s.state();
  const p = limited.pending[expired];
  p.expiresAt += 600_000;
  for (let i = 0; i < 128; i++) limited.pending[`pending-${i}`] = p;
  await assert.rejects(consent(setup(limited).provider, c));
});
test("codes are one-use, short-lived, PKCE/client/callback/resource bound and stored hashed", async () => {
  const s = setup();
  const c = await client(s.provider);
  const other = await client(s.provider);
  const id = await consent(s.provider, c);
  const url = new URL(s.provider.approve(id, ["get_schedule"], [1]));
  const code = url.searchParams.get("code")!;
  assert.equal(url.searchParams.get("state"), "original-state");
  assert.equal(await s.provider.challengeForAuthorizationCode(c, code), "a".repeat(43));
  await assert.rejects(s.provider.challengeForAuthorizationCode(other, code));
  await assert.rejects(s.provider.challengeForAuthorizationCode(c, "unknown"));
  await assert.rejects(
    s.provider.exchangeAuthorizationCode(c, code, undefined, "https://evil.example", resource),
  );
  await assert.rejects(s.provider.exchangeAuthorizationCode(c, code, undefined, callback));
  const tokens = await s.provider.exchangeAuthorizationCode(c, code, undefined, callback, resource);
  assert.equal(tokens.scope, "get_schedule");
  assert.equal(JSON.stringify(s.state()).includes(tokens.access_token), false);
  assert.equal(JSON.stringify(s.state()).includes(tokens.refresh_token!), false);
  await assert.rejects(
    s.provider.exchangeAuthorizationCode(c, code, undefined, callback, resource),
  );
  const info = await s.provider.verifyAccessToken(tokens.access_token);
  assert.equal(info.clientId, c.client_id);
  assert.equal(info.resource!.href, resource.href);
  info.scopes.push("write");
  assert.deepEqual((await s.provider.verifyAccessToken(tokens.access_token)).scopes, [
    "get_schedule",
  ]);
  const nextId = await consent(s.provider, c);
  const nextCode = new URL(s.provider.approve(nextId, undefined, [1])).searchParams.get("code")!;
  s.advance(60_000);
  await assert.rejects(s.provider.challengeForAuthorizationCode(c, nextCode));
  s.advance(240_000);
  await assert.rejects(s.provider.verifyAccessToken(tokens.access_token));
});
test("refresh rotates tokens, narrows scope, rejects cross-client replay and revokes the family", async () => {
  const s = await connected();
  const p = s.provider;
  const other = await client(p);
  await assert.rejects(p.exchangeRefreshToken(other, s.tokens.refresh_token!, undefined, resource));
  await assert.rejects(p.exchangeRefreshToken(s.c, s.tokens.access_token, undefined, resource));
  await assert.rejects(p.exchangeRefreshToken(s.c, "unknown", undefined, resource));
  await assert.rejects(p.exchangeRefreshToken(s.c, s.tokens.refresh_token!));
  await assert.rejects(p.exchangeRefreshToken(s.c, s.tokens.refresh_token!, ["write"], resource));
  await assert.rejects(p.verifyAccessToken(s.tokens.refresh_token!));
  await assert.rejects(p.verifyAccessToken("unknown"));
  const rotated = await p.exchangeRefreshToken(
    s.c,
    s.tokens.refresh_token!,
    ["get_schedule"],
    resource,
  );
  assert.notEqual(rotated.refresh_token, s.tokens.refresh_token);
  await assert.rejects(
    p.exchangeRefreshToken(s.c, rotated.refresh_token!, ["get_lunch_menu"], resource),
  );
  const twice = await p.exchangeRefreshToken(s.c, rotated.refresh_token!, undefined, resource);
  assert.equal(twice.scope, "get_schedule");
  await assert.rejects(p.exchangeRefreshToken(s.c, s.tokens.refresh_token!, undefined, resource));
  await assert.rejects(p.verifyAccessToken(twice.access_token));
  await assert.rejects(p.exchangeRefreshToken(s.c, twice.refresh_token!, undefined, resource));
  assert.deepEqual(p.listGrants(), []);
});
test("revocation is client-specific, durable across restart and clears pending approvals on revoke all", async () => {
  const s = await connected();
  const second = await connected(setup(s.state()));
  const p = second.provider;
  const grants = p.listGrants();
  assert.equal(grants.length, 2);
  assert.deepEqual(grants[0].childIds, [1, 2]);
  grants[0].childIds.push(3);
  assert.deepEqual(p.verifyGrant(grants[0].id).childIds, [1, 2]);
  await p.revokeToken(second.c, { token: s.tokens.access_token });
  await p.verifyAccessToken(s.tokens.access_token);
  await p.revokeToken(second.c, { token: "missing" });
  p.revokeGrant("missing");
  await p.revokeToken(s.c, { token: s.tokens.access_token });
  await assert.rejects(p.verifyAccessToken(s.tokens.access_token));
  await p.verifyAccessToken(second.tokens.access_token);
  assert.throws(() => p.verifyGrant("toString"));
  await consent(p, second.c);
  p.revokeAll();
  assert.deepEqual(second.state().pending, {});
  assert.deepEqual(second.state().codes, {});
  const restored = setup(second.state()).provider;
  await assert.rejects(restored.verifyAccessToken(second.tokens.access_token));
  assert.deepEqual(restored.listGrants(), []);
});
test("expiry and capacity prune bounded state without allowing expired grants", async () => {
  const s = await connected();
  const grant = s.provider.listGrants()[0];
  const id = await consent(s.provider, s.c);
  s.provider.approve(id, undefined, [1]);
  await consent(s.provider, s.c);
  s.advance(30 * 86_400_000);
  assert.throws(() => s.provider.verifyGrant(grant.id));
  await assert.rejects(
    s.provider.exchangeRefreshToken(s.c, s.tokens.refresh_token!, undefined, resource),
  );
  await client(s.provider);
  assert.deepEqual(s.state().tokens, {});
  assert.deepEqual(s.state().codes, {});
  assert.deepEqual(s.state().grants, {});
  const fresh = await connected();
  const state = fresh.state();
  const g = Object.values(state.grants)[0];
  for (let i = 0; i < 64; i++) state.grants[`grant-${i}`] = g;
  const full = setup(state);
  const pending = await consent(full.provider, fresh.c);
  assert.throws(() => full.provider.approve(pending, undefined, [1]));
  const tokens = fresh.state();
  const token = tokens.tokens[digest(fresh.tokens.access_token)];
  for (let i = 0; i < 8192; i++) tokens.tokens[`token-${i}`] = token;
  const capped = setup(tokens);
  await assert.rejects(
    capped.provider.exchangeRefreshToken(fresh.c, fresh.tokens.refresh_token!, undefined, resource),
  );
  const grantId = fresh.provider.listGrants()[0].id;
  assert.equal(capped.state().refresh[grantId].counter, 1);
  capped.advance(5 * 60_000);
  const retried = await capped.provider.exchangeRefreshToken(
    fresh.c,
    fresh.tokens.refresh_token!,
    undefined,
    resource,
  );
  await capped.provider.verifyAccessToken(retried.access_token);
  assert.equal(capped.state().refresh[grantId].counter, 2);
});
test("production defaults generate unpredictable tokens and retain no cleartext tokens", async () => {
  const s = await connected(setup(undefined, true));
  assert.equal(s.tokens.access_token.length, 43);
  assert.notEqual(s.tokens.access_token, s.tokens.refresh_token);
});

test("persisted grants cannot be retargeted to another resource", async () => {
  const s = await connected();
  const other = new ConnectorOAuthProvider({
    resourceUrl: "https://other.example/mcp",
    scopes,
    repository: s.repository,
    now: () => 1_000_000,
  });
  await assert.rejects(other.verifyAccessToken(s.tokens.access_token));
});

test("registration garbage collects old orphan clients while retaining live grants and pending consent", async () => {
  const s = await connected();
  const orphan = await client(s.provider);
  const pendingClient = await client(s.provider);
  const revokedClient = await client(s.provider);
  const revokeId = await consent(s.provider, revokedClient);
  s.provider.approve(revokeId, undefined, [1]);
  const revokedGrant = s.provider.listGrants().find((g) => g.clientId === revokedClient.client_id)!;
  s.provider.revokeGrant(revokedGrant.id);
  s.advance(86_400_000);
  await consent(s.provider, pendingClient);
  const persisted = s.state();
  delete persisted.clients[orphan.client_id].client_id_issued_at;
  const reloaded = setup(persisted);
  reloaded.advance(86_400_000);
  await client(reloaded.provider);
  assert.equal(await reloaded.provider.clientsStore.getClient(orphan.client_id), undefined);
  assert.equal(await reloaded.provider.clientsStore.getClient(revokedClient.client_id), undefined);
  assert.ok(await reloaded.provider.clientsStore.getClient(s.c.client_id));
  assert.ok(await reloaded.provider.clientsStore.getClient(pendingClient.client_id));
  await reloaded.provider.verifyAccessToken(
    (
      await reloaded.provider.exchangeRefreshToken(
        s.c,
        s.tokens.refresh_token!,
        undefined,
        resource,
      )
    ).access_token,
  );
});

test("two continuously used apps rotate for their entire lifetime with bounded state and old-token replay detection", async () => {
  const s = await connected();
  const second = await connected(s);
  let firstRefresh = s.tokens.refresh_token!;
  let secondRefresh = second.tokens.refresh_token!;
  for (let i = 0; i < 10799; i++) {
    s.advance(4 * 60_000);
    const one = await s.provider.exchangeRefreshToken(s.c, firstRefresh, undefined, resource);
    const two = await s.provider.exchangeRefreshToken(second.c, secondRefresh, undefined, resource);
    firstRefresh = one.refresh_token!;
    secondRefresh = two.refresh_token!;
  }
  assert.equal(Object.keys(s.state().refresh).length, 2);
  assert.ok(Object.keys(s.state().tokens).length <= 4);
  await assert.rejects(
    s.provider.exchangeRefreshToken(s.c, s.tokens.refresh_token!, undefined, resource),
  );
  await assert.rejects(s.provider.exchangeRefreshToken(s.c, firstRefresh, undefined, resource));
  await s.provider.exchangeRefreshToken(second.c, secondRefresh, undefined, resource);
});

test("failed persistence does not consume an authorization code or refresh token", async () => {
  const s = setup();
  const c = await client(s.provider);
  const id = await consent(s.provider, c);
  const code = new URL(s.provider.approve(id, undefined, [1])).searchParams.get("code")!;
  const write = s.repository.write;
  s.repository.write = () => {
    throw new Error("synthetic disk full");
  };
  await assert.rejects(
    s.provider.exchangeAuthorizationCode(c, code, undefined, callback, resource),
  );
  s.repository.write = write;
  const initial = await s.provider.exchangeAuthorizationCode(
    c,
    code,
    undefined,
    callback,
    resource,
  );
  s.repository.write = () => {
    throw new Error("synthetic disk full");
  };
  await assert.rejects(
    s.provider.exchangeRefreshToken(c, initial.refresh_token!, undefined, resource),
  );
  s.repository.write = write;
  await s.provider.exchangeRefreshToken(c, initial.refresh_token!, undefined, resource);
});

test("forged refresh tokens cannot revoke a grant and authenticated revocation frees capacity", async () => {
  const s = await connected();
  const refresh = s.tokens.refresh_token!;
  const [id, counter, signature] = refresh.split(".");
  for (const bad of [
    `${id}.01.${signature}`,
    `${id}.9007199254740992.${signature}`,
    `missing.${counter}.${signature}`,
    `${id}.${counter}.x`,
    `${id}.${counter}.${"a".repeat(43)}`,
  ])
    await assert.rejects(s.provider.exchangeRefreshToken(s.c, bad, undefined, resource));
  await s.provider.verifyAccessToken(s.tokens.access_token);
  const other = await client(s.provider);
  await s.provider.revokeToken(other, { token: refresh });
  await s.provider.verifyAccessToken(s.tokens.access_token);
  await s.provider.revokeToken(s.c, { token: refresh });
  assert.deepEqual(s.provider.listGrants(), []);
  assert.deepEqual(s.state().refresh, {});
  const fresh = await connected();
  const state = fresh.state();
  const grant = Object.values(state.grants)[0];
  for (let i = 0; i < 63; i++) state.grants[`grant-${i}`] = { ...grant, id: `grant-${i}` };
  const full = setup(state);
  const consentId = await consent(full.provider, fresh.c);
  assert.throws(() => full.provider.approve(consentId, undefined, [1]));
  full.provider.revokeGrant(grant.id);
  full.provider.approve(consentId, undefined, [1]);
  assert.equal(full.provider.listGrants().length, 64);
  const pending = await consent(full.provider, fresh.c); // Revocation also invalidates codes that have not been exchanged.
  full.provider.revokeGrant("grant-0");
  const code = new URL(full.provider.approve(pending, undefined, [1])).searchParams.get("code")!;
  full.provider.revokeGrant(full.state().codes[digest(code)].grantId);
  await assert.rejects(full.provider.challengeForAuthorizationCode(fresh.c, code));
});
