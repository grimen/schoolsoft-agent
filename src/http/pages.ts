/** Small server-rendered owner console; every dynamic value is escaped. */
import type { SessionHistorySummary } from "../core/index.js";
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body><main><h1>${escapeHtml(title)}</h1>${body}</main><footer><p>Independent project. Not affiliated with SchoolSoft AB or BankID.</p></footer></body></html>`;
}
export function form(action: string, csrf: string, body: string, label: string): string {
  return `<form method="post" action="${escapeHtml(action)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${body}<button type="submit">${escapeHtml(label)}</button></form>`;
}
export function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}
/** Plain-language lines about how long SchoolSoft sign-ins have lasted; empty until something is known. */
export function signInHistory(history: SessionHistorySummary | null | undefined): string {
  if (!history || (!history.app && history.losses.length === 0)) return "";
  const lines: string[] = [];
  if (history.app) {
    lines.push(
      `Current sign-in: ${history.app.ageMinutes === null ? "started before this was recorded" : `${history.app.ageMinutes} minutes old`}, renewed ${history.app.activityCount} times.`,
    );
  }
  for (const loss of history.losses) {
    lines.push(
      `${loss.at.slice(0, 16).replace("T", " ")} UTC: SchoolSoft ended a sign-in after ${loss.ageMinutes === null ? "an unknown time" : `${loss.ageMinutes} minutes`} (${loss.idleMinutes} minutes since it was last renewed).`,
    );
  }
  return `<h2>Sign-in history</h2><p>Times only; no school data is kept here.</p>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}`;
}
