/**
 * Serves the reference page (E5.3) at /reference/: one HTML document with the browser
 * module (app.ts) and its styles inline, under a policy scoped to this one path that
 * allows exactly those two inline texts (by hash) and requests to this origin. The page
 * holds no data; every read goes through the REST surface with the page's own OAuth token.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Router } from "express";
import { PAGE_PATH } from "./app.js";

const STYLE = [
  ":root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.4}",
  "body{margin:0 auto;max-width:72rem;padding:1rem}",
  "nav{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:1rem}",
  ".days{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:.75rem}",
  ".day{border:1px solid #8886;border-radius:.5rem;padding:.5rem .75rem}",
  ".day h2{font-size:1rem;margin:.25rem 0}",
  ".day ul{list-style:none;margin:0;padding:0}",
  ".day li{padding:.25rem 0;border-top:1px solid #8883}",
  ".event{font-weight:600}.lunch{font-style:italic}",
  ".notice{padding:.25rem .75rem;border-left:4px solid #c80}",
  "footer{margin-top:2rem;font-size:.85rem;opacity:.8}",
].join("");

/**
 * The page's JavaScript. The built connector reads the file tsc emitted next to this one
 * (without its source-map comment); running from source (tests, `npm run dev`), Node
 * strips the types from app.ts. `dir` is a parameter so both cases are tested.
 */
export function pageScript(dir: URL = new URL(".", import.meta.url)): string {
  const built = new URL("app.js", dir);
  if (existsSync(built))
    return readFileSync(built, "utf8").replace(/\n\/\/# sourceMappingURL=\S*\s*$/, "\n");
  return stripTypeScriptTypes(readFileSync(new URL("app.ts", dir), "utf8"));
}

const hash = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/** The document and the policy that admits exactly its inline script and styles. */
export function pageDocument(module: string): { html: string; policy: string } {
  // Inline text cannot end or restart its own element; app.ts never needs to.
  if (/<\/script|<script|<!--/i.test(module))
    throw new Error("reference page: the module contains markup that would end its script");
  const script = `${module}\nboot(globalThis);\n`;
  return {
    html: `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reference page</title><style>${STYLE}</style><body><main id="app"><h1>Reference page</h1><p>Loading…</p><noscript><p>This page needs JavaScript.</p></noscript></main><footer><p>A minimal page that reads this connector's REST API, as any custom UI would. <a href="/owner">Owner dashboard</a></p><p>Independent project. Not affiliated with SchoolSoft AB or BankID.</p></footer><script type="module">${script}</script></body></html>`,
    policy: [
      "default-src 'none'",
      `script-src ${hash(script)}`,
      `style-src ${hash(STYLE)}`,
      "connect-src 'self'",
      "img-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join("; "),
  };
}

/** GET /reference/ (the page and its OAuth callback) and GET /reference (to it). */
export function referencePage(module: string = pageScript()): Router {
  const { html, policy } = pageDocument(module);
  const router = Router({ strict: true });
  router.get(PAGE_PATH.slice(0, -1), (_req, res) => {
    res.redirect(301, PAGE_PATH);
  });
  router.get(PAGE_PATH, (_req, res) => {
    // The page posts no forms (its fetches are CORS-mode and carry their Origin), so it
    // keeps no-referrer: nothing, not even its own callback address, goes in a Referer.
    res
      .set({ "Content-Security-Policy": policy, "Referrer-Policy": "no-referrer" })
      .type("html")
      .send(html);
  });
  return router;
}
