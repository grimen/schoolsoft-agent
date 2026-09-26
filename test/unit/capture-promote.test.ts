/**
 * The promote check and step, on synthetic files in a temporary directory:
 * each heuristic fires and reports rule and line (never the text), the
 * maintainer's denylist and the capture's hashed names both count, and
 * one finding anywhere means nothing moves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hashWord,
  parseDenylist,
  scanForPersonalData,
} from "../../src/providers/schoolsoft/capture/scan.js";
import { promoteCaptures } from "../../src/providers/schoolsoft/capture/promote.js";
import { HASHED_NAMES, MANIFEST } from "../../src/providers/schoolsoft/capture/capture.js";
import { EXIT_CODE_BY_KIND } from "../../src/core/errors/index.js";

const none = { words: [] };

test("heuristics: e-mail, phone, national id, long numbers, name-like pairs", () => {
  const rules = (s: string) => scanForPersonalData(s, none).map((f) => f.rule);
  assert.deepEqual(rules("skriv till a.b@skola.example"), ["email"]);
  assert.deepEqual(rules("ring 070-123 45 67"), ["phone"]);
  assert.deepEqual(rules("ring +46 70 123 45 67"), ["phone"]);
  assert.deepEqual(rules("pnr 20100101-1234"), ["national-id"]);
  assert.deepEqual(rules("pnr 1001011234"), ["national-id"]);
  assert.deepEqual(rules('"id": 4471123'), ["long-number"]);
  assert.deepEqual(rules("Anna Svensson"), ["name-like"]);
  assert.deepEqual(rules("Sen Ankomst, Ogiltig Frånvaro"), [], "interface words in title case");
  assert.deepEqual(
    rules("2026-09-21 08:30 [text 3] 1001 v. 39 0 12"),
    [],
    "dates, placeholders, short numbers",
  );
  assert.deepEqual(rules("tid 0000-00-00"), [], "short zero runs are not phones");
  assert.deepEqual(rules("datum 2026-09-21-2026-09-25"), []);
  const f = scanForPersonalData("ok\nAnna Svensson", none);
  assert.deepEqual(f, [{ rule: "name-like", line: 2 }]);
});

test("denylist: plain words from the local file, and salted hashes from the capture", () => {
  const words = parseDenylist("# my family\nKalle Anka  # the child\n\n  Ö\n");
  assert.deepEqual(words, ["Kalle Anka", "Ö"]);
  const deny = { words };
  assert.deepEqual(scanForPersonalData("hej kalle", deny), [{ rule: "denylist", line: 1 }]);
  assert.deepEqual(scanForPersonalData("kallebacken", deny), [], "whole words only");
  const salt = "s4lt";
  const hashed = { words: [], hashed: { salt, hashes: [hashWord(salt, "Provskolan")] } };
  assert.deepEqual(scanForPersonalData("<td>provskolan</td>", hashed), [
    { rule: "denylist", line: 1 },
  ]);
  assert.deepEqual(scanForPersonalData("<td>skolan</td>", hashed), []);
});

function setup(files: Record<string, string>, manifest: unknown, hashed?: unknown) {
  const root = mkdtempSync(join(tmpdir(), "capture-promote-"));
  const dir = join(root, ".captures");
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  if (manifest !== undefined) writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest));
  if (hashed !== undefined) writeFileSync(join(dir, HASHED_NAMES), JSON.stringify(hashed));
  const out: string[] = [];
  const err: string[] = [];
  const run = (denylist = "") => {
    const denylistFile = join(root, ".capture-denylist");
    if (denylist) writeFileSync(denylistFile, denylist);
    return promoteCaptures(
      { captureDir: dir, repoRoot: root, denylistFile },
      { out: (l) => out.push(l), err: (l) => err.push(l) },
    );
  };
  return { root, dir, out, err, run };
}

test("promote moves clean files into test/fixtures and says to review the diff", () => {
  const s = setup(
    { "a.json": '[{"eventId": 1001, "name": "[text 1]"}]\n', "b.html": "<td>Närvarande</td>\n" },
    {
      files: [
        { file: "a.json", fixture: "test/fixtures/api/a.json" },
        { file: "b.html", fixture: "test/fixtures/jsp/b.html" },
      ],
    },
    { salt: "x", hashes: [hashWord("x", "ada")] },
  );
  assert.equal(s.run(), 0);
  assert.equal(
    readFileSync(join(s.root, "test/fixtures/api/a.json"), "utf8"),
    '[{"eventId": 1001, "name": "[text 1]"}]\n',
  );
  assert.ok(existsSync(join(s.root, "test/fixtures/jsp/b.html")));
  assert.ok(!existsSync(join(s.dir, "a.json")), "moved, not copied");
  assert.match(s.out.at(-1)!, /git diff/);
  // a second run finds the files gone and refuses
  s.out.length = 0;
  assert.equal(s.run(), EXIT_CODE_BY_KIND.input);
  assert.match(s.err[0], /a\.json: file is missing/);
});

test("one finding anywhere: nothing moves, findings show rule and line only", () => {
  const s = setup(
    { "a.json": "[]\n", "b.html": "<td>ok</td>\n<td>Ada</td>\n" },
    {
      files: [
        { file: "a.json", fixture: "test/fixtures/api/a.json" },
        { file: "b.html", fixture: "test/fixtures/jsp/b.html" },
      ],
    },
  );
  assert.equal(s.run("Ada\n"), EXIT_CODE_BY_KIND.input);
  assert.deepEqual(s.err.slice(0, 2), ["b.html: denylist on line 2", "Nothing was moved."]);
  assert.ok(!s.err.join("\n").includes("Ada"), "the finding never repeats the text");
  assert.ok(existsSync(join(s.dir, "a.json")), "the clean file stayed too");
  assert.ok(!existsSync(join(s.root, "test/fixtures")));
});

test("promote refuses destinations outside test/fixtures and a missing or empty manifest", () => {
  const bad = setup(
    { "a.json": "[]" },
    {
      files: [
        { file: "a.json", fixture: "src/a.json" },
        { file: "a.json", fixture: "test/fixtures/../../x.json" },
        { file: "../a.json", fixture: "test/fixtures/a.json" },
      ],
    },
  );
  assert.equal(bad.run(), EXIT_CODE_BY_KIND.input);
  assert.equal(bad.err.filter((l) => l.includes("not under test/fixtures")).length, 3);

  const missing = setup({}, undefined);
  assert.equal(missing.run(), EXIT_CODE_BY_KIND.input);
  assert.match(missing.err[0], /Nothing to promote/);
  const empty = setup({}, { files: [] });
  assert.equal(empty.run(), EXIT_CODE_BY_KIND.input);
});
