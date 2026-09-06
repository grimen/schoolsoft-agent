/**
 * Legacy `/rest/...` endpoints behind the JSP pages, app session cookies.
 * Only read queries; the one verb here is a POST the page itself uses as a
 * filtered list fetch (observed 2026-09-06).
 */
import type { ActivityEntry } from "../types.js";
import type { SchoolsoftHttp } from "./transport.js";

interface Block {
  blockType: string;
  contentBlocks?: { content?: string }[];
}
interface Row {
  blogPost: { id: number; creDate: number | string; name: string; description: string };
  author?: string;
  recipientsNamesString?: string;
  numberOfComments?: number;
  content?: { contentBlockDTOList?: Block[] }[];
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export class LegacyApi {
  constructor(
    private readonly http: SchoolsoftHttp,
    private readonly cookieHeader: () => string | null,
  ) {}

  /** Verksamhetslogg: `POST /rest/blogpost/getbyloggedinuser`, the page's own generic filter with paging. */
  async getActivityLog(limit = 20): Promise<ActivityEntry[]> {
    const cookie = this.cookieHeader();
    if (!cookie) throw new Error("No session cookies — log in first.");
    const rows = await this.http.postJson<Row[]>("/rest/blogpost/getbyloggedinuser", cookie, {
      userId: -1,
      userType: -1,
      week: -1,
      subjects: [],
      archives: [],
      tags: [],
      freeText: "",
      goalIds: [],
      groupOrStudent: "",
      offset: 0,
      row_count: limit,
    });
    return (Array.isArray(rows) ? rows : []).map((r) => {
      const blocks = (r.content ?? []).flatMap((c) => c.contentBlockDTOList ?? []);
      const bodyText = blocks
        .filter((b) => b.blockType === "text")
        .flatMap((b) => (b.contentBlocks ?? []).map((cb) => strip(cb.content ?? "")))
        .filter(Boolean)
        .join("\n");
      const images = blocks
        .filter((b) => b.blockType === "image")
        .reduce((n, b) => n + (b.contentBlocks?.length ?? 0), 0);
      const cre = r.blogPost.creDate;
      const date = typeof cre === "number" ? new Date(cre).toISOString() : String(cre);
      const summary = strip(r.blogPost.description ?? "");
      return {
        id: r.blogPost.id,
        date,
        title: r.blogPost.name,
        ...(r.author ? { author: r.author } : {}),
        text: bodyText || summary,
        ...(summary && bodyText && summary !== bodyText ? { summary } : {}),
        ...(images ? { images } : {}),
        ...(r.recipientsNamesString ? { recipients: r.recipientsNamesString } : {}),
        comments: r.numberOfComments ?? 0,
      };
    });
  }
}
