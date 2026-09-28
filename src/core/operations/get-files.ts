import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, withChild, FreshSchema } from "./_shared.js";
import { ChildRefSchema, SharedFileSchema } from "../domain/schemas.js";

export const getFiles = defineOperation({
  name: "get_files",
  title: "Get files and links",
  description: `List files and links the school shares with guardians (Alla filer & länkar).

Served through the headless browser (no API); run "schoolsoft-agent browser install" once.
Returns links only; it does not download files.

Args:
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { child: { id, firstName }, files: [{ id, name, url, kind: "file" | "link", category }] }.

Use when: "finns det något dokument från skolan om …", "länken till fritids".`,
  input: { child_id: ChildSchema, fresh: FreshSchema },
  output: z.object({ child: ChildRefSchema, files: z.array(SharedFileSchema) }),
  portal: ["getFiles"],
  annotations: READ_ONLY,
  async run(ctx, { child_id }) {
    const { childRef } = await withChild(ctx, child_id);
    const files = await ctx.portal.getFiles();
    return { child: childRef, files };
  },
});
