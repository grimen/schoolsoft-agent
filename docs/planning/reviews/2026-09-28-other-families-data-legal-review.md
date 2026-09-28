---
title: Other families' data, legal review
type: review
created: 2026-09-28
status: done
reviews: docs/planning/specs/2026-09-28-other-families-data.md
context:
  - docs/getting-started/data-handling.md
  - https://github.com/grimen/schoolsoft-agent/pull/74
  - https://github.com/grimen/schoolsoft-agent/issues/64
---

# Other families' data: legal review (E10.4)

> **Not legal advice.** This is a research-based compliance review, written without legal
> training. It reads the design in the [other families' data spec](../specs/2026-09-28-other-families-data.md),
> as built in [PR #74](https://github.com/grimen/schoolsoft-agent/pull/74), against EU and
> Swedish data-protection law, as applied in Sweden. Every legal statement below cites a
> primary or authoritative source, checked on 2026-09-28. The conclusions are the reviewer's
> reading of those sources. They are not an opinion from a lawyer, a data protection officer
> (dataskyddsombud) or IMY. **A qualified Swedish data-protection lawyer or DPO must confirm
> them before the project makes any public compliance claim** ("GDPR-compliant", "approved"
> or similar). The [questions](#questions-for-a-lawyer-or-dpo) at the end are written for
> that person.

## Summary

| Area                                                                  | Conclusion                         |
| --------------------------------------------------------------------- | ---------------------------------- |
| [Roles](#1-roles)                                                     | Consistent with the law            |
| [Household exemption](#2-the-household-exemption)                     | Uncertain (the design does not rely on it) |
| [Lawful basis and the one-guardian opt-in](#3-lawful-basis-if-the-exemption-does-not-apply) | Default: consistent. Reveal: uncertain |
| [Minimisation, storage limitation, privacy by default](#4-principles) | Consistent with the law            |
| [Transfers outside the EU/EEA](#5-transfers-outside-the-eueea)        | Consistent for the project; uncertain for some operator set-ups |
| [Children's data](#6-childrens-data)                                  | Default: consistent. Reveal of pupils' own details: gap |
| [Swedish specifics](#7-swedish-specifics)                             | Consistent with the law            |
| [Transparency toward other families](#8-transparency)                 | Uncertain                          |
| [Residual risks](#9-residual-risks)                                   | Documented; two small gaps         |

"Consistent with the law" means consistent as the reviewer reads it. "Uncertain" means the law
or its application to this situation is unsettled, and a lawyer should look. "Gap" means the
reviewer found something the design should change.

The main findings:

- The default (names and roles only for other families, no caching, no addresses, no contact
  details in messages) is a strong application of data minimisation and data protection by
  default. It holds whether or not the household exemption applies.
- One guardian's opt-in **is not a lawful basis** for processing other families' data, and it
  is not their consent. It is the parent's own decision as the one who decides the processing,
  and a good safeguard that makes that decision deliberate. Whether it is enough depends on a
  balancing of interests. That balance is weakest for pupils' own contact details, which the
  reveal currently includes if the school lists them. The reviewer recommends leaving them out
  (a code change, listed for the owner).
- For independent schools (friskolor), the principle of public access (offentlighetsprincipen)
  starts to apply on **1 January 2027** (SFS 2026:714). That largely closes the staff-contact
  follow-up. The staff decision stands on the GDPR analysis either way.

## Scope and method

**Reviewed:** the spec (as of this commit), PR #74's body, `src/core/portal/third-party.ts`
(the staff heading list and the redaction) and
[How your family's data is handled](../../getting-started/data-handling.md).

**Not reviewed:** the rest of the code, the school's own processing, SchoolSoft's contracts, and
the AI providers' contracts beyond their public privacy terms.

**Sources.** EU legislation and CJEU judgments were read in full text from EUR-Lex (fetched
through the EU Publications Office's content service for the same CELEX numbers). Swedish
statutes were read on riksdagen.se, guidance on imy.se and edpb.europa.eu. The AI providers'
terms were read on their websites. OpenAI's pages refused automated retrieval, so its terms are
summarised from its help centre and from search-indexed text, and should be read again by hand.
The full list is in [Sources](#sources).

## The processing under review

| Flow                                      | Personal data about others                                                                                                             | As built in PR #74                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `get_contacts`                            | Classmates and, where the school lists them, their guardians: name, role, e-mail, phone. Staff: name, role, work e-mail and phone.       | Other families: name and role only (`detailsHidden: true`). Staff groups (recognised by heading) keep work e-mail and phone. No address, ever. |
| `get_message`                             | Sender, recipients, and whatever the text says.                                                                                        | Recipients become names. Contact keys (e-mail, phone, address, identity number) removed at any depth. Text and subject kept.             |
| `get_activity_log`                        | Teachers' posts, recipients as one names string, comment count.                                                                        | Only known fields kept.                                                                                                                 |
| Read cache                                | —                                                                                                                                      | Contacts, activity log and messages are never cached.                                                                                   |
| Reveal (`contactDetails` / `get_contacts_details`) | Other families' e-mail and phone.                                                                                              | Off by default. Local: a strict switch. Connector: a separate, unticked OAuth scope, not gained by refresh. The connector does not offer `get_contacts` yet. |

Everything a tool returns goes to the assistant's provider (for example Anthropic or OpenAI).
The project itself keeps nothing of it and sends nothing to its author.

## 1. Roles

**The law.** The controller (personuppgiftsansvarig) is whoever "alone or jointly with others,
determines the purposes and means of the processing" (GDPR Art. 4(7)). Joint controllers
jointly determine purposes and means (Art. 26(1)). Joint responsibility "does not require each
of them to have access to the personal data" (C-25/17 _Jehovan todistajat_, para. 69;
C-210/16 _Wirtschaftsakademie_, para. 38) and "does not necessarily imply equal
responsibility" (_Wirtschaftsakademie_, para. 43). A party is a controller only "in respect of
operations ... for which it determines jointly the purposes and means", not for earlier or later
operations in the chain (C-40/17 _Fashion ID_, paras. 74 and 85). An entity that commissioned an
app and took part in deciding its purposes and means can be a controller even without
processing any data itself (C-683/21, 5 December 2023, ruling 1). The GDPR applies to "controllers
or processors which provide the means for processing personal data" for household activities
(Recital 18, third sentence).

| Party                                   | Role, as the reviewer reads it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The school's governing body (huvudman)** | Controller for the school's data in SchoolSoft, including the decision to show guardians a class contact list. IMY: "Det är skolans huvudman som är personuppgiftsansvarig"; for a municipal school, the responsible committee (nämnd). SchoolSoft AB is normally the school's processor (personuppgiftsbiträde); the reviewer did not see SchoolSoft's contract terms.                                                                                                                                                                                                                                              |
| **A parent using the tool locally**     | If the GDPR applies to them (see [section 2](#2-the-household-exemption)), the parent is the controller for fetching the data from SchoolSoft and disclosing it to their AI provider: the parent chooses the purpose (their own family's school questions) and the essential means (this tool, which assistant, whether to turn on the reveal). If the household exemption applies, the GDPR does not apply to the parent's processing at all.                                                                                                                                                                                  |
| **A parent operating a self-hosted connector** | The same as above, for the same parent. The hosting company is the parent's processor where the GDPR applies. Someone who runs a connector for **another** family is no longer in a household setting, and would be that family's processor or a controller in their own right.                                                                                                                                                                                                                                                                                                                                          |
| **The AI provider**                     | The recipient. With a consumer account (Claude Free/Pro/Max, ChatGPT Free/Plus/Pro), the provider says it is the controller: Anthropic Ireland, Limited and OpenAI Ireland Limited for users in the EEA. It is then an independent controller of what it receives, bound by the GDPR regardless of the user's exemption (Recital 18). With a business or API account, the provider is as a starting point a processor under a data processing agreement (Anthropic's DPA: "Customer is the controller and Anthropic is Customer's processor"; IMY's generative AI guidance says the same of business accounts). |
| **The project author**                  | Distributes open-source software. Runs no service, receives no data and decides neither why nor whether any parent runs it. Under _Fashion ID_ para. 74, a party is a controller only for the operations whose purposes and means it determines; here each parent decides. C-683/21 is distinguishable: the commissioning entity there wanted the app for its own purpose (its public-health task), while the author has no purpose of their own in a parent's use. The author is best seen as a producer, whom Recital 78 "encourage[s]" to design for data protection. The defaults in PR #74 do exactly that. |
| **The author as a parent and developer** | A separate case. When the owner runs the tool on their own family's login to develop and test it (the [live session](../../development/live-session.md), `make e2e`, `make capture`), the purpose is software development, not family life. Testing with real data is "processing" (C-683/21, ruling 3). That activity is probably outside the household exemption, so the owner is the controller for it (see [section 9](#9-residual-risks)). |

**Joint controllership between the parent and the AI provider.** Where the GDPR applies, the
parent and a consumer AI provider could be argued to be joint controllers for the transmission
itself, by analogy with _Fashion ID_ (the site operator and Facebook were joint controllers
for collecting and transmitting visitor data). Under _Fashion ID_ para. 74, that would not make
the parent responsible for what the provider does afterwards (retention, training). The
practical difference for a private parent is small; the question is listed for the lawyer.

**Conclusion: consistent with the law.** The data-handling page already says the author
receives nothing and that the AI provider handles data under its own terms. The live session
is the one context where the author's role differs (see [section 9](#9-residual-risks)).

## 2. The household exemption

**The law.** The GDPR does not apply to processing "by a natural person in the course of a
purely personal or household activity" (Art. 2(2)(c)), which means "with no connection to a
professional or commercial activity" and "could include correspondence and the holding of
addresses, or social networking and online activity undertaken within the context of such
activities" (Recital 18). The CJEU reads it narrowly:

- It covers "only ... activities which are carried out in the course of private or family life
  of individuals", which is "clearly not the case" when data are published on the internet and
  "made accessible to an indefinite number of people" (C-101/01 _Lindqvist_, para. 47).
- It "must be narrowly construed"; the word "purely" matters (C-212/13 _Ryneš_, paras. 29–30).
  But "correspondence and the keeping of address books constitute ... a 'purely personal or
  household activity' even if they incidentally concern or may concern the private life of
  other persons" (para. 32). A camera that covers public space is outside it (para. 33).
- "Personal or household" refers to "the activity of the person processing the personal data
  and not to the person whose data are processed" (C-25/17 _Jehovan todistajat_, para. 41). An
  activity whose purpose is to make data "accessible to an unrestricted number of people" is not
  purely personal (para. 42). A YouTube upload without access limits is not either (C-345/17
  _Buivids_, para. 43).

The Article 29 Working Party (the EDPB's predecessor) proposed five indicative criteria, none
decisive on its own: dissemination to an indefinite number of people rather than a limited
circle; data about people with no personal or household relationship to the person; scale and
frequency suggesting professional activity; people acting together in an organised way; and the
potential adverse impact on individuals. IMY's guidance for private individuals gives the same
picture: a private address book or pictures shared with "ett begränsat antal personer via
sociala medier" are exempt; an address book with "stor spridning", or pictures that can reach
"ett obegränsat antal personer", are not. The reviewer found no EDPB guideline, CJEU judgment or
IMY statement on an individual using an AI assistant.

**Application to a parent.** A parent reading their own child's schedule, messages and class
list, and contacting other guardians about the class, is ordinary family life. A class contact
list kept for that purpose is close to the address book that _Ryneš_ para. 32 and Recital 18
name. The five criteria mostly point to the exemption: the data go to the parent and one
service they chose, not to an indefinite number of people; the other families are part of the
child's class; the scale is one family's; there is no organisation; and the default output
(names and roles) has low potential for harm.

**What changes when the data go to an AI provider.** Two readings are defensible:

1. **The exemption still applies.** Recital 18 expressly foresees that household users rely on
   service providers ("social networking and online activity"), and answers that by making the
   GDPR apply to the provider, not by removing the user's exemption. The test is the parent's
   activity (_Jehovan todistajat_, para. 41), and sending a question to an assistant is not
   publication. On this reading the AI provider, as a controller, carries the GDPR duties for
   what it does with the data.
2. **The exemption is at risk.** The disclosure is to a company that may keep the data, may use
   them to train models unless the user opts out, and may process them outside the EEA. None of
   that is in the parent's control. The fifth criterion (potential adverse impact) weighs more
   with the reveal on, and much more for children.

The exemption is lost, on either reading, when the parent's activity stops being purely
private: posting answers in a large group chat or online, using the tool for a parents'
association (föräldraförening), for the parent's job (a teacher using it at work), or running a
connector for other families.

**Conclusion: uncertain.** The exemption plausibly covers a parent's own use with the default
output. It is not settled law for AI assistants, and the reveal and children's data make it
weaker. The spec is right not to rely on it: every default holds as if the GDPR applied.

## 3. Lawful basis if the exemption does not apply

**The law.** Processing needs one of the bases in Art. 6(1). Consent is the data subject's own:
"any freely given, specific, informed and unambiguous indication of the data subject's wishes"
(Art. 4(11)). Legitimate interest (Art. 6(1)(f)) needs three cumulative conditions: a
legitimate interest of the controller or a third party, necessity, and a balancing in which the
data subjects' rights do not prevail, "in particular where the data subject is a child" (Art.
6(1)(f); EDPB Guidelines 1/2024, executive summary). The balancing looks at the data subjects'
"reasonable expectations ... based on their relationship with the controller" (Recital 47), the
nature of the data, their accessibility or publicity, and further safeguards (EDPB 1/2024). For
children the balancing "should be recalibrated", and their interests "will very often outweigh"
those of the controller (EDPB 1/2024, paras. 93–94; the version the reviewer read is the one
published for consultation).

**The parent's basis.** The only realistic basis for a private parent is Art. 6(1)(f):

- **Interest:** following one's child's schooling and contacting the class's other families.
  Lawful, precise and present.
- **Necessity:** names and roles are needed to answer questions about the class. E-mail and
  phone are needed only to contact someone. This is exactly the split the default makes.
- **Balancing, default output:** the school itself shows guardians the class list, so other
  families can expect guardians to see names and roles and use them for class matters. Names and
  roles are low-sensitivity data. The balance likely favours the parent.
- **Balancing, reveal:** other families can expect guardians to use their e-mail and phone to
  contact them. They cannot reasonably expect those details to go to an AI company, possibly
  outside the EEA, possibly into training. The balance is closer, and depends on the parent
  turning the reveal on only when they need it.

**Can one guardian's opt-in be the lawful basis?** No. It cannot be the other families' consent
(Art. 4(11)), and a guardian's parental responsibility only extends to their own child. Nor is
the opt-in a basis of its own: it is the moment at which the parent, as the one who decides
the processing, chooses to process more.

**Is the opt-in a sufficient safeguard?** It is a real safeguard: it keeps the default minimal
(Art. 25(2)), puts the decision with a person who can weigh the need, and carries a warning that
names the consequence. The connector version is stronger than the local one: a separate
unticked scope, bound to one app, lasting at most 30 days, never gained by refresh. Two
weaknesses remain:

1. **Pupils' own contact details.** If the school's list shows a pupil's own e-mail or phone,
   the reveal sends them too. Children's data weigh most in the balancing (Art. 6(1)(f);
   Recital 38), and the stated purpose (contacting the class's families) is served by the
   guardians' details. **Gap.** Recommendation R1 below.
2. **The local switch is standing.** Once on, every contact-list answer carries every family's
   details, including answers to questions that do not need them, until the parent turns it
   off. The warning says so, but necessity is judged per purpose. **Uncertain.** Recommendation
   R2 below.

**Conclusion: default consistent with the law; reveal uncertain, with one gap (R1).**

## 4. Principles

| Principle                                     | Requirement                                                                                                                                                                                                                                             | As built                                                                                                                                                                                                                                                                             | Assessment |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Data minimisation (Art. 5(1)(c))              | "adequate, relevant and limited to what is necessary"                                                                                                                                                                                                   | Other families: names and roles. Addresses never. Message recipients: names only; contact keys removed at any depth, including identity numbers. Activity log: known fields only. Unknown staff headings fail closed.                                                             | Consistent |
| Storage limitation (Art. 5(1)(e))             | kept "for no longer than is necessary"                                                                                                                                                                                                                  | Contacts, messages and the activity log are never cached; nothing is written to disk. Retention at the AI provider is outside the project's control and documented as such.                                                                                                        | Consistent |
| Data protection by default (Art. 25(2))       | "by default, only personal data which are necessary for each specific purpose", as to "amount ... extent ... period of their storage and their accessibility"                                                                                            | The reveal is off by default and strict (an unrecognised value is an error, not "on"). On the connector it is a separate, unticked scope. `createPortals` redacts when a surface forgets the option. A boundary test stops adapters from bypassing the redaction.                  | Consistent |
| Purpose limitation (Art. 5(1)(b))             | not processed in a way incompatible with the purpose of collection                                                                                                                                                                                      | The project never combines, enriches or stores the data. It serves the purpose for which the school shows guardians the list.                                                                                                                                                      | Consistent |
| Security (Art. 5(1)(f), Art. 32)              | appropriate security                                                                                                                                                                                                                                    | Out of scope here; the data-handling page describes encryption and the connector's operator duties.                                                                                                                                                                              | Not assessed |

Art. 25 binds controllers, not software producers. The project's design lets any parent who
is a controller meet it without configuration, which is what Recital 78 asks producers to aim
for.

**Conclusion: consistent with the law.**

## 5. Transfers outside the EU/EEA

**The law.** Chapter V applies only when three criteria are met: the exporter "is subject to the
GDPR for the given processing", it discloses or makes data available to another controller or
processor, and that importer "is in a third country" (EDPB Guidelines 05/2021, version 2.0).
IMY likewise defines a transfer as personal data being "skickas eller på annat sätt görs
tillgängliga för en mottagare i ett land utanför EU/EES-området", with reference to those
guidelines. A transfer needs an adequacy decision (Art. 45), appropriate safeguards such as
standard contractual clauses (Art. 46), or a narrow derogation (Art. 49). The CJEU invalidated
the Privacy Shield and required exporters relying on standard clauses to check that the
importer's country allows them to be complied with (C-311/18 _Schrems II_, 16 July 2020).

**The EU–US Data Privacy Framework.** Commission Implementing Decision (EU) 2023/1795 of 10 July
2023 finds that the United States ensures adequate protection for data transferred to
organisations on the "Data Privacy Framework List" (Art. 1) only. The General Court dismissed
the challenge in T-553/23 _Latombe v Commission_ on 3 September 2025. Mr Latombe appealed on
31 October 2025 (C-703/25 P, OJ C/2025/6610); the reviewer found no judgment on the appeal as
of 28 September 2026. The decision is in force but can still be annulled.

**Application.**

- **Household use:** if the exemption applies, the parent is not "subject to the GDPR for the
  given processing", so Chapter V does not apply to the parent.
- **Consumer accounts:** the parent's counterpart is an EEA entity (Anthropic Ireland, Limited;
  OpenAI Ireland Limited). Sending data to it is not a transfer by the parent. Onward transfers
  are the provider's responsibility; both say they rely on adequacy decisions or standard
  contractual clauses.
- **Business or API accounts:** the provider is the parent's processor. Anthropic's DPA
  incorporates the standard contractual clauses (modules two and three). A parent or connector
  operator in this position is an exporter to the extent processing leaves the EEA. They need the
  provider's DPA, and to know whether the provider relies on the DPF (and is on the DPF list) or
  on standard clauses with a transfer assessment.
- **Connector hosting:** a hosting company outside the EEA, or a US company acting as the
  parent's processor, is a second possible transfer. The connector guide should suggest an EEA
  region (recommendation R4).

The project itself transfers nothing: it only talks to SchoolSoft. Sending less (the default
redaction) is the only lever it holds, and it uses it.

**Conclusion: consistent with the law for the project. Uncertain for operators with business
or API accounts, or with hosting outside the EEA; a documentation matter, not a code matter.**

## 6. Children's data

**The law.** "Children merit specific protection with regard to their personal data, as they may
be less aware of the risks" (Recital 38). Art. 6(1)(f) names the child expressly. Recital 58
asks for information addressed to a child to be in language the child can understand. The
Article 29 Working Party's Opinion 2/2009 on children's data (including the special case of
schools) makes the child's best interest the core principle. In Sweden the UN Convention on the
Rights of the Child is law (lag (2018:1197), in force 1 January 2020). The Swedish age of
consent for information society services offered directly to a child is 13 (dataskyddslagen
2 kap. 4 §). That provision does not apply here, because the tool is not offered to children.

**Application.** Other pupils are the largest group of people in a class contact list, and their
names reach the AI provider in every default contact-list answer. That is justified by the
purpose (questions about the class) and is what the school shows guardians. Their own contact
details are a different matter (see [section 3](#3-lawful-basis-if-the-exemption-does-not-apply)).
Message and post texts can name children and describe incidents or health; see
[section 9](#9-residual-risks).

**Conclusion: default consistent with the law; revealing pupils' own contact details is a gap
(R1).**

## 7. Swedish specifics

### Dataskyddslagen (2018:218)

The Act "kompletterar" the GDPR (1 kap. 1 §). It gives precedence to other statutes that
deviate from it (1 kap. 6 §) and to the freedom-of-the-press and freedom-of-expression
fundamental laws (1 kap. 7 §). It adds no rule on the household exemption. It restricts
processing of personal identity numbers without consent to when it is "klart motiverat"
(3 kap. 10 §). The redaction removes personal identity number keys (`ssn`, `personalNumber`,
`personnummer`) from messages, which fits that rule. **Consistent.**

### Staff work contact details and the principle of public access

Everyone has the right to access official documents (allmänna handlingar) at public authorities
(tryckfrihetsförordningen 2 kap. 1 §). A municipal school is part of the municipality, so its
staff's work e-mail addresses and phone numbers are, as a rule, public. Secrecy protects staff's
home address, private phone number and relatives in personnel administration (offentlighets-
och sekretesslagen (OSL) 39 kap. 3 §), and anyone's address, phone or e-mail where there is a
particular risk of threats or violence (OSL 21 kap. 3 §). The school's staff list therefore holds
exactly the details the public can ask for.

Two points of caution: public access is not a lawful basis under the GDPR for a parent's
further processing, and public data are still personal data. What public access does is weigh
in the balancing (the data's "accessibility or publicity", EDPB 1/2024) and shape staff's
reasonable expectations: a teacher expects guardians to e-mail them at the address the school
publishes.

**Independent schools (friskolor).** Today the right of access does not apply to private
governing bodies (enskilda huvudmän). That changes on **1 January 2027**: a new OSL 2 kap. 3 a §
(SFS 2026:714) applies the right of access to documents of private bodies approved as governing
bodies in the school system, for the approved activity, with relief rules for small ones (at
most 450 pupils; all during the first two years). The Riksdag adopted the government bill
(prop. 2025/26:191, committee report 2025/26:UbU20) on 26 May 2026. Until then, a friskola's
staff contacts are not public records, but the school still publishes them to guardians so that
guardians can reach staff, which carries the same expectation.

**Conclusion: consistent with the law.** The owner's decision (staff keep their work contact
details, for now) is sound for municipal schools and for friskolor. The friskolor follow-up is
largely resolved by the 2027 change; what remains is to re-read the relief rules if a school's
staff list turns out to include anything but work details.

### Protected personal data (skyddade personuppgifter)

There are three forms: sekretessmarkering, skyddad folkbokföring and fingerade personuppgifter
(Skatteverket). IMY stresses that such data need "särskilt hög" security in schools. The owner
states that SchoolSoft already leaves people with protected personal data out of the class
contact list. **The reviewer records this as the owner's statement; it was not verified against
SchoolSoft's documentation, which is not public.** It is the school's and SchoolSoft's
responsibility, under OSL 21 kap. 3 § and the GDPR, not to disclose those details.

The project's own safeguard is defence in depth: it never stores, combines or enriches the data,
and by default sends no contact details for other families. That still matters where the
omission cannot help: message texts and recipient names, which the school writes.

**Conclusion: consistent with the law.**

## 8. Transparency

**The law.** Where data are not obtained from the data subject, the controller must inform them
(Art. 14), unless, among other exceptions, this "proves impossible or would involve a
disproportionate effort"; the controller must then "take appropriate measures to protect the
data subject's rights ... including making the information publicly available" (Art. 14(5)(b)).

**Application.** If the household exemption applies, Art. 14 does not apply to the parent. If it
does not, the parent would in principle owe each other family information about processing their
names. For a private parent that is plausibly disproportionate, and the appropriate measure is
the minimisation the design already performs. The AI provider, as a controller in the consumer
case, has its own Art. 14 duties, which it meets (if at all) through its privacy policy.

The project cannot inform the other families itself, but its data-handling page is public. A
short section addressed to "another family in the class" would be a cheap, useful measure in the
spirit of Art. 14(5)(b) (recommendation R5).

**Conclusion: uncertain; low practical risk.**

## 9. Residual risks

1. **Free text in messages and posts.** Texts are sent as written. They may contain other
   people's e-mail addresses or phone numbers, and they may contain special categories of data
   (Art. 9), such as health ("X is ill") or incidents involving named children. Redacting free
   text would be unreliable and would defeat the tool's purpose; the owner decided to keep bodies,
   and the data-handling page says so. The mitigation is behavioural: ask only for what you need.
   **Accepted and documented.**
2. **The staff heading list.** Staff are recognised by the group heading, compared whole. A
   heading the list does not know is treated as families, so the failure mode is hiding staff
   details (inconvenient), not leaking family details. The opposite failure (a families group
   under a heading on the list) is implausible for the listed words. The live session checks the
   list against real headings (question D1, from the counts in `e2e-report.md`).
   **Accepted, with a live check.**
3. **The connector operator's responsibilities.** A parent who runs a connector is, where the GDPR
   applies, a controller with a hosting processor, and possibly an exporter (see
   [section 5](#5-transfers-outside-the-eueea)). The data-handling page's "you are the operator"
   section covers the hosting provider, backups and keys. It does not mention hosting region or
   that the connector should be run by the guardian it serves. **Small gap (R4).** The contacts
   reveal is not reachable through the connector until E11 offers `get_contacts`.
4. **Training and retention at the AI provider.** Consumer accounts may use conversations for
   model training unless the user opts out (Anthropic: "unless you opt out through your account
   settings"; OpenAI: the "Improve the model for everyone" setting). Other families' names in a
   trained model cannot practically be removed later, a risk IMY also points out.
   **Documented in this change:** the data-handling page now advises turning training off.
5. **Development on real data.** The owner's live session, `make e2e` and `make capture` process a
   real family's data for software development, outside the household setting. The runbook
   already minimises: captures are redacted fail-closed and reviewed, `e2e-report.md` stays local
   and records counts (for contacts: groups, people and hidden groups, never names), and nothing
   personal is committed. The legal basis would be the owner's legitimate interest in maintaining
   the software (Art. 6(1)(f)). **Uncertain; low risk.** Recommendation R6.

## Conclusions and recommendations

| Area                   | Conclusion                                           | Recommendation                                                                                                   |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Roles                  | Consistent                                           | None beyond R4, R6.                                                                                              |
| Household exemption    | Uncertain                                            | Keep not relying on it. Do not say that the GDPR "does not apply" to parents.                                    |
| Lawful basis, default  | Consistent                                           | None.                                                                                                            |
| Lawful basis, reveal   | Uncertain; gap for pupils' own details               | R1, R2.                                                                                                          |
| Principles             | Consistent                                           | None.                                                                                                            |
| Transfers              | Consistent for the project; uncertain for some operators | R3, R4.                                                                                                      |
| Children               | Default consistent; gap for pupils' own details      | R1.                                                                                                              |
| Swedish specifics      | Consistent                                           | Re-check staff lists at friskolor after 1 January 2027 (follow-up, not a blocker).                               |
| Transparency           | Uncertain                                            | R5.                                                                                                              |
| Residual risks         | Documented; small gaps                               | R4, R6; training advice done.                                                                                    |

Recommendations for the owner (code changes are listed, not made):

- **R1 (code).** Limit the reveal to guardians' contact details. Keep a pupil's own e-mail and
  phone redacted even with `contactDetails` on, if the contact list's role (or a group heading)
  identifies the person as a pupil, failing closed when the role is unknown. Update the setting's
  warning, the consent text and the data-handling table to match.
- **R2 (code, optional).** Narrow the local reveal from a standing switch to a need: for example,
  reveal details only for a person the parent names in the request, or only for one answer. If
  the switch stays, the `setup` text and the documentation should say to turn it off again after
  use.
- **R3 (docs).** In the data-handling page's "What your AI assistant receives", explain in one
  sentence that a business or API account makes the provider your processor, and that you then
  need its data processing terms. (Not made here; it belongs with the connector's operator
  guidance.)
- **R4 (docs).** In the connector guide and in "If you run the connector, you are the operator":
  choose a hosting region in the EU/EEA where the provider offers one, and run the connector only
  for your own family.
- **R5 (docs).** Add a short section to the data-handling page, addressed to other families in a
  class, saying what the tool sends about them by default and what it never does. Not made here,
  because its wording should be the owner's.
- **R6 (docs).** Add a sentence to the live-session runbook that the sitting processes one real
  family's data for development, on the owner's legitimate interest, with the minimisation the
  runbook already describes, and that other families' names from the contact list are never
  recorded, only counts.

### Status of the recommendations (2026-09-28)

The owner asked for R1, left R2 optional and left R5's wording to the implementer. All six
are now in PR #74:

| Item | Status | Where |
| ---- | ------ | ----- |
| R1 | Done | [Commit b90d308](https://github.com/grimen/schoolsoft-agent/pull/74/commits/b90d308). The reveal keeps a contact's e-mail and phone only when their role, or else their group heading, marks them as a guardian and not as a pupil; anything else is withheld. Staff unchanged. [Spec, section 2](../specs/2026-09-28-other-families-data.md#2-an-explicit-opt-in-reveals-other-guardians-contact-details); [data-handling](../../getting-started/data-handling.md#other-families-data). The real labels are checked live (question D2 in the [runbook](../../development/live-session.md#question-register)). |
| R2 | Partly done | [Commit b90d308](https://github.com/grimen/schoolsoft-agent/pull/74/commits/b90d308). The switch stays; the data-handling page, `setup` and the consent box now say to turn the reveal off again after use. A per-request reveal was not added: the assistant, not the parent, chooses a tool's inputs, so a per-call flag would not narrow the parent's decision, and the redaction boundary sees no request inputs. |
| R3 | Done | [Commit e71e8c1](https://github.com/grimen/schoolsoft-agent/pull/74/commits/e71e8c1); [data-handling, "What your AI assistant receives"](../../getting-started/data-handling.md#what-your-ai-assistant-receives). |
| R4 | Done | [Commit e71e8c1](https://github.com/grimen/schoolsoft-agent/pull/74/commits/e71e8c1); [connector guide](../../deployment/connector.md) and [data-handling, operator section](../../getting-started/data-handling.md#if-you-run-the-connector-you-are-the-operator). |
| R5 | Done | [Commit e71e8c1](https://github.com/grimen/schoolsoft-agent/pull/74/commits/e71e8c1); [data-handling, "If your family is in the same class"](../../getting-started/data-handling.md#if-your-family-is-in-the-same-class). |
| R6 | Done | [Commit e71e8c1](https://github.com/grimen/schoolsoft-agent/pull/74/commits/e71e8c1); [live-session runbook, ground rules](../../development/live-session.md#ground-rules). |

Documentation changes made with this review: the spec's open questions and owner decisions, the
data-handling page's summary of this review and the protected-data statement, advice to turn off
model training, and question D1 in the live-session runbook.

## Questions for a lawyer or DPO

1. Does a parent's use of an AI assistant (consumer account) to read their own child's school
   data, including the names of other pupils and guardians, fall within the household exemption
   (Art. 2(2)(c))? Does the answer change when the provider may use conversations for training,
   or processes them outside the EEA?
2. With the reveal on, does the household exemption still hold for sending other families'
   e-mail addresses and phone numbers to the provider? If not, does a legitimate-interest
   balancing (Art. 6(1)(f)) support it for guardians' details, and for pupils' own details?
3. Is one guardian's explicit, off-by-default opt-in, with a warning, an adequate safeguard for
   the reveal? Would a narrower design (R1, R2) be needed?
4. Can the project author, who distributes open-source software and runs no service, be regarded
   as a controller or joint controller for parents' use in the light of C-683/21? Does publishing
   defaults and documentation change that?
5. Are a parent and a consumer AI provider joint controllers for the transmission of school data
   to the provider (_Fashion ID_)? What would that mean for a private parent?
6. For a parent who operates a connector on a hosting service, what are the minimum duties
   (processor agreement with the host, hosting region, records), and does the answer change if the
   exemption applies?
7. Is it correct that the principle of public access makes municipal school staff's work e-mail
   and phone public, so that returning them to a guardian's assistant is unproblematic? Does
   OSL 2 kap. 3 a § (from 1 January 2027) put friskolor in the same position, including under its
   relief rules?
8. Where the GDPR applies to a parent, is Art. 14(5)(b) available for not informing other
   families, and is a public explanation from the project an appropriate measure?
9. For the owner's live session: is legitimate interest the right basis for processing their own
   family's (and incidentally other families') data for development, and are the runbook's
   safeguards sufficient?
10. May the project describe its handling as "designed for data minimisation under the GDPR"
    without a compliance claim? What wording would you accept?

## Sources

All checked on 2026-09-28.

**EU legislation**

- Regulation (EU) 2016/679 (GDPR), Arts. 2, 4, 5, 6, 9, 14, 25, 26, 28, 44–49, Recitals 18, 38,
  47, 58, 78: <https://eur-lex.europa.eu/eli/reg/2016/679/oj>
- Commission Implementing Decision (EU) 2023/1795 (EU–US Data Privacy Framework):
  <https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj>
- Data Privacy Framework List: <https://www.dataprivacyframework.gov/list>
- European Commission, EU–US data transfers:
  <https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-transfers_en>

**CJEU and General Court**

- C-101/01 _Lindqvist_, 6 November 2003 (ECLI:EU:C:2003:596):
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62001CJ0101>
- C-212/13 _Ryneš_, 11 December 2014 (ECLI:EU:C:2014:2428):
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62013CJ0212>
- C-210/16 _Wirtschaftsakademie Schleswig-Holstein_, 5 June 2018 (ECLI:EU:C:2018:388):
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62016CJ0210>
- C-25/17 _Jehovan todistajat_, 10 July 2018 (ECLI:EU:C:2018:551):
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0025>
- C-345/17 _Buivids_, 14 February 2019:
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0345>
- C-40/17 _Fashion ID_, 29 July 2019:
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62017CJ0040>
- C-311/18 _Facebook Ireland and Schrems_ ("Schrems II"), 16 July 2020:
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62018CJ0311>
- C-683/21 _Nacionalinis visuomenės sveikatos centras_, 5 December 2023:
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62021CJ0683>
- T-553/23 _Latombe v Commission_, 3 September 2025 (ECLI:EU:T:2025:831):
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62023TJ0553>
- C-703/25 P, appeal lodged 31 October 2025 (OJ C/2025/6610):
  <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62025CN0703>

**EDPB and Article 29 Working Party**

- EDPB Guidelines 07/2020 on the concepts of controller and processor (version 2.0):
  <https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf>
- EDPB Guidelines 1/2024 on processing based on Art. 6(1)(f) (version for public consultation):
  <https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf>
- EDPB Guidelines 05/2021 on the interplay between Art. 3 and Chapter V (version 2.0):
  <https://www.edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf>
- Article 29 Working Party, statement on the data protection reform, Annex 2 (household
  exemption criteria), 27 February 2013:
  <https://ec.europa.eu/justice/article-29/documentation/other-document/files/2013/20130227_statement_dp_annex2_en.pdf>
- Article 29 Working Party, Opinion 2/2009 on the protection of children's personal data
  (WP 160): <https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2009/wp160_en.pdf>

**Swedish law and authorities**

- Lag (2018:218) med kompletterande bestämmelser till EU:s dataskyddsförordning:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-2018218-med-kompletterande-bestammelser-till_sfs-2018-218/>
- Tryckfrihetsförordning (1949:105), 2 kap.:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/tryckfrihetsforordning-1949105_sfs-1949-105/>
- Offentlighets- och sekretesslag (2009:400), 2 kap. 3 a § (from 2027-01-01), 21 kap. 3 §,
  39 kap. 3 §:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/offentlighets-och-sekretesslag-2009400_sfs-2009-400/>
- Prop. 2025/26:191, Offentlighetsprincipen med lättnadsregler för enskilda mindre huvudmän i
  skolväsendet:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/proposition/offentlighetsprincipen-med-lattnadsregler-for_hd03191/html/>
- Bet. 2025/26:UbU20 (adopted 26 May 2026, in force 1 January 2027):
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/betankande/offentlighetsprincipen-med-lattnadsregler-for_hd01ubu20/>
- Lag (2018:1197) om Förenta nationernas konvention om barnets rättigheter:
  <https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/lag-20181197-om-forenta-nationernas-konvention_sfs-2018-1197/>
- IMY, när GDPR inte gäller: <https://www.imy.se/privatperson/dataskydd/introduktion-till-gdpr/nar-gdpr-inte-galler/>
- IMY, för personuppgiftsansvariga inom skola och förskola:
  <https://www.imy.se/verksamhet/dataskydd/dataskydd-pa-olika-omraden/skola-och-forskola/for-personuppgiftsansvariga-inom-skola-och-forskola>
- IMY, GDPR vid användning av generativ AI (IMY-2024-9162, 2025-02-05):
  <https://www.imy.se/contentassets/1571d42dcc8346529658968c198cd4b5/gdpr-vid-anvandning-av-generativ-ai_imy-2024-9162.pdf>
- IMY, att tänka på när du använder AI-tjänster:
  <https://www.imy.se/privatperson/ai/att-tanka-pa-nar-du-anvander-ai-tjanster/>
- IMY, vad menas med överföring till tredjeland?:
  <https://www.imy.se/vanliga-fragor-och-svar/vad-menas-med-overforing-till-tredjeland/>, and
  överföring till tredje land:
  <https://www.imy.se/verksamhet/dataskydd/det-har-galler-enligt-gdpr/overforing-till-tredje-land/>
- Skatteverket, skyddade personuppgifter:
  <https://www.skatteverket.se/privat/folkbokforing/skyddadepersonuppgifter.4.18e1b10334ebe8bc80001711.html>

**AI providers' terms** (general terms only; read the current version before relying on them)

- Anthropic privacy policy (effective 10 September 2026): <https://www.anthropic.com/legal/privacy>
- Anthropic data processing addendum: <https://www.anthropic.com/legal/data-processing-addendum>
- OpenAI Europe privacy policy: <https://openai.com/policies/eu-privacy-policy/>
- OpenAI data controls: <https://help.openai.com/en/articles/7730893-data-controls-in-chatgpt>
