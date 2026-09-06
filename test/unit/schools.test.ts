import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSchoolList, SchoolDirectory } from "../../src/providers/schoolsoft/schools.js";
import { normalize, rankSchools } from "../../src/core/school-directory.js";

const RAW = [
  { name: "Täby kommun - Rösjöskolan", orgId: 20, evaUrl: "https://sms.schoolsoft.se/taby/eva" },
  {
    name: "Täby kommun - Skolhagenskolan",
    orgId: 18,
    evaUrl: "https://sms.schoolsoft.se/taby/eva",
  },
  {
    name: "Täby friskola - Enhagen",
    orgId: 1,
    evaUrl: "https://sms.schoolsoft.se/tabyfriskola/eva",
  },
  {
    name: "Nacka kommun - Björknässkolan",
    orgId: 7,
    evaUrl: "https://sms.schoolsoft.se/nacka/eva",
  },
  { name: "broken", orgId: "x", evaUrl: "nope" },
];

test("parseSchoolList extracts slug from the eva URL and drops malformed rows", () => {
  const list = parseSchoolList(RAW);
  assert.equal(list.length, 4);
  assert.deepEqual(list[0], { name: "Täby kommun - Rösjöskolan", slug: "taby", orgId: 20 });
  assert.equal(parseSchoolList({ schools: RAW }).length, 4, "wrapper object tolerated");
  assert.deepEqual(parseSchoolList("garbage"), []);
});

test("normalize strips diacritics and punctuation", () => {
  assert.equal(normalize("Rösjöskolan"), "rosjoskolan");
  assert.equal(normalize("Täby kommun - Rösjöskolan"), "taby kommun rosjoskolan");
});

test("rankSchools finds by partial, diacritic-insensitive query, best first", () => {
  const list = parseSchoolList(RAW);
  const r = rankSchools(list, "rosjo");
  assert.equal(r[0].name, "Täby kommun - Rösjöskolan");
  assert.equal(r[0].slug, "taby");
  assert.equal(r[0].orgId, 20);
  assert.equal(r.length, 1);
  const t = rankSchools(list, "täby");
  assert.equal(t.length, 3);
  assert.ok(t.every((x) => x.score >= 60));
  assert.deepEqual(rankSchools(list, ""), []);
  assert.equal(rankSchools(list, "kommun skolan", 2).length, 2);
});

test("SchoolDirectory caches, respects TTL, and falls back to stale cache on fetch failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "schools-"));
  const cacheFile = join(dir, "sub", "schools.json");
  let now = 1_000_000;
  let fetches = 0;
  let fail = false;
  const fetchImpl = async () => {
    fetches++;
    if (fail) throw new Error("offline");
    return RAW;
  };
  const d = new SchoolDirectory({ cacheFile, ttlMs: 1000, fetchImpl, now: () => now });
  assert.equal((await d.find("rosjo"))[0].orgId, 20);
  assert.equal(fetches, 1);
  assert.ok(existsSync(cacheFile));
  await d.list();
  assert.equal(fetches, 1, "served from cache within TTL");
  now += 2000;
  await d.list();
  assert.equal(fetches, 2, "refetched after TTL");
  now += 2000;
  fail = true;
  assert.equal((await d.list()).length, 4, "stale cache on failure");
  assert.equal(JSON.parse(readFileSync(cacheFile, "utf8")).schools.length, 4);
});

test("SchoolDirectory without cache propagates fetch errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "schools-"));
  const d = new SchoolDirectory({
    cacheFile: join(dir, "c.json"),
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(d.list(), /offline/);
});

test("parseSchoolList tolerates wrappers, junk items and partial rows; rankSchools scores exact and partial hits", () => {
  const wrapped = parseSchoolList({ meta: 1, data: RAW });
  assert.equal(wrapped.length, 4);
  assert.deepEqual(parseSchoolList("nope"), []);
  assert.deepEqual(parseSchoolList({ a: 1 }), []);
  assert.deepEqual(
    parseSchoolList([
      null,
      1,
      { name: 3, orgId: 1, evaUrl: "https://sms.schoolsoft.se/x/eva" },
      { name: "n", orgId: 1, evaUrl: 5 },
    ]),
    [],
  );
  const entries = parseSchoolList(RAW);
  const exact = rankSchools(entries, "Täby kommun - Rösjöskolan", 3);
  assert.equal(exact[0].score, 100);
  const partial = rankSchools(entries, "rösjöskolan nacka", 5);
  assert.ok(
    partial.length >= 2 && partial.every((s) => s.score > 0 && s.score < 60),
    JSON.stringify(partial),
  );
});

test("SchoolDirectory: corrupt or mis-shaped cache is ignored; an empty upstream list is an error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "schools-"));
  const cacheFile = join(dir, "schools.json");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(cacheFile, "{not json");
  const d1 = new SchoolDirectory({ cacheFile, fetchImpl: async () => RAW });
  assert.equal((await d1.list()).length, 4, "corrupt cache → refetched");
  writeFileSync(cacheFile, JSON.stringify({ schools: "x", fetchedAt: "y" }));
  const d2 = new SchoolDirectory({ cacheFile, fetchImpl: async () => [] });
  await assert.rejects(d2.list(), /School list was empty/);
});

test("defaultFetch: JSON on success, error on non-2xx", async () => {
  const { defaultFetch } = await import("../../src/providers/schoolsoft/schools.js");
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([{ a: 1 }]));
    } else res.writeHead(503).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  try {
    assert.deepEqual(await defaultFetch(`http://127.0.0.1:${port}/ok`), [{ a: 1 }]);
    await assert.rejects(defaultFetch(`http://127.0.0.1:${port}/down`), /HTTP 503/);
  } finally {
    server.close();
  }
});
