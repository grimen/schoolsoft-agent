/**
 * The one way the tool creates files and directories for the user: config,
 * state, caches and logs. Directories are 0700 and files 0600 (on Windows
 * the modes are ignored and the user profile's permissions apply). A write
 * goes to a temporary file next to the target and is renamed into place, so
 * a reader never sees half a file and a file created earlier with wider
 * permissions is replaced, not reused. `make boundaries` refuses a
 * file-creating `node:fs` import anywhere else in src (see
 * docs/planning/specs/2026-09-26-privacy-small-fixes.md).
 */
import {
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Create the directory and any missing parent, each 0700. An existing directory is left as it is. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

/** Flush a directory entry to disk (after a rename or unlink that must survive a crash). */
export function syncDirectory(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface PrivateWriteOptions {
  /** Flush the file before the rename and the directory after it (the connector's security state). */
  durable?: boolean;
}

/** Replace the file with `data` (0600), creating its directory (0700) when missing. */
export function writePrivateFile(
  path: string,
  data: string | Uint8Array,
  options: PrivateWriteOptions = {},
): void {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true }); // a leftover of a crashed write, whatever its mode
  try {
    writeFileSync(temporary, data, {
      mode: PRIVATE_FILE_MODE,
      flag: "wx",
      flush: options.durable === true,
    });
    renameSync(temporary, path);
  } catch (e) {
    rmSync(temporary, { force: true });
    throw e;
  }
  if (options.durable) syncDirectory(dir);
}

/**
 * Create the file (0600) only if it does not exist yet: true when this call
 * created it. Two processes creating the same key at once agree on one.
 */
export function createPrivateFile(path: string, data: string | Uint8Array): boolean {
  ensurePrivateDir(dirname(path));
  try {
    writeFileSync(path, data, { mode: PRIVATE_FILE_MODE, flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/** Append to the file, creating it (0600) and its directory (0700) when missing. */
export function appendPrivateFile(path: string, data: string): void {
  ensurePrivateDir(dirname(path));
  appendFileSync(path, data, { mode: PRIVATE_FILE_MODE });
}
