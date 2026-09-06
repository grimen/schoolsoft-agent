/**
 * Structure probe run INSIDE a page (page.evaluate), so it must be
 * self-contained. Counts each anchor selector and hashes the page's
 * skeleton (tags, ids and classes only, never text; hashed CSS-in-JS
 * classes and numbered ids are dropped so data volume does not move the
 * fingerprint). Vendor-neutral: providers only supply the anchors.
 */
export interface PageInspection {
  title: string;
  anchors: Record<string, number>;
  /** FNV-1a hash of the sorted set of tag#id.class skeletons under #content (ids/classes with digits dropped). */
  fingerprint: string;
  nodes: number;
}

export function inspectPage(anchors: string[]): PageInspection {
  const t = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const root = document.querySelector("#content") ?? document.body;
  const counts: Record<string, number> = {};
  for (const a of anchors) counts[a] = document.querySelectorAll(a).length;
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.closest("#top-box")) continue;
    const cls = Array.from(el.classList)
      .filter((c) => !/\d/.test(c))
      .sort()
      .join(".");
    const id = el.id && !/\d/.test(el.id) ? "#" + el.id : "";
    seen.add(el.tagName.toLowerCase() + id + (cls ? "." + cls : ""));
  }
  const skeleton = Array.from(seen).sort();
  const str = skeleton.join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return {
    title: t(root.querySelector(".h1, h1")),
    anchors: counts,
    fingerprint: h.toString(16).padStart(8, "0"),
    nodes: skeleton.length,
  };
}
