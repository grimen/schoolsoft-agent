/**
 * The promote step's last line of defence: find what still looks like
 * personal data in a redacted capture before it may move into
 * test/fixtures. Heuristics (e-mail, phone, national id, long numbers,
 * two capitalised words that are not interface words) plus a denylist:
 * words the maintainer lists in a local, gitignored file and the names the
 * capture itself knew, stored only as salted hashes. A finding reports the
 * rule and the line, never the matched text.
 */
import { createHash } from "node:crypto";
import { INTERFACE_WORDS } from "./vocabulary.js";

export interface Finding {
  rule: "email" | "phone" | "national-id" | "long-number" | "name-like" | "denylist";
  line: number;
}

export interface Denylist {
  /** Plain words or names (the maintainer's local file); matched word by word. */
  words: readonly string[];
  /** Salted SHA-256 of lower-cased words (names the capture knew). */
  hashed?: { salt: string; hashes: readonly string[] };
}

export function hashWord(salt: string, word: string): string {
  return createHash("sha256").update(`${salt}:${word.toLowerCase()}`).digest("hex");
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?<![\d-])(?:\+46|0)[\d\s-]{6,14}\d(?![\d-])/g;
const NATIONAL_ID = /(?<!\d)(?:19|20)?\d{6}[-+]?\d{4}(?!\d)/;
const LONG_NUMBER = /(?<!\d)\d{6,}(?!\d)/;
const DATE = /^\d{4}-\d{2}-\d{2}/;
const CAPITALISED_PAIR = /\b(\p{Lu}\p{Ll}+)\s+(\p{Lu}\p{Ll}+)\b/gu;

/** Lines of a denylist file: one word or name per line, `#` comments. */
export function parseDenylist(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
}

function phoneLike(line: string): boolean {
  for (const m of line.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 12 && !DATE.test(m[0])) return true;
  }
  return false;
}

function nameLike(line: string): boolean {
  for (const m of line.matchAll(CAPITALISED_PAIR)) {
    if (!INTERFACE_WORDS.has(m[1].toLowerCase()) || !INTERFACE_WORDS.has(m[2].toLowerCase()))
      return true;
  }
  return false;
}

export function scanForPersonalData(content: string, deny: Denylist): Finding[] {
  const plain = new Set(deny.words.flatMap((w) => w.toLowerCase().match(/\p{L}{2,}/gu) ?? []));
  const hashes = new Set(deny.hashed?.hashes ?? []);
  const findings: Finding[] = [];
  content.split("\n").forEach((line, i) => {
    const at = (rule: Finding["rule"]) => findings.push({ rule, line: i + 1 });
    const lower = line.toLowerCase();
    if (EMAIL.test(line)) at("email");
    if (phoneLike(line)) at("phone");
    if (NATIONAL_ID.test(line)) at("national-id");
    else if (LONG_NUMBER.test(line)) at("long-number");
    if (nameLike(line)) at("name-like");
    const lineWords = lower.match(/\p{L}+/gu) ?? [];
    if (
      lineWords.some((w) => plain.has(w)) ||
      (deny.hashed && lineWords.some((w) => hashes.has(hashWord(deny.hashed!.salt, w))))
    )
      at("denylist");
  });
  return findings;
}
