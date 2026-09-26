/**
 * The reference page (E5.3): the smallest browser UI over the connector's public REST
 * surface. It runs in the parent's browser, never in the connector process: page.ts
 * inlines this module's JavaScript into /reference/ and calls `boot(globalThis)`.
 *
 * It is an ordinary OAuth client (discovery, dynamic registration, authorization code
 * with PKCE, refresh, revocation) and then reads `GET /api/v1/session` and the routes the
 * session lists. It uses nothing a third-party UI could not use.
 *
 * Only `import type` is allowed here: the browser gets this file alone, so a value import
 * would not resolve. Browser APIs are injected (`Env`), so the offline suite drives it.
 * See docs/planning/specs/2026-09-26-reference-page.md.
 */
import type { CalendarEvent, ChildRef, Lesson, LunchDay } from "../../core/index.js";

/** Where the connector serves this page; also its OAuth callback. */
export const PAGE_PATH = "/reference/";
/** The one path the page knows in advance; everything else is discovered. */
export const SESSION_PATH = "/api/v1/session";
const STORAGE_KEY = "schoolsoft-reference";
const SCOPES = ["get_schedule", "get_lunch_menu", "get_calendar"];
const DAY = 86_400_000;

// ---------- What the REST surface answers (docs/reference/rest-api.md) ----------

export interface SessionBody {
  schoolsoft: {
    signedIn: boolean;
    loginInProgress: boolean;
    webSession: boolean;
    portal: { state: string; retryAt: string | null };
  };
  children: ChildRef[];
  scopes: string[];
  routes: { operation: string; method: string; path: string }[];
  ownerDashboard: string;
  connectionExpiresAt: string;
}
export interface ScheduleBody {
  week: number;
  child: ChildRef;
  lessons: Lesson[];
}
export interface LunchBody {
  year: number;
  week: number;
  child: ChildRef;
  days: LunchDay[];
}
export interface CalendarBody {
  startDate: string;
  endDate: string;
  timezone: string;
  child: ChildRef;
  events: CalendarEvent[];
}
/** RFC 9457 problem details as the connector sends them. */
export interface Problem {
  title?: string;
  detail?: string;
  hint?: string;
  ownerDashboard?: string;
  retryAt?: string;
}

// ---------- Browser seams ----------

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** An element that carries `data-action` (a button or the child selector). */
export interface ActionElement {
  getAttribute(name: string): string | null;
  value?: string;
}
export interface Root {
  innerHTML: string;
  /** The listener's promise is returned so tests can wait for it; browsers ignore it. */
  addEventListener(type: string, listener: (event: { target: unknown }) => unknown): void;
}
export interface Env {
  /** The page's origin, e.g. https://connector.example. */
  origin: string;
  /** The current address, read once at start for the OAuth callback. */
  href: string;
  /** Leave for another page (the authorization endpoint). */
  assign(url: string): void;
  /** Replace the address bar without a request (drops the callback's code). */
  replaceUrl(url: string): void;
  storage: KeyValue;
  fetch: (url: string, init?: FetchInit) => Promise<HttpResponse>;
  random(bytes: number): Uint8Array;
  sha256(data: Uint8Array): Promise<ArrayBuffer>;
  now(): Date;
  root: Root;
}
/** The part of a browser's `globalThis` the page uses. */
export interface BrowserGlobals {
  location: { href: string; origin: string; assign(url: string): void };
  history: { replaceState(data: null, unused: string, url: string): void };
  sessionStorage: KeyValue;
  fetch: (url: string, init?: FetchInit) => Promise<HttpResponse>;
  crypto: {
    getRandomValues(array: Uint8Array): Uint8Array;
    subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> };
  };
  document: { getElementById(id: string): Root | null };
}

export function browserEnv(g: BrowserGlobals): Env {
  return {
    origin: g.location.origin,
    href: g.location.href,
    assign: (url) => g.location.assign(url),
    replaceUrl: (url) => g.history.replaceState(null, "", url),
    storage: g.sessionStorage,
    fetch: (url, init) => g.fetch(url, init),
    random: (bytes) => g.crypto.getRandomValues(new Uint8Array(bytes)),
    sha256: (data) => g.crypto.subtle.digest("SHA-256", data),
    now: () => new Date(),
    root: g.document.getElementById("app")!,
  };
}

/** The page's entry point; page.ts appends `boot(globalThis)`. */
export function boot(g: BrowserGlobals): Promise<void> {
  return new ReferencePage(browserEnv(g)).start();
}

// ---------- Weeks (Europe/Stockholm, ISO 8601) ----------

export interface Week {
  week: number;
  /** Monday … Sunday as YYYY-MM-DD. */
  days: string[];
}

/** Today's date in Europe/Stockholm, whatever the browser's own timezone. */
export function stockholmDate(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The ISO week containing `date`, moved by `offset` weeks. Date-only arithmetic in UTC. */
export function weekOf(date: string, offset = 0): Week {
  const time = Date.parse(date + "T00:00:00Z");
  const monday = time - ((new Date(time).getUTCDay() + 6) % 7) * DAY + offset * 7 * DAY;
  const thursday = new Date(monday + 3 * DAY);
  const january1 = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  return {
    week: Math.floor((thursday.getTime() - january1) / DAY / 7) + 1,
    days: Array.from({ length: 7 }, (_, i) =>
      new Date(monday + i * DAY).toISOString().slice(0, 10),
    ),
  };
}

// ---------- Sections: one REST answer each ----------

export type Section<T> =
  | { state: "ok"; data: T }
  | { state: "not-granted" }
  | { state: "other-child" }
  | { state: "problem"; status: number; problem: Problem };

/**
 * A REST answer as a section, kept only when it is for `childId`. The server already
 * guarantees that; checking again means no fault on either side can put one child's
 * data under another child's name.
 */
export function section<T extends { child: ChildRef }>(
  status: number,
  body: unknown,
  childId: number,
): Section<T> {
  if (status !== 200 || !body)
    return { state: "problem", status, problem: (body ?? {}) as Problem };
  const data = body as T;
  return data.child?.id === childId ? { state: "ok", data } : { state: "other-child" };
}

// ---------- Rendering (every value from the API goes through esc) ----------

export function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
function dayLabel(date: string, index: number): string {
  return `${WEEKDAYS[index]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}
const time = (value: string) => value.slice(11, 16);

/** A link to the owner dashboard, only when it is on this page's own origin. */
function dashboardLink(url: string | undefined, origin: string): string {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  return parsed.origin === origin
    ? ` <a href="${esc(parsed.href)}">Open the owner dashboard</a>`
    : "";
}

function notice(label: string, part: Section<unknown>, origin: string): string {
  if (part.state === "ok") return "";
  if (part.state === "not-granted")
    return `<p class="notice">${esc(label)}: not granted to this page. Connect again to choose it.</p>`;
  if (part.state === "other-child")
    return `<p class="notice">${esc(label)}: the answer was for another child and is not shown.</p>`;
  const { title, detail, hint, ownerDashboard } = part.problem;
  const text = [title, detail, hint].filter(Boolean).map(esc).join(" ");
  return `<p class="notice">${esc(label)}: ${text || `HTTP ${part.status}`}${
    part.status === 409 ? dashboardLink(ownerDashboard, origin) : ""
  }</p>`;
}

export interface WeekView {
  origin: string;
  children: ChildRef[];
  child: ChildRef;
  week: Week;
  schedule: Section<ScheduleBody>;
  lunch: Section<LunchBody>;
  calendar: Section<CalendarBody>;
}

export function renderWeek(view: WeekView): string {
  const { week, child, children } = view;
  const lessons = view.schedule.state === "ok" ? view.schedule.data.lessons : [];
  const lunch = view.lunch.state === "ok" ? view.lunch.data.days : [];
  const events =
    view.calendar.state === "ok"
      ? view.calendar.data.events.filter((event) => event.kind === "event")
      : [];
  const columns = week.days
    .map((date, index) => {
      const dayLessons = lessons
        .filter((lesson) => lesson.start.slice(0, 10) === date)
        .sort((a, b) => a.start.localeCompare(b.start));
      const dayEvents = events.filter((event) => event.start.slice(0, 10) === date);
      const dishes = lunch.filter((day) => day.date === date).flatMap((day) => day.dishes);
      const empty = !dayLessons.length && !dayEvents.length && !dishes.length;
      if (index >= 5 && empty) return "";
      const items = [
        ...dayEvents.map(
          (event) =>
            `<li class="event">${event.allDay ? "All day" : esc(time(event.start))} ${esc(event.title)}${event.location ? `, ${esc(event.location)}` : ""}</li>`,
        ),
        ...dayLessons.map(
          (lesson) =>
            `<li>${esc(time(lesson.start))}–${esc(time(lesson.end))} ${esc(lesson.title)}${[
              lesson.room,
              lesson.teacher,
            ]
              .filter(Boolean)
              .map((part) => `, ${esc(part)}`)
              .join("")}</li>`,
        ),
        ...dishes.map(
          (dish) =>
            // The kind only when it says more than "Lunch" (e.g. "Vegetarisk").
            `<li class="lunch">Lunch: ${dish.kind && dish.kind.toLowerCase() !== "lunch" ? `${esc(dish.kind)}: ` : ""}${esc(dish.description)}</li>`,
        ),
      ];
      return `<section class="day"><h2>${dayLabel(date, index)}</h2>${
        items.length ? `<ul>${items.join("")}</ul>` : "<p>Nothing listed.</p>"
      }</section>`;
    })
    .join("");
  const picker =
    children.length > 1
      ? `<label>Child <select data-action="child">${children
          .map(
            (c) =>
              `<option value="${esc(c.id)}"${c.id === child.id ? " selected" : ""}>${esc(c.firstName)}</option>`,
          )
          .join("")}</select></label>`
      : "";
  return `<h1>Week ${week.week}: ${esc(child.firstName)}</h1><nav>${picker}<button type="button" data-action="prev">Previous week</button><button type="button" data-action="next">Next week</button><button type="button" data-action="reload">Reload</button><button type="button" data-action="disconnect">Disconnect this page</button></nav>${
    notice("Lessons", view.schedule, view.origin) +
    notice("Lunch", view.lunch, view.origin) +
    notice("School events", view.calendar, view.origin)
  }<div class="days">${columns}</div>`;
}

export function renderMessage(title: string, text: string, extra = ""): string {
  return `<h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}`;
}
const CONNECT_BUTTON = '<button type="button" data-action="connect">Connect this page</button>';

// ---------- The page ----------

interface Endpoints {
  resource: string;
  registration: string;
  authorization: string;
  token: string;
  revocation: string;
}
interface Saved {
  client?: { id: string; endpoints: Endpoints };
  refresh?: string;
  /** Between leaving for /authorize and coming back. */
  pending?: { state: string; verifier: string };
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** Refused discovery or registration: shown to the parent as it is. */
class ConnectError extends Error {}

export class ReferencePage {
  /** In memory only; the refresh token in sessionStorage brings it back after a reload. */
  private access: string | undefined;
  private refreshing: Promise<boolean> | undefined;
  private childId: number | undefined;
  private offset = 0;
  /** Bumped by every load; an answer for an older load is never rendered. */
  private sequence = 0;

  private readonly env: Env;
  // A plain field, not a parameter property: the page is served type-stripped (erasable syntax only).
  constructor(env: Env) {
    this.env = env;
  }

  private get saved(): Saved {
    try {
      return JSON.parse(this.env.storage.getItem(STORAGE_KEY) ?? "{}") as Saved;
    } catch {
      return {};
    }
  }
  private save(saved: Saved): void {
    this.env.storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
  private show(html: string): void {
    this.env.root.innerHTML = html;
  }
  private showConnect(text: string): void {
    this.access = undefined;
    this.show(renderMessage("Reference page", text, CONNECT_BUTTON));
  }

  start(): Promise<void> {
    this.env.root.addEventListener("click", (event) => this.run(() => this.onClick(event.target)));
    this.env.root.addEventListener("change", (event) =>
      this.run(() => this.onChange(event.target)),
    );
    const url = new URL(this.env.href);
    const params = url.searchParams;
    if (params.has("code") || params.has("error") || params.has("state")) {
      this.env.replaceUrl(url.pathname);
      return this.run(() =>
        this.finishConnect(params.get("code"), params.get("error"), params.get("state")),
      );
    }
    if (this.saved.refresh) return this.run(() => this.load());
    this.showConnect(
      "This page shows one child's week from your connector's REST API. Connect it once; you choose the children on the next page.",
    );
    return Promise.resolve();
  }

  /** Every entry point: a failure the page did not expect (the network) becomes a message. */
  private async run(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.show(
        renderMessage(
          "Could not reach the connector",
          `${(error as Error).message}. Check the connection and try again.`,
          '<button type="button" data-action="reload">Try again</button>',
        ),
      );
    }
  }

  private async onClick(target: unknown): Promise<void> {
    const element = (
      target as { closest?(selector: string): ActionElement | null } | null
    )?.closest?.("[data-action]");
    const action = element?.getAttribute("data-action");
    if (action === "connect") return this.connect();
    if (action === "disconnect") return this.disconnect();
    // Reload asks the connector to read SchoolSoft now (`fresh`); moving between weeks
    // may be answered from the connector's short-lived read cache.
    if (action === "reload") return this.load(true);
    if (action === "prev" || action === "next") {
      this.offset += action === "prev" ? -1 : 1;
      return this.load();
    }
  }
  private async onChange(target: unknown): Promise<void> {
    const element = target as ActionElement | null;
    if (element?.getAttribute("data-action") !== "child") return;
    this.childId = Number(element.value);
    return this.load();
  }

  private sameOrigin(value: unknown): string {
    const url = new URL(String(value), this.env.origin);
    if (url.origin !== this.env.origin) throw new ConnectError("the connector named another site");
    return url.href;
  }
  private async json(url: string, init?: FetchInit): Promise<Record<string, unknown>> {
    const response = await this.env.fetch(url, init);
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.status < 200 || response.status >= 300 || !body)
      throw new ConnectError(`${url} answered ${response.status}`);
    return body;
  }

  /** Discovery from the API's own challenge, registration, then off to the consent page. */
  private async connect(): Promise<void> {
    this.show(renderMessage("Connecting", "Finding your connector's sign-in…"));
    try {
      const probe = await this.env.fetch(SESSION_PATH);
      const challenge = probe.headers.get("www-authenticate") ?? "";
      const metadata = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
      if (probe.status !== 401 || !metadata)
        throw new ConnectError("the API did not name its sign-in");
      const resource = await this.json(this.sameOrigin(metadata));
      const issuer = (resource.authorization_servers as unknown[] | undefined)?.[0];
      const server = await this.json(
        this.sameOrigin(
          new URL("/.well-known/oauth-authorization-server", this.sameOrigin(issuer)),
        ),
      );
      const endpoints: Endpoints = {
        resource: String(resource.resource),
        registration: this.sameOrigin(server.registration_endpoint),
        authorization: this.sameOrigin(server.authorization_endpoint),
        token: this.sameOrigin(server.token_endpoint),
        revocation: this.sameOrigin(server.revocation_endpoint),
      };
      const callback = this.env.origin + PAGE_PATH;
      const client = await this.json(endpoints.registration, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Reference page",
          redirect_uris: [callback],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      });
      const verifier = base64url(this.env.random(32));
      const state = base64url(this.env.random(32));
      const challengeValue = base64url(
        new Uint8Array(await this.env.sha256(new TextEncoder().encode(verifier))),
      );
      const clientId = String(client.client_id);
      this.save({ client: { id: clientId, endpoints }, pending: { state, verifier } });
      this.env.assign(
        endpoints.authorization +
          "?" +
          new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: callback,
            code_challenge: challengeValue,
            code_challenge_method: "S256",
            state,
            scope: SCOPES.join(" "),
            resource: endpoints.resource,
          }),
      );
    } catch (error) {
      this.showConnect(`Could not start connecting: ${(error as Error).message}.`);
    }
  }

  /** Back from the consent page. The address bar was already cleaned. */
  private async finishConnect(
    code: string | null,
    error: string | null,
    state: string | null,
  ): Promise<void> {
    const saved = this.saved;
    const pending = saved.pending;
    delete saved.pending;
    this.save(saved);
    if (!pending || !saved.client || state !== pending.state)
      return this.showConnect("That sign-in answer was not started from this tab. Connect again.");
    if (error || !code)
      return this.showConnect("Access was not granted. Connect again to choose what to share.");
    const tokens = await this.tokenRequest({
      grant_type: "authorization_code",
      code,
      code_verifier: pending.verifier,
      redirect_uri: this.env.origin + PAGE_PATH,
    });
    if (!tokens) return this.showConnect("Could not finish connecting. Connect again.");
    return this.load();
  }

  /** One request to the token endpoint; keeps the new tokens, or forgets them on refusal. */
  private async tokenRequest(values: Record<string, string>): Promise<boolean> {
    const saved = this.saved;
    const client = saved.client!;
    const response = await this.env.fetch(client.endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...values,
        client_id: client.id,
        resource: client.endpoints.resource,
      }).toString(),
    });
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
    } | null;
    if (response.status === 400 || response.status === 401) {
      // Refused (invalid_grant): the grant was revoked, expired or the token reused.
      this.access = undefined;
      delete saved.refresh;
      this.save(saved);
      return false;
    }
    if (response.status !== 200 || !body?.access_token || !body.refresh_token)
      throw new Error(`the token endpoint answered ${response.status}`);
    this.access = body.access_token;
    this.save({ ...saved, refresh: body.refresh_token });
    return true;
  }

  /** One refresh at a time: parallel 401s share it, so a rotated token is never replayed. */
  private refresh(): Promise<boolean> {
    const refresh = this.saved.refresh;
    if (!refresh || !this.saved.client) return Promise.resolve(false);
    this.refreshing ??= this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: refresh,
    }).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /**
   * A bearer GET. On 401 it refreshes (unless another read already did) and retries once;
   * a 401 after that means the grant is gone.
   */
  private async api(path: string): Promise<{ status: number; body: unknown }> {
    const get = async (token: string | undefined) => {
      const response = await this.env.fetch(path, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    if (!this.access && !(await this.refresh())) return { status: 401, body: null };
    const used = this.access;
    const first = await get(used);
    if (first.status !== 401) return first;
    if (this.access === used && !(await this.refresh())) return first;
    return get(this.access);
  }

  private async load(fresh = false): Promise<void> {
    const sequence = ++this.sequence;
    const current = () => sequence === this.sequence;
    this.show(renderMessage("Loading", "Reading from your connector…"));
    const reply = await this.api(SESSION_PATH);
    if (!current()) return;
    if (reply.status === 401)
      return this.showConnect("This page's connection has ended. Connect again.");
    if (reply.status !== 200) {
      const problem = (reply.body ?? {}) as Problem;
      return this.show(
        renderMessage(
          "The connector could not answer",
          [problem.title, problem.detail].filter(Boolean).join(" ") || `HTTP ${reply.status}`,
          '<button type="button" data-action="reload">Try again</button>',
        ),
      );
    }
    const session = reply.body as SessionBody;
    const origin = this.env.origin;
    if (!session.schoolsoft.signedIn)
      return this.show(
        renderMessage(
          "The connector is not signed in to SchoolSoft",
          session.schoolsoft.loginInProgress
            ? "A sign-in is waiting for BankID on the owner dashboard."
            : "The parent signs in with BankID on the owner dashboard; then reload this page.",
          `<p>${dashboardLink(session.ownerDashboard, origin)}</p><button type="button" data-action="reload">Reload</button>`,
        ),
      );
    if (session.schoolsoft.portal.state !== "ok")
      return this.show(
        renderMessage(
          "SchoolSoft is pushing back",
          `The connector sends it nothing ${
            session.schoolsoft.portal.retryAt
              ? `until ${session.schoolsoft.portal.retryAt}`
              : "until one request has tested it"
          }. Try again later; signing in again does not help.`,
          '<button type="button" data-action="reload">Reload</button>',
        ),
      );
    if (!session.children.length)
      return this.showConnect("This connection covers no children. Connect again to choose one.");
    const child = session.children.find((c) => c.id === this.childId) ?? session.children[0];
    this.childId = child.id;
    const week = weekOf(stockholmDate(this.env.now()), this.offset);
    const read = async <T extends { child: ChildRef }>(
      operation: string,
      query: Record<string, string>,
    ): Promise<Section<T>> => {
      const route = session.routes.find((r) => r.operation === operation);
      if (!route) return { state: "not-granted" };
      const path = route.path.replace("{childId}", String(child.id));
      if (!path.startsWith("/api/")) return { state: "not-granted" };
      const search = new URLSearchParams({ ...query, ...(fresh ? { fresh: "true" } : {}) });
      const answer = await this.api(`${path}?${search}`);
      return section<T>(answer.status, answer.body, child.id);
    };
    const [schedule, lunch, calendar] = await Promise.all([
      read<ScheduleBody>("get_schedule", { week: String(week.week) }),
      read<LunchBody>("get_lunch_menu", { week: String(week.week) }),
      read<CalendarBody>("get_calendar", { start_date: week.days[0], end_date: week.days[6] }),
    ]);
    if (!current()) return;
    if ([schedule, lunch, calendar].some((s) => s.state === "problem" && s.status === 401))
      return this.showConnect("This page's connection has ended. Connect again.");
    this.show(
      renderWeek({ origin, children: session.children, child, week, schedule, lunch, calendar }),
    );
  }

  /** Withdraws the grant at the connector (as any client may), then forgets everything. */
  private async disconnect(): Promise<void> {
    const saved = this.saved;
    this.env.storage.removeItem(STORAGE_KEY);
    this.childId = undefined;
    this.offset = 0;
    this.sequence++;
    if (saved.client && saved.refresh)
      await this.env
        .fetch(saved.client.endpoints.revocation, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: saved.refresh,
            client_id: saved.client.id,
          }).toString(),
        })
        .catch(() => undefined);
    this.showConnect("Disconnected. The connector no longer lists this page.");
  }
}
