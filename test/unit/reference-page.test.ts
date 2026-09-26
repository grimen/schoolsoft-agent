/** How the connector serves the reference page's module: source, built output, hashes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { pageDocument, pageScript } from "../../src/http/reference/page.js";
import { bootServed } from "../helpers/reference.js";

const sha = (text: string) => createHash("sha256").update(text).digest("base64");

test("from source, the module is app.ts with its types stripped and no imports left", async () => {
  const module = pageScript();
  assert.match(module, /export function boot\(/);
  assert.doesNotMatch(module, /^\s*import\s/m, "the browser gets one file; nothing to import");
  assert.doesNotMatch(module, /: Env\b|interface /, "types are gone");
  assert.match(await bootServed(module), /data-action="connect"/);
});

test("in the built connector, the module is tsc's output without its source-map comment", () => {
  const dir = mkdtempSync(join(tmpdir(), "reference-page-"));
  try {
    writeFileSync(
      join(dir, "app.js"),
      "export const built = 1;\n//# sourceMappingURL=app.js.map\n",
    );
    writeFileSync(join(dir, "app.ts"), "export const source: number = 2;\n");
    const url = pathToFileURL(dir + "/");
    assert.equal(pageScript(url), "export const built = 1;\n");
    rmSync(join(dir, "app.js"));
    assert.equal(pageScript(url).replace(/\s+/g, " ").trim(), "export const source = 2;");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the policy admits exactly the inline script and styles, and nothing else", () => {
  const { html, policy } = pageDocument("export function boot() {}");
  const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)![1];
  const style = /<style>([\s\S]*)<\/style>/.exec(html)![1];
  assert.equal(script, "export function boot() {}\nboot(globalThis);\n");
  assert.deepEqual(policy.split("; "), [
    "default-src 'none'",
    `script-src 'sha256-${sha(script)}'`,
    `style-src 'sha256-${sha(style)}'`,
    "connect-src 'self'",
    "img-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ]);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event handlers");
  for (const bad of ["x</script>y", "<script>", "<!-- x"])
    assert.throws(() => pageDocument(bad), /would end its script/);
});
