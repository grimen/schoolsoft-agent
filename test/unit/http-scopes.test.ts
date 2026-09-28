/**
 * Detail scopes (docs/planning/specs/2026-09-28-other-families-data.md): offered only
 * with their operation, never granted without it, never gained by a refresh.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";
import { ConnectorOAuthProvider, type OAuthState } from "../../src/http/oauth.js";
import {
  DETAIL_SCOPES,
  detailScope,
  effectiveScopes,
  grantsContactDetails,
  offeredScopes,
} from "../../src/http/scopes.js";
import { CONNECTOR_OPERATIONS } from "../../src/http/runtime.js";
import { operations } from "../../src/core/index.js";

const resource = new URL("https://parent.example/mcp");
const callback = "https://claude.ai/api/mcp/auth_callback";

test("a detail scope is offered only with its operation; today's connector offers none", () => {
  assert.deepEqual(offeredScopes(CONNECTOR_OPERATIONS), [...CONNECTOR_OPERATIONS]);
  assert.deepEqual(offeredScopes(["get_schedule", "get_contacts"]), [
    "get_schedule",
    "get_contacts",
    "get_contacts_details",
  ]);
  for (const detail of DETAIL_SCOPES) {
    // Named after an operation that exists, and never an operation's own name.
    assert.equal(detail.scope, `${detail.operation}_details`);
    assert.ok(operations.some((op) => op.name === detail.operation));
    assert.ok(!operations.some((op) => op.name === detail.scope));
    assert.equal(detailScope(detail.scope), detail);
    assert.match(detail.warning, /AI provider/);
  }
  assert.equal(detailScope("get_contacts"), undefined);
});

test("a detail scope without its operation grants nothing", () => {
  assert.deepEqual(effectiveScopes(["get_schedule", "get_contacts_details"]), ["get_schedule"]);
  assert.deepEqual(effectiveScopes(["get_contacts_details", "get_contacts"]), [
    "get_contacts_details",
    "get_contacts",
  ]);
  assert.equal(grantsContactDetails(["get_contacts", "get_contacts_details"]), true);
  assert.equal(grantsContactDetails(["get_contacts_details"]), false);
  assert.equal(grantsContactDetails(["get_contacts"]), false);
});

function provider() {
  let saved: OAuthState | undefined;
  let sequence = 0;
  return new ConnectorOAuthProvider({
    resourceUrl: resource.href,
    scopes: offeredScopes(["get_schedule", "get_contacts"]),
    repository: {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    now: () => 1_000_000,
    randomToken: () => `opaque-${++sequence}`,
  });
}

async function pendingRequest(p: ConnectorOAuthProvider) {
  const client = await p.clientsStore.registerClient!({
    redirect_uris: [callback],
    client_name: "Claude",
    token_endpoint_auth_method: "none",
  });
  let location = "";
  await p.authorize(client, { redirectUri: callback, resource, codeChallenge: "a".repeat(43) }, {
    redirect: (value: string) => {
      location = value;
    },
  } as Response);
  return { client, id: new URL(location, resource).searchParams.get("request")! };
}

test("approval drops a detail scope without its operation, and refuses one on its own", async () => {
  const p = provider();
  const alone = await pendingRequest(p);
  assert.throws(() => p.approve(alone.id, ["get_contacts_details"], [1]), /Invalid scope/);
  const without = await pendingRequest(p);
  p.approve(without.id, ["get_schedule", "get_contacts_details"], [1]);
  const both = await pendingRequest(p);
  p.approve(both.id, ["get_contacts", "get_contacts_details"], [1]);
  assert.deepEqual(
    p.listGrants().map((grant) => grant.scopes),
    [["get_schedule"], ["get_contacts", "get_contacts_details"]],
  );
});

test("a refresh can never gain the detail scope", async () => {
  const p = provider();
  const { client, id } = await pendingRequest(p);
  const code = new URL(p.approve(id, ["get_contacts"], [1])).searchParams.get("code")!;
  const tokens = await p.exchangeAuthorizationCode(client, code, undefined, callback, resource);
  await assert.rejects(
    p.exchangeRefreshToken(
      client,
      tokens.refresh_token!,
      ["get_contacts", "get_contacts_details"],
      resource,
    ),
    /Invalid scope/,
  );
  const renewed = await p.exchangeRefreshToken(client, tokens.refresh_token!, undefined, resource);
  assert.equal(renewed.scope, "get_contacts");
  assert.equal(
    grantsContactDetails((await p.verifyAccessToken(renewed.access_token)).scopes),
    false,
  );
});
