/**
 * Versioned persisted formats. Pure: no filesystem, no environment. Every
 * JSON document the tool keeps on disk carries a whole-number `version`;
 * a document without one is v0 (the format written before versions
 * existed). Each format is declared next to its type as a list of
 * migrations, so a future format change is one function and one entry.
 * See docs/planning/specs/2026-09-26-versioned-state.md.
 */
import { AgentError } from "./errors/index.js";

export const VERSION_FIELD = "version";

/**
 * Upgrades a document of version n to version n + 1. Typed with a `never`
 * parameter so a migration can name the shape it expects (`(raw: Record<…>)`)
 * without a cast; it may ignore a `version` field it receives.
 */
export type Migration = (doc: never) => object;

export interface VersionedFormat {
  /** `migrations[n]` upgrades version n to n + 1; the current version is the list's length. */
  readonly migrations: readonly Migration[];
}

/** v0 → v1 for formats whose only change is the added field. */
export const unchanged: Migration = (doc: object) => doc;

export function currentVersion(format: VersionedFormat): number {
  return format.migrations.length;
}

/** A file written by a newer build. It is never overwritten or deleted by this one. */
export class NewerFormatError extends AgentError {
  constructor(file: string, found: number, supported: number) {
    super({
      kind: "not_available",
      key: "state_newer_than_app",
      params: { file, found, supported },
      hint: "update_app",
    });
  }
}

/**
 * The `version` field is present but not a whole number. Never shown to a
 * user: every loader maps it to that file's corrupted-file behaviour.
 */
export class MalformedVersionError extends Error {
  constructor(file: string) {
    super(`${file}: "${VERSION_FIELD}" is not a whole number`);
    this.name = "MalformedVersionError";
  }
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** The version a parsed document declares: 0 when it has none, null when the field is malformed. */
export function storedVersion(raw: unknown): number | null {
  if (!isRecord(raw) || !(VERSION_FIELD in raw)) return 0;
  const v = raw[VERSION_FIELD];
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/**
 * Migrate a parsed document to the current version and return it without
 * the version field. Throws NewerFormatError for a newer document and
 * MalformedVersionError for a malformed field; a migration may throw on a
 * document it cannot read.
 */
export function readVersioned<T>(format: VersionedFormat, raw: unknown, file: string): T {
  const found = storedVersion(raw);
  if (found === null) throw new MalformedVersionError(file);
  const current = currentVersion(format);
  if (found > current) throw new NewerFormatError(file, found, current);
  let doc: unknown = raw;
  for (let v = found; v < current; v++) doc = format.migrations[v](doc as never);
  const { [VERSION_FIELD]: _version, ...rest } = doc as Record<string, unknown>;
  return rest as T;
}

/**
 * `readVersioned` behind a file's own corrupted-file behaviour: a newer
 * version always escapes as NewerFormatError; anything else that goes
 * wrong while parsing or migrating (bad JSON, bad cipher, malformed
 * version, a shape the migration cannot read) is handed to `corrupt`.
 */
export function loadVersioned<T, C>(
  format: VersionedFormat,
  file: string,
  parse: () => unknown,
  corrupt: (e: unknown) => C,
): T | C {
  try {
    return readVersioned<T>(format, parse(), file);
  } catch (e) {
    if (e instanceof NewerFormatError) throw e;
    return corrupt(e);
  }
}

/** The document to store: the current version first, then the value. */
export function writeVersioned(format: VersionedFormat, value: object): Record<string, unknown> {
  const { [VERSION_FIELD]: _version, ...rest } = value as Record<string, unknown>;
  return { [VERSION_FIELD]: currentVersion(format), ...rest };
}

/** One line for `doctor`: which version a file is in, relative to this build. */
export function describeVersion(format: VersionedFormat, found: number | null): string {
  const current = currentVersion(format);
  if (found === null) return "format version unreadable";
  if (found === current) return `format v${found}`;
  if (found < current) return `format v${found}, upgraded to v${current} on the next write`;
  return `format v${found}, newer than this version reads (v${current})`;
}
