/**
 * Alla filer & länkar (`right_student_library.jsp`, browser): the links the
 * page extractor lifted, with their category heading. Selectors observed live
 * 2026-09-06; what counts as a stored file (the download page or a document
 * extension) is assumed (see the E4.5 spec).
 */
import { z } from "zod";
import type { SharedFile } from "../../../../core/domain/schemas.js";
import { optionalText, parseUpstream, textHash } from "./parse.js";

const rawFiles = z.array(
  z.object({ name: z.string().min(1), url: z.string().min(1), category: optionalText }),
);

const STORED = /file_download\.jsp|\.(pdf|docx?|xlsx?|pptx?)(\?|$)/i;

export function toSharedFiles(data: unknown): SharedFile[] {
  return parseUpstream(rawFiles, data, "getFiles").map((f) => ({
    id: `file:${textHash(f.url)}`,
    name: f.name,
    url: f.url,
    kind: STORED.test(f.url) ? "file" : "link",
    category: f.category,
  }));
}
