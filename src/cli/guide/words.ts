/**
 * Every sentence the guided first run prints, in English and Swedish, in one
 * table so a missing translation is one failing test rather than a
 * mixed-language screen. Written for a parent, not a developer: no slugs,
 * orgIds or JSON, the school's "short name" as the host guides call it.
 * The language comes from core's `detectLang`, like errors and text views.
 */
import type { Lang } from "../../core/index.js";

type Text = string | ((p: Record<string, string | number>) => string);

/** Where the guides live; the guide links to them by path (a test checks each exists). */
export const DOCS_BASE = "https://github.com/grimen/schoolsoft-agent/blob/main/docs/";

export const DOC_PATHS = {
  dataHandling: "getting-started/data-handling.md",
  troubleshooting: "getting-started/troubleshooting.md",
  claudeDesktop: "integrations/claude/desktop.md",
  chatgpt: "integrations/openai/chatgpt.md",
  assistants: "integrations/README.md",
} as const;

export function docLink(path: keyof typeof DOC_PATHS): string {
  return DOCS_BASE + DOC_PATHS[path];
}

export const STEPS = 5;

export const WORDS = {
  welcome: {
    en: "Welcome to schoolsoft-agent.",
    sv: "Välkommen till schoolsoft-agent.",
  },
  intro: {
    en: "This takes about five minutes: we find your child's school, you log in with BankID, we check that everything works and show this week's schedule.",
    sv: "Det här tar ungefär fem minuter: vi hittar ditt barns skola, du loggar in med BankID, vi kontrollerar att allt fungerar och visar veckans schema.",
  },
  independent: {
    en: "schoolsoft-agent is an independent project. It is not made by SchoolSoft AB or by BankID.",
    sv: "schoolsoft-agent är ett fristående projekt. Det görs inte av SchoolSoft AB eller av BankID.",
  },
  howToStop: {
    en: (p) => `Press Ctrl+C at any time to stop. To continue later, run: ${p.cmd} setup`,
    sv: (p) => `Tryck Ctrl+C när som helst för att avbryta. Fortsätt senare med: ${p.cmd} setup`,
  },
  step: {
    en: (p) => `Step ${p.n} of ${STEPS}: ${p.title}`,
    sv: (p) => `Steg ${p.n} av ${STEPS}: ${p.title}`,
  },
  stepSchool: { en: "Find the school", sv: "Hitta skolan" },
  stepSave: { en: "Save the settings", sv: "Spara inställningarna" },
  stepLogin: { en: "Log in with BankID", sv: "Logga in med BankID" },
  stepCheck: { en: "Check that it works", sv: "Kontrollera att det fungerar" },
  stepSchedule: { en: "This week's schedule", sv: "Veckans schema" },

  askSchool: {
    en: "What is the school called? (for example Rösjöskolan): ",
    sv: "Vad heter skolan? (till exempel Rösjöskolan): ",
  },
  emptySchool: {
    en: "Type the school's name, or part of it, and press Enter.",
    sv: "Skriv skolans namn, eller en del av det, och tryck Enter.",
  },
  noMatch: {
    en: (p) => `No school matched "${p.query}". Try part of the name, or the municipality.`,
    sv: (p) => `Ingen skola matchade "${p.query}". Prova en del av namnet, eller kommunen.`,
  },
  matches: {
    en: "These schools match:",
    sv: "De här skolorna matchar:",
  },
  askPick: {
    en: (p) => `Which one? Type a number from 1 to ${p.max} and press Enter [1]: `,
    sv: (p) => `Vilken? Skriv en siffra från 1 till ${p.max} och tryck Enter [1]: `,
  },
  badPick: {
    en: (p) => `Please type a number from 1 to ${p.max}.`,
    sv: (p) => `Skriv en siffra från 1 till ${p.max}.`,
  },
  picked: {
    en: (p) => `Found: ${p.name}`,
    sv: (p) => `Hittade: ${p.name}`,
  },
  schoolKept: {
    en: (p) => `Already done: your school is chosen (short name ${p.school}).`,
    sv: (p) => `Redan klart: skolan är vald (kortnamn ${p.school}).`,
  },
  changeSchool: {
    en: (p) => `To choose another school later, run: ${p.cmd} configure`,
    sv: (p) => `Vill du byta skola senare, kör: ${p.cmd} configure`,
  },
  saved: {
    en: (p) => `Saved: short name ${p.school}, in ${p.file}`,
    sv: (p) => `Sparat: kortnamn ${p.school}, i ${p.file}`,
  },
  savedKept: {
    en: (p) => `Already done: your settings are in ${p.dir}`,
    sv: (p) => `Redan klart: inställningarna finns i ${p.dir}`,
  },

  loggedInAlready: {
    en: "Already done: you are logged in.",
    sv: "Redan klart: du är inloggad.",
  },
  loginExplain: {
    en: "Your web browser will open SchoolSoft's login page. Log in there with BankID as usual, then come back to this window.",
    sv: "Din webbläsare öppnar SchoolSofts inloggningssida. Logga in där med BankID som vanligt och kom sedan tillbaka till det här fönstret.",
  },
  loginNever: {
    en: "Never type BankID codes or passwords here.",
    sv: "Skriv aldrig BankID-koder eller lösenord här.",
  },
  loginOpening: {
    en: "Opening SchoolSoft's login page in your browser. Log in there with BankID as usual.",
    sv: "Öppnar SchoolSofts inloggningssida i din webbläsare. Logga in där med BankID som vanligt.",
  },
  askEnter: {
    en: "Press Enter to open the browser: ",
    sv: "Tryck Enter för att öppna webbläsaren: ",
  },
  loginWaiting: {
    en: "Waiting for you to finish in the browser (at most 5 minutes)…",
    sv: "Väntar på att du blir klar i webbläsaren (högst 5 minuter)…",
  },
  loginUrl: {
    en: (p) => `If no browser window opened, open this address on this computer: ${p.url}`,
    sv: (p) =>
      `Om inget webbläsarfönster öppnades, öppna den här adressen på den här datorn: ${p.url}`,
  },
  loggedIn: {
    en: (p) => `Logged in as ${p.name}.`,
    sv: (p) => `Inloggad som ${p.name}.`,
  },
  loggedInNoName: { en: "Logged in.", sv: "Inloggad." },

  checking: {
    en: "Reading once from SchoolSoft to check that everything works…",
    sv: "Läser en gång från SchoolSoft för att kontrollera att allt fungerar…",
  },
  checkOk: {
    en: (p) => `Everything works: ${p.ok} of ${p.total} checks passed.`,
    sv: (p) => `Allt fungerar: ${p.ok} av ${p.total} kontroller gick bra.`,
  },
  children: {
    en: (p) => `Found ${p.n} ${Number(p.n) === 1 ? "child" : "children"} on your account.`,
    sv: (p) => `Hittade ${p.n} barn på ditt konto.`,
  },
  checkFailed: {
    en: (p) => `Something does not work yet: ${p.failed} of ${p.total} checks did not pass.`,
    sv: (p) => `Något fungerar inte än: ${p.failed} av ${p.total} kontroller gick inte igenom.`,
  },
  checkNext: {
    en: (p) =>
      `Next: run ${p.cmd} doctor --verify for details, and see ${docLink("troubleshooting")}`,
    sv: (p) =>
      `Nästa steg: kör ${p.cmd} doctor --verify för detaljer, och läs ${docLink("troubleshooting")}`,
  },

  otherChildren: {
    en: (p) =>
      `Your other children: ${p.cmd} list-children --format text, then ${p.cmd} get-schedule --child-id <ID> --format text`,
    sv: (p) =>
      `Dina andra barn: ${p.cmd} list-children --format text, sedan ${p.cmd} get-schedule --child-id <ID> --format text`,
  },

  done: { en: "Done. schoolsoft-agent is ready.", sv: "Klart. schoolsoft-agent är redo." },
  dataHeading: { en: "Where your data is", sv: "Var dina uppgifter finns" },
  dataSettings: {
    en: (p) => `Settings: ${p.dir}`,
    sv: (p) => `Inställningar: ${p.dir}`,
  },
  dataLogin: {
    en: (p) => `Your login, encrypted: ${p.dir}`,
    sv: (p) => `Inloggningen, krypterad: ${p.dir}`,
  },
  dataNotSaved: {
    en: "Schedules and other answers are not saved. Nothing is sent to the project's author.",
    sv: "Scheman och andra svar sparas inte. Inget skickas till projektets upphovsperson.",
  },
  dataMore: {
    en: `How your family's data is handled: ${docLink("dataHandling")}`,
    sv: `Så hanteras familjens uppgifter (på engelska): ${docLink("dataHandling")}`,
  },
  hostsHeading: {
    en: "Use it with an AI assistant",
    sv: "Använd det med en AI-assistent",
  },
  hostsPrivacy: {
    en: "What you ask about is sent to the assistant's company. Read the page above first.",
    sv: "Det du frågar om skickas till assistentens företag. Läs sidan ovan först.",
  },
  hostsOtherFamilies: {
    en: "Other families' e-mail and phone in class contact lists are not sent. SCHOOLSOFT_CONTACT_DETAILS=1 sends other guardians' (never pupils') to the assistant's company too, without their say. Turn it off again after use.",
    sv: "Andra familjers e-post och telefon i klasslistor skickas inte. SCHOOLSOFT_CONTACT_DETAILS=1 skickar andra vårdnadshavares (aldrig elevers) till assistentens företag också, utan att de fått säga sitt. Stäng av det igen efteråt.",
  },
  hostClaude: {
    en: (p) => `Claude Desktop (short name ${p.school}): ${docLink("claudeDesktop")}`,
    sv: (p) => `Claude Desktop (kortnamn ${p.school}): ${docLink("claudeDesktop")}`,
  },
  hostChatgpt: {
    en: `ChatGPT: ${docLink("chatgpt")}`,
    sv: `ChatGPT: ${docLink("chatgpt")}`,
  },
  hostOthers: {
    en: `Other assistants: ${docLink("assistants")}`,
    sv: `Andra assistenter: ${docLink("assistants")}`,
  },
  commandsHeading: { en: "Useful commands", sv: "Bra kommandon" },
  commandSchedule: {
    en: (p) => `${p.cmd} get-schedule --format text     this week's schedule`,
    sv: (p) => `${p.cmd} get-schedule --format text     veckans schema`,
  },
  commandLunch: {
    en: (p) => `${p.cmd} get-lunch-menu --format text   this week's lunch`,
    sv: (p) => `${p.cmd} get-lunch-menu --format text   veckans lunch`,
  },
  commandDoctor: {
    en: (p) => `${p.cmd} doctor                         if something stops working`,
    sv: (p) => `${p.cmd} doctor                         om något slutar fungera`,
  },
} satisfies Record<string, Record<Lang, Text>>;

export type WordKey = keyof typeof WORDS;

/** A sentence in a language, with its template parameters filled in. */
export function say(
  lang: Lang,
  key: WordKey,
  params: Record<string, string | number> = {},
): string {
  const text: Text = WORDS[key][lang];
  return typeof text === "function" ? text(params) : text;
}
