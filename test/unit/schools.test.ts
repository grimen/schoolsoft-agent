import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSchoolList,
  normalize,
  rankSchools,
  SchoolDirectory,
} from "../../src/core/api/schools.js";

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
