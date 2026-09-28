import type { Language } from "../messages";

/**
 * The development connect screen's text. It lives with the screen, not in `messages.ts`,
 * so a production build drops it together with `DevConnect` (`check-export.mjs` checks).
 */
const WORDS = {
  en: {
    devTitle: "Connect for development",
    devClientId: "Client ID",
    devRefresh: "Refresh token",
    devConnect: "Connect",
    devHowTo:
      "Open the connector's /reference/ page, connect it, then run this in its browser console:",
    devWarning:
      "Close the reference page tab before connecting. The refresh token rotates: if that tab refreshes later, the whole connection is revoked. Don't paste the same token into two tabs.",
    devInvalidClientId: "Paste the client ID (no spaces).",
    devInvalidRefresh: "Paste the refresh token.",
  },
  sv: {
    devTitle: "Anslut för utveckling",
    devClientId: "Klient-id",
    devRefresh: "Uppdateringstoken",
    devConnect: "Anslut",
    devHowTo:
      "Öppna anslutarens /reference/-sida, anslut den och kör sedan detta i dess webbläsarkonsol:",
    devWarning:
      "Stäng fliken med referenssidan innan du ansluter. Uppdateringstoken byts ut: om den fliken uppdaterar senare återkallas hela anslutningen. Klistra inte in samma token i två flikar.",
    devInvalidClientId: "Klistra in klient-id (utan mellanslag).",
    devInvalidRefresh: "Klistra in uppdateringstoken.",
  },
} as const satisfies Record<Language, Record<string, string>>;

export type DevTextKey = keyof (typeof WORDS)["en"];

export function devText(lang: Language, key: DevTextKey): string {
  return WORDS[lang][key];
}
