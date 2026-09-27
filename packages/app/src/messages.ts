import { ConnectorError, type ProblemName } from "schoolsoft-agent/client";

export type Language = "sv" | "en";

export function deviceLanguage(locales: ReadonlyArray<{ languageCode: string | null }>): Language {
  return locales[0]?.languageCode === "sv" ? "sv" : "en";
}

const TEXT = {
  en: {
    appName: "SchoolSoft",
    children: "Children",
    loading: "Loading…",
    empty: "This connection covers no children. Connect again and choose at least one child.",
    retry: "Try again",
    forget: "Forget this connection",
    signInLater: "Sign-in arrives in a later version of the app.",
    notPersistent: "This browser blocks storage, so the connection lasts until you reload.",
  },
  sv: {
    appName: "SchoolSoft",
    children: "Barn",
    loading: "Hämtar…",
    empty: "Den här anslutningen gäller inga barn. Anslut igen och välj minst ett barn.",
    retry: "Försök igen",
    forget: "Glöm den här anslutningen",
    signInLater: "Inloggning kommer i en senare version av appen.",
    notPersistent:
      "Webbläsaren blockerar lagring, så anslutningen gäller tills du laddar om sidan.",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type TextKey = keyof (typeof TEXT)["en"];

export function t(lang: Language, key: TextKey): string {
  return TEXT[lang][key];
}

export interface Explained {
  title: string;
  next: string;
  action: "retry" | "reconnect" | "dashboard" | "wait";
  dashboard?: string;
  retryAt?: string;
}

type Line = { sv: [string, string]; en: [string, string]; action: Explained["action"] };

const RECONNECT: Line = {
  en: ["The connection has ended.", "Connect again."],
  sv: ["Anslutningen har upphört.", "Anslut igen."],
  action: "reconnect",
};
const DASHBOARD: Line = {
  en: [
    "The connector needs a new SchoolSoft sign-in.",
    "Sign in on the connector's dashboard, then try again.",
  ],
  sv: [
    "Anslutaren behöver en ny inloggning i SchoolSoft.",
    "Logga in på anslutarens översikt och försök igen.",
  ],
  action: "dashboard",
};
const WAIT: Line = {
  en: ["SchoolSoft or the connector is busy.", "Wait a moment and try again."],
  sv: ["SchoolSoft eller anslutaren är upptagen.", "Vänta en stund och försök igen."],
  action: "wait",
};
const NETWORK: Line = {
  en: ["The connector can't be reached.", "Check the connection and try again."],
  sv: ["Det går inte att nå anslutaren.", "Kontrollera anslutningen och försök igen."],
  action: "retry",
};
const DRIFT: Line = {
  en: [
    "SchoolSoft answered in a way the app doesn't recognise.",
    "Try again later; an update may be needed.",
  ],
  sv: [
    "SchoolSoft svarade på ett sätt appen inte känner igen.",
    "Försök igen senare; en uppdatering kan behövas.",
  ],
  action: "retry",
};
const ORIGIN: Line = {
  en: ["The connector refused this address.", "Open the app from the connector's own address."],
  sv: ["Anslutaren nekade den här adressen.", "Öppna appen från anslutarens egen adress."],
  action: "retry",
};
const GENERIC: Line = {
  en: ["Something went wrong.", "Try again."],
  sv: ["Något gick fel.", "Försök igen."],
  action: "retry",
};

const BY_PROBLEM: Partial<Record<ProblemName, Line>> = {
  "oauth-token": RECONNECT,
  "scope-not-granted": RECONNECT,
  "child-not-permitted": RECONNECT,
  "schoolsoft-session": DASHBOARD,
  "web-session": DASHBOARD,
  "portal-pushback": WAIT,
  "rate-limited": WAIT,
  "connector-busy": WAIT,
  network: NETWORK,
  "response-drift": DRIFT,
  "foreign-origin": ORIGIN,
};

export function explain(error: unknown, lang: Language): Explained {
  let line = GENERIC;
  let dashboard: string | undefined;
  let retryAt: string | undefined;
  if (error instanceof ConnectorError) {
    line =
      (error.problem ? BY_PROBLEM[error.problem] : undefined) ??
      (error.kind === "not_authenticated"
        ? RECONNECT
        : error.kind === "network"
          ? NETWORK
          : GENERIC);
    dashboard = error.ownerDashboard;
    retryAt = error.retryAt;
  }
  const [title, next] = line[lang];
  return {
    title,
    next,
    action: line.action,
    ...(line.action === "dashboard" && dashboard ? { dashboard } : {}),
    ...(line.action === "wait" && retryAt ? { retryAt } : {}),
  };
}
