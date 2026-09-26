/* oxlint-disable oxc/no-async-endpoint-handlers -- Express 5 forwards rejected promises; the page handlers only await UrlPages.complete, which never rejects. */
/**
 * The probe's web pieces shared by both modes: the connector's response hardening and
 * the page a URL elicitation points at.
 */
import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { escapeHtml as esc, form, page } from "../pages.js";
import { safePath, type ProbeLog } from "./log.js";
import type { UrlPages } from "./tools.js";

/**
 * The connector's headers (src/http/server.ts), with `Referrer-Policy: same-origin`:
 * under `no-referrer` real browsers send `Origin: null` on same-origin form posts and
 * the Origin checks refuse them (#58). Then the Host check, as on the connector.
 */
export function harden(app: express.Express, origin: () => string): void {
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self' https://claude.ai https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'",
      "Strict-Transport-Security": "max-age=31536000",
    });
    next();
  });
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, probe: true });
  });
  app.use((req, res, next) => {
    if (req.headers.host !== new URL(origin()).host) {
      res.status(421).end();
      return;
    }
    next();
  });
}

/** Constant-time token comparison, as the connector's owner routes do. */
export function sameToken(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every request by method, logged path and status; never a query string or header. */
export function logRequests(app: express.Express, log: ProbeLog): void {
  app.use((req, res, next) => {
    res.on("finish", () =>
      log.record({
        event: "http",
        method: req.method,
        path: safePath(req.originalUrl),
        status: res.statusCode,
      }),
    );
    next();
  });
}

/**
 * GET shows the page, POST (same Origin, and the owner's CSRF token when a gate set
 * one in `res.locals.csrf`) completes it and tells the host.
 */
export function mountUrlPages(
  app: express.Express,
  { pages, log, origin }: { pages: UrlPages; log: ProbeLog; origin: () => string },
): void {
  app.get("/probe/elicit/:id", (req, res) => {
    const entry = pages.open(req.params.id);
    log.record({ event: "url_page", stage: entry ? "opened" : "unknown" });
    if (!entry) {
      res.status(404).send(page("Probe page expired", "<p>Ask for the probe tool again.</p>"));
      return;
    }
    res.send(
      page(
        "Probe: URL elicitation page",
        `<p>This page belongs to the schoolsoft-agent host probe. Nothing here is real and nothing is sent anywhere.</p><p>Press Done, then return to your chat.</p>${form(
          `/probe/elicit/${esc(entry.id)}`,
          String(res.locals.csrf ?? ""),
          "",
          "Done",
        )}`,
      ),
    );
  });
  app.post("/probe/elicit/:id", async (req, res) => {
    const csrf = res.locals.csrf as string | undefined;
    if (
      req.get("origin") !== origin() ||
      (csrf !== undefined && !sameToken(req.body?.csrf, csrf))
    ) {
      res.status(403).end();
      return;
    }
    const completed = await pages.complete(req.params.id);
    log.record({ event: "url_page", stage: completed ? "completed" : "unknown" });
    res
      .status(completed ? 200 : 404)
      .send(
        completed
          ? page(
              "Done",
              "<p>The probe told your AI app that this page is done. Return to your chat.</p>",
            )
          : page("Probe page expired", "<p>Ask for the probe tool again.</p>"),
      );
  });
}
