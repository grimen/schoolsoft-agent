/** `get-news --format text`: newest first, unread ones marked and emphasised. */
import type { ChildRef, NewsItem } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, strong, type Line } from "../render.js";
import { table } from "../table.js";
import { stockholm } from "../time.js";

interface News {
  child: ChildRef;
  news: NewsItem[];
}

export const newsText = renderer<News>((data, { lang, width }) => {
  const heading = label(lang, "newsHeading", {
    child: cell(data.child.firstName),
    unread: data.news.filter((n) => !n.read).length,
  });
  if (data.news.length === 0) return [heading, "", label(lang, "noNews")];
  const sorted = [...data.news].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  const [header, ...body] = table(
    [
      ["", label(lang, "date"), label(lang, "from"), label(lang, "title")],
      ...sorted.map((n) => {
        const published = stockholm(n.publishedAt);
        return [
          (n.read ? " " : "*") + (n.hasAttachments ? "+" : ""),
          `${published.date} ${published.time}`,
          cell(n.author),
          cell(n.title),
        ];
      }),
    ],
    { flex: 3, width },
  );
  const rows: Line[] = body.map((row, i) => (sorted[i].read ? row : strong(row)));
  return [heading, "", header, ...rows, "", label(lang, "unreadLegend")];
});
