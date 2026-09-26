/**
 * Unit: the guided first run's sentences. Every key has English and Swedish
 * and none is empty, so a parent never sees a mixed-language screen; every
 * guide the first run links to exists in this repository.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DOC_PATHS, DOCS_BASE, WORDS, docLink, say } from "../../src/cli/guide/words.js";

test("guide words: every key in English and Swedish, none empty, parameters filled in", () => {
  const params = {
    cmd: "schoolsoft-agent",
    n: 2,
    title: "T",
    query: "q",
    max: 3,
    name: "N",
    school: "s",
    file: "f",
    dir: "d",
    url: "u",
    ok: 5,
    total: 5,
    failed: 1,
  };
  for (const [key, entry] of Object.entries(WORDS)) {
    for (const lang of ["en", "sv"] as const) {
      assert.ok(lang in entry, `${key} lacks ${lang}`);
      const text = say(lang, key as keyof typeof WORDS, params);
      assert.ok(text.trim().length > 0, `${key}.${lang} is empty`);
      assert.doesNotMatch(text, /undefined/, `${key}.${lang} misses a parameter`);
    }
  }
  assert.equal(say("en", "children", { n: 1 }), "Found 1 child on your account.");
  assert.equal(say("en", "children", { n: 3 }), "Found 3 children on your account.");
  assert.equal(say("sv", "step", { n: 1, title: "Hitta skolan" }), "Steg 1 av 5: Hitta skolan");
  assert.equal(say("en", "loggedInNoName"), "Logged in.");
});

test("guide links: every linked guide exists on main's docs path", () => {
  for (const [key, path] of Object.entries(DOC_PATHS)) {
    assert.ok(existsSync(join(process.cwd(), "docs", path)), `${key}: docs/${path} is missing`);
    assert.equal(docLink(key as keyof typeof DOC_PATHS), DOCS_BASE + path);
  }
  assert.equal(DOCS_BASE, "https://github.com/grimen/schoolsoft-agent/blob/main/docs/");
});
