/** The typed client against the real connector: real OAuth (rotation, reuse detection),
 * real routes and schemas, the fake portal at the fetch seam. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConnectorError, createClient, memoryTokenStore } from "../../src/client/index.js";
import { weekOf } from "../../src/core/index.js";
import { ALL, ALVA, BO, fixture, origin } from "../helpers/rest-connector.js";

const unexpected = (): never => assert.fail("expected a ConnectorError");
/** `fetch` for the client, carried over the fixture's HTTP request to the test server. */
function fetchVia(f: Awaited<ReturnType<typeof fixture>>, log: string[]) {
  return async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin, "the client only talks to the connector");
    log.push(`${init.method ?? "GET"} ${url.pathname}`);
    const reply = await f.request(url.pathname + url.search, {
      method: init.method,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body === undefined ? undefined : String(init.body),
    });
    return new Response(reply.status === 204 ? null : reply.text, {
      status: reply.status,
      headers: reply.headers,
    });
  };
}

test("every client call returns the connector's answer, validated and typed", async (t) => {
  const f = await fixture(t);
  const { access, refresh, clientId } = await f.connect(ALL, [ALVA, BO]);
  const log: string[] = [];
  const client = createClient({
    baseUrl: origin,
    clientId,
    tokens: memoryTokenStore({ accessToken: access, refreshToken: refresh }),
    fetch: fetchVia(f, log),
  });
  const session = await client.session();
  assert.equal(session.schoolsoft.signedIn, true);
  assert.deepEqual(
    session.children.map((child) => child.id),
    [ALVA, BO],
  );
  assert.equal((await client.children()).children.length, 2);
  const schedule = await client.schedule(BO, { week: weekOf().week, fresh: true });
  assert.equal(schedule.child.id, BO);
  assert.equal(schedule.startDate, weekOf().startDate);
  const calendar = await client.calendar(ALVA, {
    start_date: "2026-09-07",
    end_date: "2026-09-13",
  });
  assert.equal(calendar.timezone, "Europe/Stockholm");
  assert.equal((await client.lunchMenu(ALVA)).child.id, ALVA);
  const overview = await client.overview(ALVA);
  assert.equal(overview.child.id, ALVA);
  assert.equal(overview.schedule.status, "ok");
  if (overview.schedule.status === "ok") assert.equal(overview.schedule.data.child.id, ALVA);

  const refused = await client.schedule(999).then(unexpected, (e: unknown) => e as ConnectorError);
  assert.ok(refused instanceof ConnectorError);
  assert.deepEqual(
    [refused.status, refused.problem, refused.kind],
    [403, "child-not-permitted", "input"],
  );
  assert.ok(!log.includes("POST /token"), "no refresh while the token is good");
});

test("expired access tokens: parallel calls refresh once, and the grant survives", async (t) => {
  const f = await fixture(t);
  const { access, refresh, clientId } = await f.connect(ALL, [ALVA]);
  const log: string[] = [];
  const store = memoryTokenStore({ accessToken: access, refreshToken: refresh });
  const client = createClient({
    baseUrl: origin,
    clientId,
    tokens: store,
    fetch: fetchVia(f, log),
  });
  f.advance(6 * 60_000); // past the 5-minute access token
  const answers = await Promise.all([
    client.session(),
    client.children(),
    client.overview(ALVA),
    client.lunchMenu(ALVA),
    client.schedule(ALVA),
  ]);
  assert.equal(answers.length, 5);
  assert.equal(log.filter((line) => line === "POST /token").length, 1, log.join("\n"));
  assert.notEqual(store.current()!.accessToken, access);
  assert.notEqual(store.current()!.refreshToken, refresh);
  // Reuse detection did not fire: the connection still works, and refreshes again later.
  f.advance(6 * 60_000);
  assert.equal((await client.children()).children[0].id, ALVA);
  assert.equal(log.filter((line) => line === "POST /token").length, 2);

  // Revoked from the dashboard: the next refresh is refused and the client lets go.
  f.oauth.revokeGrant(f.oauth.listGrants()[0].id);
  const gone = await client.children().then(unexpected, (e: unknown) => e as ConnectorError);
  assert.deepEqual([gone.kind, gone.problem], ["not_authenticated", "oauth-token"]);
  assert.equal(store.current(), undefined);
});
