---
title: Other families' data
type: feature
created: 2026-09-28
status: in-review
route: dispatch
context:
  - AGENTS.md
  - docs/getting-started/data-handling.md
  - docs/development/stability.md
  - docs/planning/specs/2026-09-21-session-longevity.md
  - https://github.com/grimen/schoolsoft-agent/issues/64
---

# Other families' data (E10.4)

`get_contacts` returns the class contact list: other pupils and, where the school publishes them, other guardians, with e-mail and phone. The answer goes to the assistant's company (Anthropic, OpenAI: processing that can take place outside the EU/EEA), and the read cache kept it in memory for 6 hours. `get_message` returns the full message with its recipients as SchoolSoft sends them, and `get_activity_log` names each post's recipients. None of these families chose to send anything to an AI provider. This spec decides what the project sends and keeps about them. It is the first item of #64 and must be settled before the family app (E11, #39) shows messages or contacts.

> **Not legal advice.** This is an engineering interpretation of the rules below, written by the project to guide its defaults. It has not been reviewed by a lawyer or by IMY. Until the open item in [Open questions](#open-questions) is closed, the project must not tell parents that it is "GDPR-compliant" or "approved"; it may say what it does and why.

<frozen-after-approval>

## The rules the design follows

The project is used in Sweden, so Swedish law applies: the EU General Data Protection Regulation (GDPR, Regulation (EU) 2016/679), which applies directly, supplemented by the Swedish Data Protection Act (lag (2018:218) med kompletterande bestämmelser till EU:s dataskyddsförordning, "dataskyddslagen"). The supervisory authority is IMY (Integritetsskyddsmyndigheten).

| Principle | Source | What it asks of this design |
| --- | --- | --- |
| Data minimisation | GDPR Art. 5(1)(c) | Personal data "adequate, relevant and limited to what is necessary". A question about the class is answered with names and roles; other families' e-mail and phone are needed only when the parent wants to contact them. |
| Storage limitation | GDPR Art. 5(1)(e) | Kept no longer than necessary. Another family's data is not needed after the answer that fetched it. |
| Data protection by default | GDPR Art. 25(2) | By default only the data necessary for each purpose, in amount, extent, storage period and accessibility. The reveal is an explicit choice, off by default. |
| Transfers outside the EU/EEA | GDPR Chapter V (Art. 44 onwards); IMY: making data available to a recipient outside the EU/EEA is a transfer | What reaches the assistant may be processed outside the EU/EEA, under the AI provider's terms. The other families are not involved. Sending less is the only lever this project holds. |
| Household exemption | GDPR Art. 2(2)(c), Recital 18; IMY on when GDPR does not apply | A parent's own use may be "purely personal or household activity". The exemption is read narrowly (CJEU C-101/01 *Lindqvist*, C-212/13 *Ryneš*), Recital 18 keeps the GDPR applicable to those who provide the means, and a parent who shares an answer onwards may leave it. **The design does not rely on the exemption**: every default below holds as if the GDPR applied to the parent's use. |
| Protected personal data | Skatteverket: sekretessmarkering, skyddad folkbokföring, fingerade personuppgifter | Never leak or combine data about people with protected personal data. The project cannot see who is protected, so it must never enrich, join, persist or re-publish contact data beyond what the school itself shows the parent. |

Sources (checked 2026-09-28):

- GDPR, consolidated text: <https://eur-lex.europa.eu/eli/reg/2016/679/oj>; Art. 5 <https://gdpr-info.eu/art-5-gdpr/>, Art. 25 <https://gdpr-info.eu/art-25-gdpr/>, Recital 18 <https://gdpr-info.eu/recitals/no-18/>.
- Dataskyddslagen (SFS 2018:218), ch. 1 § 1 ("kompletterar" the GDPR): <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2018218-med-kompletterande-bestammelser-till_sfs-2018-218/>.
- IMY, when the GDPR does not apply to private individuals: <https://www.imy.se/privatperson/dataskydd/introduktion-till-gdpr/nar-gdpr-inte-galler/>.
- IMY, what a transfer to a third country is: <https://www.imy.se/vanliga-fragor-och-svar/vad-menas-med-overforing-till-tredjeland/>, and transfers in general: <https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/overforing-till-tredje-land/>.
- CJEU C-101/01 *Lindqvist* (2003) and C-212/13 *Ryneš* (2014) on the narrow household exemption: <https://curia.europa.eu/juris/liste.jsf?num=C-101/01>, <https://curia.europa.eu/juris/liste.jsf?num=C-212/13>.
- Skatteverket, protected personal data: <https://www.skatteverket.se/privat/folkbokforing/skyddadepersonuppgifter.4.18e1b10334ebe8bc80001711.html>.

## 1. Contacts are redacted by default

`get_contacts` keeps every group and person the page shows, but for **other families** each person is `{ name, role }` only: no e-mail, no phone. A group whose people were reduced says so with `detailsHidden: true`, so the assistant can tell the parent why and how to change it. An address is never returned, redacted or not: the extractor does not read it, and the redaction keeps only the four known fields (`name`, `role`, `email`, `phone`), so a future extractor field cannot pass through unnoticed.

"Other families" is every group the redaction does not recognise as staff. Staff is recognised by the group's heading alone, compared whole and case-insensitively: `Personal`, `Skolpersonal`, `Lärare`, `Mentor`, `Mentorer`, `Staff`, `Teacher`, `Teachers`. A heading the redaction does not know, including a new wording SchoolSoft introduces, is treated as families: the failure mode is too little, never too much.

**Judgment call for the owner: staff keep their work e-mail and phone.** Teachers and school staff listed under the staff heading are the school's official contacts. The school publishes these work details to guardians so that guardians can reach it; a municipal school's staff contact details are in general public records under the principle of public access (offentlighetsprincipen, Tryckfrihetsförordningen ch. 2), and hiding them would stop the most common use ("mejla mentorn") for little gain. Private details of staff never appear on this page. The other reading, redacting staff too, is one line in the redaction and a documented default change.

## 2. An explicit opt-in reveals other families' contact details

The reveal covers `get_contacts` only: other families' e-mail and phone. It never covers addresses, message recipients or activity-log recipients.

- **Locally (CLI, MCP server, Claude Desktop extension):** the setting `contactDetails` (`config.json`) / `SCHOOLSOFT_CONTACT_DETAILS` (environment), a switch like `allowWrites`: off unless it is `1`, `true`, `yes` or `on`; anything unrecognised is an error, never a silent "on". The documentation carries the warning: turning it on sends other people's e-mail addresses and phone numbers to your AI provider, without their involvement, possibly outside the EU. The guided first run (`setup`) says that contact details are hidden and names the setting and the warning, next to "what you ask about is sent to the assistant's company".
- **On the connector:** a separate OAuth scope, `get_contacts_details`. It extends `get_contacts` and grants nothing without it. Its name follows the stability policy's scope naming (one scope per operation name), with the operation name and a `_details` suffix, so it can never collide with an operation. On the consent page it has its own section after the tool list, **unticked** (every operation scope stays ticked, as today), with the warning: "This sends other families' e-mail addresses and phone numbers to your AI provider. They have not agreed to it." Approving a detail scope without its operation drops it. Consent can never be gained by refresh: a refresh may only ask for a subset of the grant's current scopes (existing behaviour, now tested for this scope). The connector ignores the local setting; only the grant decides. The flag is evaluated per request from the token's scopes and handed to the portal for that request.

The connector does not offer `get_contacts` today (it has no browser, and its REST surface serves typed operations only), so today the connector offers no detail scope: a detail scope is offered only when its operation is offered, and nothing changes in `scopesSupported`. The machinery (the scope table, the consent section, approval, refresh, and the per-request flag) is built and tested now so that the family app (E11) cannot add contacts without it.

## 3. Messages and the activity log keep their content, lose contact details

- `get_message`: every entry of `recipients` becomes a display name (a string: its `name`, `displayName`, `fullName`, or `firstName lastName`; an entry without any becomes `null`). Anywhere in the message, sender included, keys that hold contact details are removed: e-mail, phone, mobile, address, personal identity number (matched by name, e.g. `email`, `eMail`, `phoneNumber`, `mobile`, `address`, `ssn`, `personalNumber`, `personnummer`). SchoolSoft's exact field list for this answer is not recorded, which is why the rule is by key name and not by a fixed shape.
- `get_activity_log`: recipients are already one names string from SchoolSoft, and `comments` is a count, not the comments. The redaction keeps only the known fields of an entry, so nothing else can pass.

**Judgment call for the owner: bodies stay.** The message text, the post text and their subjects are what the parent asked to read; they may mention other people, and an e-mail address typed into a message body is sent as written. Redacting free text would be unreliable and would break the tool's purpose. The data-handling page says so.

## 4. The read cache never holds other families' data

`getContacts` and `getActivityLog` are never cached, whatever the TTL table says, the same way the web-session capabilities are refused (`never` in the cache decorator); `getMessage` was never cached. Before, contacts were kept 6 hours and the activity log 10 minutes. Caching only a redacted form was the alternative; it was rejected because the redacted form still holds other families' names (and the activity log's recipients), a shared cache would have to be keyed by the reveal flag to stay correct on a connector with several grants, and both reads are rare enough that asking SchoolSoft again costs little. The cost: a follow-up question about the contact list opens the page again (a few seconds with the headless browser).

## 5. One boundary, every surface

The redaction is a core Portal decorator (`src/core/portal/third-party.ts`) applied inside `createPortals` (`src/core/wiring.ts`), below the read cache and above session recovery, for both the cached and the `fresh` portal. `createPortals` is how every surface gets a portal: the local CLI and MCP server through `src/shared/bootstrap.ts`, the connector's MCP and REST through `ConnectorRuntime`. Its option `contactDetails` defaults to off, so a surface that forgets to pass it redacts. Operations are unchanged; they never see an unredacted answer.

A boundary test proves it: portals from `createPortals` redact all three capabilities, with and without `fresh`; the reveal changes contacts only; no adapter under `src/cli`, `src/mcp`, `src/http` or `src/shared` builds a composite portal itself or reads one of these capabilities from `createApiPortal`.

</frozen-after-approval>

## Compatibility

- `get_contacts`, `get_message` and `get_activity_log` are untyped operations (no `outputSchema`, E4.5). Under the stability policy their output is "not a contract", so removing e-mail and phone is not a breaking change and is not marked `!`. Were they typed, the policy's privacy exception ("a security or privacy problem ... may be removed without notice. It is still marked breaking") would apply and the change would be marked breaking.
- `contactDetails` / `SCHOOLSOFT_CONTACT_DETAILS` is a new setting: compatible. Its default (off) is observable and is now part of the contract; making it on by default would be a default that sends more on the user's behalf and is never done.
- `get_contacts_details` is a new scope, offered only when the connector offers `get_contacts`. The stability page names detail scopes next to the operation scopes.
- Cache TTLs are tuning values, not a contract.
- `get_contacts` and `get_activity_log` keep their `fresh` input, because removing an input is breaking. It is accepted and changes nothing: both are always read from SchoolSoft.

## Open questions

1. **Legal review (blocking any compliance claim).** A review by someone with Swedish data-protection expertise, or against IMY guidance, before parents are told the project's handling is compliant. Points to check: whether the household exemption can be relied on at all for a parent's assistant use; whether the staff judgment call holds for independent schools (friskolor), where the principle of public access does not apply in the same way; whether opt-in by one guardian is a sufficient safeguard for the reveal.
2. **Protected identities.** It is not known whether SchoolSoft leaves pupils and guardians with protected personal data out of the contact list. The project cannot detect them. The school is responsible for its lists; the project's safeguard is that it never persists, combines or enriches the data.
3. **Staff contacts** (section 1) and **message bodies** (section 3) are owner decisions recorded above.
4. **The connector's contacts.** When E11 brings `get_contacts` (or messages) to the connector, `get_contacts_details` becomes visible on the consent page; the consent wording should be reviewed then with a real parent.

## Tasks & Acceptance

- [x] Redaction decorator: families reduced, staff kept, unknown headings reduced, address never returned, `detailsHidden` set; reveal keeps e-mail and phone for families only.
- [x] Messages: recipients to display names, contact keys removed at any depth, body kept. Activity log: known fields only.
- [x] Cache: contacts and activity log never cached, even with a TTL.
- [x] Setting `contactDetails` / `SCHOOLSOFT_CONTACT_DETAILS`: off by default, strict switch; `setup` mentions it.
- [x] Connector: `get_contacts_details` offered only with `get_contacts`, unticked with the warning, dropped without its operation, not gained by refresh, passed per request to the portal.
- [x] Boundary test: every surface's portal redacts; adapters cannot bypass.
- [x] Data-handling, architecture, stability and generated reference docs match; #64's first box ticked.

## Verification

See the pull request for the gate results.
