/** `get-messages --format text`: the inbox as rows, unread ones marked and emphasised. */
import type { Message } from "../../../core/index.js";
import { label } from "../labels.js";
import { cell, renderer, strong, type Line } from "../render.js";
import { table } from "../table.js";
import { stockholm } from "../time.js";

interface Inbox {
  messages: Message[];
}

export const messagesText = renderer<Inbox>((data, { lang, width }) => {
  const unread = data.messages.filter((m) => !m.read).length;
  const heading = label(lang, "inboxHeading", { unread });
  if (data.messages.length === 0) return [heading, "", label(lang, "noMessages")];
  const rows = table(
    [
      ["", label(lang, "id"), label(lang, "date"), label(lang, "from"), label(lang, "subject")],
      ...data.messages.map((m) => {
        const sent = stockholm(m.sentAt);
        return [
          (m.read ? " " : "*") + (m.hasAttachments ? "+" : ""),
          String(m.id),
          `${sent.date} ${sent.time}`,
          cell(m.sender?.name ?? null),
          cell(m.subject),
        ];
      }),
    ],
    { flex: 4, width },
  );
  const [header, ...body] = rows;
  const marked: Line[] = body.map((row, i) => (data.messages[i].read ? row : strong(row)));
  return [heading, "", header, ...marked, "", label(lang, "unreadLegend")];
});
