/**
 * What the host did, one JSON line per event. Callers pass names, counts, outcomes and
 * timings only: never an argument value, token, password, cookie or address.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ProbeSurface = "http" | "stdio";
export type ProbeValue =
  string | number | boolean | null | string[] | { [key: string]: ProbeValue };
export interface ProbeEvent {
  event: string;
  [field: string]: ProbeValue | undefined;
}
export interface LoggedEvent extends ProbeEvent {
  at: string;
  surface: ProbeSurface;
}
export interface ProbeLog {
  record(event: ProbeEvent): void;
  /** The latest events, oldest first (the owner dashboard shows them). */
  recent(): LoggedEvent[];
}

function stamp(surface: ProbeSurface, now: () => number, event: ProbeEvent): LoggedEvent {
  return { at: new Date(now()).toISOString(), surface, ...event };
}

/** Appends to `path` (0600, parent 0700) and echoes a one-line summary (stderr by default). */
export function fileLog(
  path: string,
  options: {
    surface: ProbeSurface;
    now?: () => number;
    echo?: (line: string) => void;
    keep?: number;
  },
): ProbeLog {
  const now = options.now ?? Date.now;
  const echo = options.echo ?? ((line: string) => void process.stderr.write(line + "\n"));
  const keep = options.keep ?? 100;
  const latest: LoggedEvent[] = [];
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return {
    record(event) {
      const logged = stamp(options.surface, now, event);
      appendFileSync(path, JSON.stringify(logged) + "\n", { mode: 0o600 });
      latest.push(logged);
      if (latest.length > keep) latest.shift();
      const { event: name, ...fields } = event;
      echo(`host-probe ${name} ${JSON.stringify(fields)}`);
    },
    recent: () => [...latest],
  };
}

/** In-memory log for tests. */
export function memoryLog(
  surface: ProbeSurface,
  now: () => number = Date.now,
): ProbeLog & { events: LoggedEvent[] } {
  const events: LoggedEvent[] = [];
  return {
    events,
    record: (event) => void events.push(stamp(surface, now, event)),
    recent: () => [...events],
  };
}

/** A request path fit for the log: no query string, the URL page's id replaced. */
export function safePath(path: string): string {
  return path.split("?")[0].replace(/^\/probe\/elicit\/[^/]+/, "/probe/elicit/:id");
}
