/**
 * Alla filer & länkar (`right_student_library.jsp`, browser): the links the
 * page extractor lifted, with their category heading. Selectors observed live
 * 2026-09-06; what counts as a stored file (the download page or a document
 * extension) is assumed (see the E4.5 spec). Links are made absolute against
 * the page they were on; one that is not http(s) (`javascript:`, `mailto:`)
 * or not a URL keeps its entry with url null: the page's shape is fine, so it
 * is not drift, but the link is not one to hand on.
 */
import { z } from "zod";
import type { SharedFile } from "../../../../core/domain/schemas.js";
import { optionalText, parseUpstream, textHash } from "./parse.js";

const rawFiles = z.array(
  z.object({ name: z.string().min(1), url: z.string().min(1), category: optionalText }),
);

const STORED = /file_download\.jsp|\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i;

/** The link as an absolute http(s) URL, or null for any other scheme. */
function absolute(link: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim(), base);
  } catch {
    return null; // not a URL at all, e.g. "http://[" (an unclosed IPv6 host)
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

export function toSharedFiles(data: unknown, base: string): SharedFile[] {
  return parseUpstream(rawFiles, data, "getFiles").map((f) => {
    const url = absolute(f.url, base);
    return {
      id: `file:${textHash(url ?? f.url)}`,
      name: f.name,
      url,
      kind: url !== null && STORED.test(url) ? "file" : "link",
      category: f.category,
    };
  });
}
