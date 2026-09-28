/**
 * Other families' data (docs/planning/specs/2026-09-28-other-families-data.md):
 * contact lists, message recipients and activity-log entries are reduced at the
 * portal boundary. Synthetic data only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GUARDIAN_WORDS,
  PUPIL_WORDS,
  STAFF_GROUP_HEADINGS,
  isGuardian,
  THIRD_PARTY_CAPABILITIES,
  isStaffGroup,
  redactActivityEntry,
  redactContacts,
  redactMessage,
  withThirdPartyRedaction,
} from "../../src/core/portal/third-party.js";
import { CAPABILITIES, type ContactGroup, type Portal } from "../../src/core/portal/types.js";
import { fakePortal } from "../helpers/fakes.js";
import { envSource, resolveConfig } from "../../src/core/config.js";

const CLASS_LIST: ContactGroup[] = [
  {
    title: "Elever",
    people: [
      { name: "Anna Exempel", role: "", email: "anna@example.test" },
      { name: "Bertil Exempel", role: "", phone: "070-000 00 00" },
      { name: "Cecilia Exempel", role: "" },
    ],
  },
  {
    title: "Vårdnadshavare",
    people: [
      {
        name: "Doris Exempel",
        role: "Vårdnadshavare till Anna",
        email: "doris@example.test",
        phone: "070-111 11 11",
      },
    ],
  },
  {
    title: " Personal ",
    people: [
      {
        name: "Lärare Exempel",
        role: "Mentor",
        email: "larare@skola.example",
        phone: "08-123 45 67",
      },
    ],
  },
  { title: "Övriga", people: [{ name: "Ernst Exempel", role: "", email: "ernst@example.test" }] },
];

test("contacts: other families keep name and role only, and the group says details are hidden", () => {
  const [pupils, guardians, staff, unknown] = redactContacts(CLASS_LIST, false);
  assert.deepEqual(pupils, {
    title: "Elever",
    detailsHidden: true,
    people: [
      { name: "Anna Exempel", role: "" },
      { name: "Bertil Exempel", role: "" },
      { name: "Cecilia Exempel", role: "" },
    ],
  });
  assert.deepEqual(guardians.people, [{ name: "Doris Exempel", role: "Vårdnadshavare till Anna" }]);
  assert.equal(guardians.detailsHidden, true);
  // Staff are the school's official contacts: work e-mail and phone stay (spec, section 1).
  assert.deepEqual(staff, CLASS_LIST[2]);
  // A heading the redaction does not know is treated as families: fail closed.
  assert.deepEqual(unknown, {
    title: "Övriga",
    detailsHidden: true,
    people: [{ name: "Ernst Exempel", role: "" }],
  });
});

test("contacts: a group with nothing to hide is not marked", () => {
  assert.deepEqual(
    redactContacts([{ title: "Elever", people: [{ name: "A", role: "" }] }], false),
    [{ title: "Elever", people: [{ name: "A", role: "" }] }],
  );
});

test("contacts: the opt-in reveals a guardian's e-mail and phone, never anything else such as an address", () => {
  const withExtra = [
    {
      title: "Vårdnadshavare",
      people: [
        { name: "Doris", role: "", email: "d@example.test", address: "Exempelgatan 1" },
        { name: "Bo", role: "Förälder", phone: "070" },
      ],
    },
  ] as unknown as ContactGroup[];
  assert.deepEqual(redactContacts(withExtra, true), [
    {
      title: "Vårdnadshavare",
      people: [
        { name: "Doris", role: "", email: "d@example.test" },
        { name: "Bo", role: "Förälder", phone: "070" },
      ],
    },
  ]);
  assert.deepEqual(redactContacts(withExtra, false)[0].people[0], { name: "Doris", role: "" });
});

test("contacts: with the opt-in on, pupils and unknown roles stay hidden; guardians and staff show (R1)", () => {
  const [pupils, guardians, staff, unknown] = redactContacts(CLASS_LIST, true);
  // A pupil's own e-mail and phone never pass, whatever the setting.
  assert.deepEqual(pupils, {
    title: "Elever",
    detailsHidden: true,
    people: [
      { name: "Anna Exempel", role: "" },
      { name: "Bertil Exempel", role: "" },
      { name: "Cecilia Exempel", role: "" },
    ],
  });
  assert.deepEqual(guardians, CLASS_LIST[1]);
  assert.deepEqual(staff, CLASS_LIST[2]);
  // Neither heading nor role says guardian: withheld (fail closed).
  assert.deepEqual(unknown, {
    title: "Övriga",
    detailsHidden: true,
    people: [{ name: "Ernst Exempel", role: "" }],
  });
});

test("contacts: the person's role decides before the heading; a mixed or unknown one withholds", () => {
  const person = (role: string) => ({ name: "X", role, email: "x@example.test" });
  const shown = (title: string, role: string) =>
    redactContacts([{ title, people: [person(role)] }], true)[0].people[0].email !== undefined;
  // Guardians, by role or by heading, in Swedish or English.
  assert.equal(shown("Elever", "Vårdnadshavare till Anna"), true);
  assert.equal(shown("Klass 4B", "Förälder"), true);
  assert.equal(shown("Klass 4B", "målsman"), true);
  assert.equal(shown("Guardians", ""), true);
  assert.equal(shown("Klass 4B", "Parent"), true);
  assert.equal(shown("Vårdnadshavarna", ""), true);
  // Pupils, by role or by heading, even under a guardians heading.
  assert.equal(shown("Vårdnadshavare", "Elev"), false);
  assert.equal(shown("Klass 4B", "Student"), false);
  assert.equal(shown("Pupils", ""), false);
  assert.equal(shown("Barn", ""), false);
  // Both at once, in one role or in the heading alone: ambiguous, withheld.
  assert.equal(shown("Vårdnadshavare", "Vårdnadshavare till eleven Anna"), false);
  assert.equal(shown("Elever och vårdnadshavare", ""), false);
  // Neither: unknown, withheld.
  assert.equal(shown("Klass 4B", "Kontaktperson"), false);
  assert.equal(shown("", ""), false);
  assert.equal(shown("Klass 4B", "Mentor"), false);
  // Without the opt-in, a guardian is hidden too.
  assert.equal(
    redactContacts([{ title: "Vårdnadshavare", people: [person("")] }], false)[0].people[0].email,
    undefined,
  );
});

test("contacts: staff headings keep work details whatever the person's role says", () => {
  const assistant = { name: "Y", role: "Elevassistent", email: "y@skola.example" };
  for (const reveal of [false, true])
    assert.deepEqual(redactContacts([{ title: "Personal", people: [assistant] }], reveal), [
      { title: "Personal", people: [assistant] },
    ]);
});

test("guardians are recognised by word, compared case-insensitively", () => {
  for (const word of GUARDIAN_WORDS) assert.equal(isGuardian(word.toUpperCase(), ""), true, word);
  for (const word of PUPIL_WORDS) assert.equal(isGuardian(word, "Vårdnadshavare"), false, word);
  assert.equal(isGuardian("", "Vårdnadshavare"), true);
  assert.equal(isGuardian("", ""), false);
});

test("staff headings are compared whole and case-insensitively", () => {
  for (const heading of STAFF_GROUP_HEADINGS) {
    assert.ok(isStaffGroup(heading), heading);
    assert.ok(isStaffGroup(` ${heading.toUpperCase()} `), heading);
  }
  for (const heading of ["Personal och elever", "Elever", "Vårdnadshavare", "", "Klass 4B"])
    assert.equal(isStaffGroup(heading), false, heading);
});

test("messages: recipients become display names; contact keys go at any depth; the body stays", () => {
  const raw = {
    id: 5,
    subject: "Utflykt",
    message: "Ring mig på 070-000 00 00 om något händer.",
    sender: { id: 77, firstName: "Lärare", lastName: "Exempel", email: "larare@skola.example" },
    recipients: [
      {
        id: 1,
        firstName: "Doris",
        lastName: "Exempel",
        email: "doris@example.test",
        mobile: "070",
      },
      { name: "Klass 4B", phoneNumber: "08" },
      { displayName: "Ernst Exempel" },
      { fullName: "Frida Exempel" },
      { firstName: "Gustav" },
      "Helga Exempel",
      { id: 9 },
      42,
    ],
    attachments: [{ name: "brev.pdf", url: "https://example.test/brev.pdf" }],
    meta: {
      eMail: "x@example.test",
      homeAddress: "Exempelgatan 1",
      personnummer: "000000-0000",
      ssn: "0",
      personalNumber: "0",
      telefon: "0",
      nested: [{ emailAddress: "y@example.test", keep: true }],
    },
  };
  assert.deepEqual(redactMessage(raw), {
    id: 5,
    subject: "Utflykt",
    message: "Ring mig på 070-000 00 00 om något händer.",
    sender: { id: 77, firstName: "Lärare", lastName: "Exempel" },
    recipients: [
      "Doris Exempel",
      "Klass 4B",
      "Ernst Exempel",
      "Frida Exempel",
      "Gustav",
      "Helga Exempel",
      null,
      null,
    ],
    attachments: [{ name: "brev.pdf", url: "https://example.test/brev.pdf" }],
    meta: { nested: [{ keep: true }] },
  });
});

test("messages: shapes other than an object pass through; recipients that are not a list are scrubbed", () => {
  assert.equal(redactMessage(null), null);
  assert.equal(redactMessage("text"), "text");
  assert.deepEqual(redactMessage({ recipients: { name: "Klass 4B", email: "k@example.test" } }), {
    recipients: { name: "Klass 4B" },
  });
});

test("activity log: only the known fields of an entry pass", () => {
  const entry = {
    id: 1,
    date: "2026-09-01T08:00:00.000Z",
    title: "Utflykt",
    author: "Lärare Exempel",
    text: "Vi var i skogen.",
    summary: "Skogen",
    images: 2,
    recipients: "Klass 4B",
    comments: 3,
    authorEmail: "larare@skola.example",
  };
  const { authorEmail: _dropped, ...kept } = entry;
  assert.deepEqual(redactActivityEntry(entry), kept);
  assert.deepEqual(redactActivityEntry({ id: 2, date: "d", title: "t", text: "", comments: 0 }), {
    id: 2,
    date: "d",
    title: "t",
    text: "",
    comments: 0,
  });
});

test("the decorator redacts the three capabilities and passes every other one through", async () => {
  const calls: string[] = [];
  const upstream = Object.fromEntries(
    CAPABILITIES.map((capability) => [
      capability,
      async (...args: unknown[]) => {
        calls.push(`${capability}(${args.join(",")})`);
        return (fakePortal as unknown as Record<string, (...a: unknown[]) => unknown>)[capability](
          ...args,
        );
      },
    ]),
  ) as unknown as Portal;
  const full = {
    ...upstream,
    getContacts: async () => CLASS_LIST,
    getMessage: async (_u: number, _o: number, id: number) => ({
      id,
      recipients: [{ name: "Doris", email: "d@example.test" }],
    }),
    getActivityLog: async () => [
      { id: 1, date: "d", title: "t", text: "x", comments: 0, extra: "no" } as never,
    ],
  };
  const redacted = withThirdPartyRedaction(full, { contactDetails: false });
  const revealed = withThirdPartyRedaction(full, { contactDetails: true });
  assert.equal((await redacted.getContacts())[0].people[0].email, undefined);
  assert.equal((await redacted.getContacts())[1].people[0].email, undefined);
  assert.equal((await revealed.getContacts())[0].people[0].email, undefined);
  assert.equal((await revealed.getContacts())[1].people[0].email, "doris@example.test");
  for (const portal of [redacted, revealed]) {
    assert.deepEqual(await portal.getMessage(1, 2, 3), { id: 3, recipients: ["Doris"] });
    assert.deepEqual(await portal.getActivityLog(5), [
      { id: 1, date: "d", title: "t", text: "x", comments: 0 },
    ]);
  }
  // Every other capability is the upstream's, with its arguments.
  assert.deepEqual(
    await redacted.getLunchWeek(20, 36, 2026),
    await fakePortal.getLunchWeek(20, 36, 2026),
  );
  assert.deepEqual(calls, ["getLunchWeek(20,36,2026)"]);
  // A plain object, so hosts can spread it (the connector's guard does).
  assert.deepEqual(Object.keys(redacted).sort(), [...CAPABILITIES].sort());
  assert.deepEqual([...THIRD_PARTY_CAPABILITIES], ["getContacts", "getMessage", "getActivityLog"]);
});

test("contactDetails is off unless a source says yes; nonsense is an error, never 'on'", () => {
  const resolve = (env: Record<string, string>, file: { contactDetails?: boolean | string } = {}) =>
    resolveConfig([envSource(env), { school: "testskola", ...file }], {
      home: "/home/synthetic",
      platform: "linux",
    }).contactDetails;
  assert.equal(resolve({}), false);
  assert.equal(resolve({ SCHOOLSOFT_CONTACT_DETAILS: "" }), false);
  for (const yes of ["1", "true", "YES", " on "])
    assert.equal(resolve({ SCHOOLSOFT_CONTACT_DETAILS: yes }), true, yes);
  assert.equal(resolve({ SCHOOLSOFT_CONTACT_DETAILS: "0" }, { contactDetails: true }), false);
  assert.equal(resolve({}, { contactDetails: true }), true);
  assert.throws(
    () => resolve({ SCHOOLSOFT_CONTACT_DETAILS: "maybe" }),
    /contactDetails .*not a switch/,
  );
});
