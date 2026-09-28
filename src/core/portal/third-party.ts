/**
 * Other families' data, reduced at the one boundary every surface's portal
 * passes: `createPortals` (wiring.ts) wraps its portal in this decorator, below
 * the read cache. See docs/planning/specs/2026-09-28-other-families-data.md.
 *
 * - Contact lists: other families keep name and role; staff groups keep their
 *   work e-mail and phone. `contactDetails` (the user's explicit opt-in) keeps
 *   e-mail and phone for everyone. No other field ever passes.
 * - Messages: recipients become display names; keys holding contact details are
 *   removed at any depth. The text stays: it is what the user asked to read.
 * - Activity log: only the known fields of an entry pass.
 */
import {
  CAPABILITIES,
  type ActivityEntry,
  type Capability,
  type ContactGroup,
  type ContactPerson,
  type Portal,
} from "./types.js";

/** Capabilities that can return other families' data; never cached (wiring.ts). */
export const THIRD_PARTY_CAPABILITIES = [
  "getContacts",
  "getMessage",
  "getActivityLog",
] as const satisfies readonly Capability[];

/**
 * Contact-list headings that hold the school's staff, lower case. Compared
 * whole: a heading not listed here is treated as families (fail closed).
 */
export const STAFF_GROUP_HEADINGS: readonly string[] = [
  "personal",
  "skolpersonal",
  "lärare",
  "mentor",
  "mentorer",
  "staff",
  "teacher",
  "teachers",
];

export function isStaffGroup(title: string): boolean {
  return STAFF_GROUP_HEADINGS.includes(title.trim().toLocaleLowerCase("sv"));
}

export function redactContacts(groups: ContactGroup[], contactDetails: boolean): ContactGroup[] {
  return groups.map((group) => {
    const reveal = contactDetails || isStaffGroup(group.title);
    let hidden = false;
    const people = group.people.map((p) => {
      const person: ContactPerson = { name: p.name, role: p.role };
      if (!reveal) hidden ||= p.email !== undefined || p.phone !== undefined;
      else {
        if (p.email !== undefined) person.email = p.email;
        if (p.phone !== undefined) person.phone = p.phone;
      }
      return person;
    });
    return { title: group.title, people, ...(hidden ? { detailsHidden: true } : {}) };
  });
}

/** Keys that hold contact details or identity numbers, by name (the raw shape is not recorded). */
const CONTACT_KEY =
  /e-?mail|phone|mobil|telefon|address|adress|ssn|personal.?(id|number)|personnummer/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A recipient as a display name, or null when it carries none. */
function displayName(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (!isObject(entry)) return null;
  for (const key of ["name", "displayName", "fullName"])
    if (typeof entry[key] === "string") return entry[key];
  const parts = [entry.firstName, entry.lastName].filter((p) => typeof p === "string");
  return parts.length ? parts.join(" ") : null;
}

/** A message as the portal returned it, without other people's contact details. */
export function redactMessage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMessage);
  if (!isObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (CONTACT_KEY.test(key)) continue;
    out[key] =
      key === "recipients" && Array.isArray(inner) ? inner.map(displayName) : redactMessage(inner);
  }
  return out;
}

const ACTIVITY_FIELDS = [
  "id",
  "date",
  "title",
  "author",
  "text",
  "summary",
  "images",
  "recipients",
  "comments",
] as const satisfies readonly (keyof ActivityEntry)[];

export function redactActivityEntry(entry: ActivityEntry): ActivityEntry {
  const out: Record<string, unknown> = {};
  for (const key of ACTIVITY_FIELDS) if (entry[key] !== undefined) out[key] = entry[key];
  return out as unknown as ActivityEntry;
}

export interface RedactionOptions {
  /** The user's explicit opt-in to other families' e-mail and phone in contact lists. */
  contactDetails: boolean;
}

/** The portal with other families' data reduced; a plain object, so hosts may spread it. */
export function withThirdPartyRedaction(portal: Portal, o: RedactionOptions): Portal {
  const out: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const capability of CAPABILITIES) {
    const fn = (portal as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[
      capability
    ];
    out[capability] = (...args) => fn.apply(portal, args);
  }
  const redacted: Pick<Portal, (typeof THIRD_PARTY_CAPABILITIES)[number]> = {
    getContacts: async () => redactContacts(await portal.getContacts(), o.contactDetails),
    getMessage: async (userId, orgId, id) =>
      redactMessage(await portal.getMessage(userId, orgId, id)),
    getActivityLog: async (limit) => (await portal.getActivityLog(limit)).map(redactActivityEntry),
  };
  return { ...out, ...redacted } as unknown as Portal;
}
