/**
 * Every user-facing message, in English and Swedish, keyed. Errors carry a
 * key and parameters instead of prose, so the surfaces (CLI, MCP) render
 * them in the user's language and with the right "what to do next" for
 * their surface (a shell command vs. a tool name). Developer-only errors
 * stay plain `Error`s and are rendered as "internal".
 */
export type Lang = "en" | "sv";
export type Surface = "cli" | "mcp";

type Template = (p: Record<string, string>) => string;
type Catalog = Record<string, Record<Lang, Template>>;

export const MESSAGES = {
  not_configured: {
    en: (p) => `Not configured: no school is set${p.reason ? ` (${p.reason})` : ""}.`,
    sv: (p) => `Inte konfigurerad: ingen skola är vald${p.reason ? ` (${p.reason})` : ""}.`,
  },
  not_authenticated: {
    en: (p) => `Not logged in to SchoolSoft (${p.reason}).`,
    sv: (p) => `Inte inloggad på SchoolSoft (${p.reason}).`,
  },
  session_rejected_twice: {
    en: () =>
      `SchoolSoft rejected the session even after a silent re-login; the saved session is no longer valid.`,
    sv: () =>
      `SchoolSoft avvisade sessionen även efter en tyst ominloggning; den sparade sessionen gäller inte längre.`,
  },
  network: {
    en: (p) =>
      `Could not reach SchoolSoft (${p.detail}). Check your internet connection, VPN or proxy, and try again in a moment.`,
    sv: (p) =>
      `Kunde inte nå SchoolSoft (${p.detail}). Kontrollera internetanslutning, VPN eller proxy och försök igen om en stund.`,
  },
  upstream: {
    en: (p) =>
      `SchoolSoft answered HTTP ${p.status} for ${p.what}. This is usually temporary; try again in a moment.`,
    sv: (p) =>
      `SchoolSoft svarade HTTP ${p.status} för ${p.what}. Det är oftast tillfälligt; försök igen om en stund.`,
  },
  upstream_rejected: {
    en: (p) => `SchoolSoft rejected the session (HTTP ${p.status}) for ${p.what}.`,
    sv: (p) => `SchoolSoft avvisade sessionen (HTTP ${p.status}) för ${p.what}.`,
  },
  web_login_required: {
    en: (p) =>
      `${p.what} is behind SchoolSoft's "log in again" gate and needs the web login session.`,
    sv: (p) =>
      `${p.what} ligger bakom SchoolSofts "logga in igen"-spärr och kräver webbinloggningen.`,
  },
  web_session_lost: {
    en: (p) =>
      `SchoolSoft sent ${p.page} to its login page: the web login session has expired (inactivity).`,
    sv: (p) =>
      `SchoolSoft skickade ${p.page} till inloggningssidan: webbinloggningen har gått ut (inaktivitet).`,
  },
  app_session_lost: {
    en: (p) => `SchoolSoft sent ${p.page} to its login page: the session expired.`,
    sv: (p) => `SchoolSoft skickade ${p.page} till inloggningssidan: sessionen har gått ut.`,
  },
  portal_gated: {
    en: (p) => `SchoolSoft only shows ${p.page} to a web login, not to the app session.`,
    sv: (p) => `SchoolSoft visar ${p.page} bara för en webbinloggning, inte för app-sessionen.`,
  },
  browser_required: {
    en: (p) =>
      `${p.what} is only available through SchoolSoft's web pages, which need the headless browser${p.reason ? ` (${p.reason})` : ""}.`,
    sv: (p) =>
      `${p.what} finns bara på SchoolSofts webbsidor, som kräver den dolda webbläsaren${p.reason ? ` (${p.reason})` : ""}.`,
  },
  capability_not_supported: {
    en: (p) => `${p.what} is not offered by the "${p.provider}" school portal.`,
    sv: (p) => `${p.what} erbjuds inte av skolportalen "${p.provider}".`,
  },
  child_not_found: {
    en: (p) => `No child with id ${p.id}. Known children: ${p.known}.`,
    sv: (p) => `Inget barn med id ${p.id}. Kända barn: ${p.known}.`,
  },
  child_no_school: {
    en: (p) =>
      `Child ${p.id} has no school registered at SchoolSoft, so nothing can be read for them.`,
    sv: (p) =>
      `Barn ${p.id} har ingen skola registrerad i SchoolSoft, så inget kan läsas för det barnet.`,
  },
  no_children: {
    en: () => `SchoolSoft returned a guardian profile with no children; there is nothing to show.`,
    sv: () => `SchoolSoft returnerade en vårdnadshavare utan barn; det finns inget att visa.`,
  },
  subject_not_found: {
    en: (p) => `No subject matching "${p.subject}" for this child. Available: ${p.available}.`,
    sv: (p) =>
      `Inget ämne matchar "${p.subject}" för det här barnet. Tillgängliga: ${p.available}.`,
  },
  subject_menu_empty: {
    en: () =>
      `SchoolSoft lists no subjects for this child, so assessment criteria cannot be looked up.`,
    sv: () =>
      `SchoolSoft listar inga ämnen för det här barnet, så bedömningskriterier kan inte hämtas.`,
  },
  login_timeout: {
    en: (p) => `The login was not completed within ${p.minutes} minutes.`,
    sv: (p) => `Inloggningen slutfördes inte inom ${p.minutes} minuter.`,
  },
  login_denied: {
    en: (p) => `The login page reported an error: ${p.error}.`,
    sv: (p) => `Inloggningssidan rapporterade ett fel: ${p.error}.`,
  },
  login_state_mismatch: {
    en: () =>
      `The login response did not match the request that opened it (possible CSRF); nothing was accepted.`,
    sv: () =>
      `Inloggningssvaret matchade inte begäran som öppnade det (möjlig CSRF); inget godtogs.`,
  },
  login_no_code: {
    en: () => `The login response carried no authorization code.`,
    sv: () => `Inloggningssvaret saknade auktoriseringskod.`,
  },
  callback_port_busy: {
    en: (p) => `Could not start the login callback server on port ${p.port} (${p.detail}).`,
    sv: (p) => `Kunde inte starta inloggningens återanropsserver på port ${p.port} (${p.detail}).`,
  },
  login_in_progress: {
    en: () => `A login is already in progress; complete BankID in the browser window that is open.`,
    sv: () => `En inloggning pågår redan; slutför BankID i webbläsarfönstret som är öppet.`,
  },
  web_login_timeout: {
    en: (p) => `The web login did not reach the school portal within ${p.seconds} s.`,
    sv: (p) => `Webbinloggningen nådde inte skolportalen inom ${p.seconds} s.`,
  },
  web_login_unavailable: {
    en: () => `The web login is not available in this configuration.`,
    sv: () => `Webbinloggningen är inte tillgänglig i den här konfigurationen.`,
  },
  token_exchange_failed: {
    en: (p) => `SchoolSoft did not issue a token (${p.what}: ${p.detail}).`,
    sv: (p) => `SchoolSoft utfärdade ingen token (${p.what}: ${p.detail}).`,
  },
  cookie_exchange_failed: {
    en: (p) =>
      `SchoolSoft did not open a session for user type "${p.userType}" (status ${p.status}${p.location ? `, redirect ${p.location}` : ""}). The token may be expired, or the account is not a guardian at this school.`,
    sv: (p) =>
      `SchoolSoft öppnade ingen session för användartyp "${p.userType}" (status ${p.status}${p.location ? `, omdirigering ${p.location}` : ""}). Token kan ha gått ut, eller så är kontot inte vårdnadshavare på den här skolan.`,
  },
  school_list_empty: {
    en: () => `SchoolSoft's public school list came back empty.`,
    sv: () => `SchoolSofts offentliga skollista var tom.`,
  },
  input: {
    en: (p) => `Invalid input: ${p.detail}.`,
    sv: (p) => `Ogiltig inmatning: ${p.detail}.`,
  },
  playwright_missing: {
    en: (p) => `The headless browser cannot start: ${p.detail}.`,
    sv: (p) => `Den dolda webbläsaren kan inte startas: ${p.detail}.`,
  },
  internal: {
    en: (p) => `Unexpected error: ${p.detail}`,
    sv: (p) => `Oväntat fel: ${p.detail}`,
  },
} satisfies Catalog;

export type MessageKey = keyof typeof MESSAGES;

/** What to do next, per surface. */
export const HINTS = {
  configure: {
    en: {
      cli: `Run: schoolsoft-agent configure --query "<school name>"`,
      mcp: `Call schoolsoft_find_school with the school's name, then set SCHOOLSOFT_SCHOOL (or re-install with the slug).`,
    },
    sv: {
      cli: `Kör: schoolsoft-agent configure --query "<skolans namn>"`,
      mcp: `Anropa schoolsoft_find_school med skolans namn och sätt sedan SCHOOLSOFT_SCHOOL (eller installera om med slug).`,
    },
  },
  login: {
    en: {
      cli: `Run: schoolsoft-agent login (opens your browser for BankID)`,
      mcp: `Call schoolsoft_login; a browser tab opens for BankID. Tell the user to complete it there.`,
    },
    sv: {
      cli: `Kör: schoolsoft-agent login (öppnar webbläsaren för BankID)`,
      mcp: `Anropa schoolsoft_login; en webbläsarflik öppnas för BankID. Be användaren slutföra den där.`,
    },
  },
  login_web: {
    en: {
      cli: `Run: schoolsoft-agent login --web (a browser window opens for one more BankID)`,
      mcp: `Call schoolsoft_login with web: true; a browser window opens for one more BankID.`,
    },
    sv: {
      cli: `Kör: schoolsoft-agent login --web (ett webbläsarfönster öppnas för ytterligare ett BankID)`,
      mcp: `Anropa schoolsoft_login med web: true; ett webbläsarfönster öppnas för ytterligare ett BankID.`,
    },
  },
  browser_install: {
    en: {
      cli: `Run: schoolsoft-agent browser install (downloads Chromium once), or set SCHOOLSOFT_BROWSER_CDP to a CDP endpoint`,
      mcp: `Ask the user to run "schoolsoft-agent browser install" once (downloads Chromium), or set SCHOOLSOFT_BROWSER_CDP.`,
    },
    sv: {
      cli: `Kör: schoolsoft-agent browser install (laddar ner Chromium en gång), eller sätt SCHOOLSOFT_BROWSER_CDP till en CDP-adress`,
      mcp: `Be användaren köra "schoolsoft-agent browser install" en gång (laddar ner Chromium), eller sätt SCHOOLSOFT_BROWSER_CDP.`,
    },
  },
  retry: {
    en: {
      cli: `Try again in a moment; if it keeps failing, run: schoolsoft-agent doctor`,
      mcp: `Try again in a moment; if it keeps failing, ask the user to run "schoolsoft-agent doctor".`,
    },
    sv: {
      cli: `Försök igen om en stund; om det fortsätter, kör: schoolsoft-agent doctor`,
      mcp: `Försök igen om en stund; om det fortsätter, be användaren köra "schoolsoft-agent doctor".`,
    },
  },
  list_children: {
    en: {
      cli: `Run: schoolsoft-agent list-children`,
      mcp: `Call schoolsoft_list_children and use one of the ids.`,
    },
    sv: {
      cli: `Kör: schoolsoft-agent list-children`,
      mcp: `Anropa schoolsoft_list_children och använd ett av id:na.`,
    },
  },
  subject_rooms: {
    en: {
      cli: `Run: schoolsoft-agent get-subject-rooms to see the subject names`,
      mcp: `Call schoolsoft_get_subject_rooms to see the subject names.`,
    },
    sv: {
      cli: `Kör: schoolsoft-agent get-subject-rooms för att se ämnesnamnen`,
      mcp: `Anropa schoolsoft_get_subject_rooms för att se ämnesnamnen.`,
    },
  },
  wait_for_login: {
    en: {
      cli: `Wait for the browser window, then run: schoolsoft-agent auth-status`,
      mcp: `Wait for the user, then call schoolsoft_auth_status.`,
    },
    sv: {
      cli: `Vänta på webbläsarfönstret och kör sedan: schoolsoft-agent auth-status`,
      mcp: `Vänta på användaren och anropa sedan schoolsoft_auth_status.`,
    },
  },
  free_port: {
    en: {
      cli: `Close the program using the port or set SCHOOLSOFT_CALLBACK_PORT to a free one`,
      mcp: `Ask the user to close the program using the port or set SCHOOLSOFT_CALLBACK_PORT.`,
    },
    sv: {
      cli: `Stäng programmet som använder porten eller sätt SCHOOLSOFT_CALLBACK_PORT till en ledig`,
      mcp: `Be användaren stänga programmet som använder porten eller sätta SCHOOLSOFT_CALLBACK_PORT.`,
    },
  },
  fix_input: {
    en: {
      cli: `Check the flags (schoolsoft-agent <command> --help)`,
      mcp: `Check the arguments against the tool's input schema.`,
    },
    sv: {
      cli: `Kontrollera flaggorna (schoolsoft-agent <kommando> --help)`,
      mcp: `Kontrollera argumenten mot verktygets schema.`,
    },
  },
  report_bug: {
    en: {
      cli: `This looks like a bug: run schoolsoft-agent doctor and open an issue with its output`,
      mcp: `This looks like a bug; ask the user to run "schoolsoft-agent doctor" and report it.`,
    },
    sv: {
      cli: `Det här ser ut som en bugg: kör schoolsoft-agent doctor och öppna ett ärende med utskriften`,
      mcp: `Det här ser ut som en bugg; be användaren köra "schoolsoft-agent doctor" och rapportera det.`,
    },
  },
} satisfies Record<string, Record<Lang, Record<Surface, string>>>;

export type HintKey = keyof typeof HINTS;

/** Pick a language from environment-like inputs: SCHOOLSOFT_LANG wins, else LANG/LC_ALL starting with "sv". */
export function detectLang(env: Record<string, string | undefined>): Lang {
  const explicit = env.SCHOOLSOFT_LANG?.toLowerCase();
  if (explicit === "sv" || explicit === "en") return explicit;
  const locale = (env.LC_ALL || env.LC_MESSAGES || env.LANG || "").toLowerCase();
  return locale.startsWith("sv") ? "sv" : "en";
}
