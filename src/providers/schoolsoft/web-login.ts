/** SchoolSoft's half of the headed-browser web login: where to open, what a landed portal page looks like. */
import type { WebLoginSpec } from "../../core/provider/types.js";

export const SCHOOLSOFT_ORIGIN = "https://sms.schoolsoft.se";

const LOGIN_MARKERS =
  /\/jsp\/Login\.jsp|\/samlLogin\.jsp|\/rest-api\/login\/|\/react\/#\/login|etjanst\.|\/wa\/auth\//;

/** True when a URL on the tenant is a portal page rather than any login step. */
export function isPortalUrl(url: string, school: string, origin = SCHOOLSOFT_ORIGIN): boolean {
  if (!url.startsWith(`${origin}/${school}/`)) return false;
  if (LOGIN_MARKERS.test(url)) return false;
  return /\/jsp\/(student|parent|teacher)\/|\/react\/#\/(parent|student)\//.test(url);
}

export const webLoginSpec: WebLoginSpec = {
  origin: SCHOOLSOFT_ORIGIN,
  loginUrl: (school) => `${SCHOOLSOFT_ORIGIN}/${school}/`,
  isPortalUrl: (url, school) => isPortalUrl(url, school),
};
