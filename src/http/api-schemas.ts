/**
 * Schemas of the REST answers that are not an operation's own output: the session
 * endpoint and the connector's projection of `list_children`. The router validates the
 * session answer with it; the reference, the OpenAPI document and the typed client are
 * generated from them, so all four describe the same shape.
 */
import { z } from "zod";

export const ConnectorChildSchema = z.object({
  id: z.number().int().describe("Child id; use it as {childId}"),
  firstName: z.string(),
});

/** `GET /api/v1/children`: only the children in this connection, no guardian name. */
export const ConnectorChildrenSchema = z.object({
  children: z
    .array(ConnectorChildSchema)
    .describe("The children in this connection, { id, firstName }"),
  childInFocus: z
    .number()
    .int()
    .nullable()
    .describe("The child reads default to, when it is in this grant; else null"),
});

export const PortalHealthSchema = z.object({
  state: z
    .enum(["ok", "backing_off", "paused", "probing"])
    .describe(
      "`ok`: requests to the school portal flow; `backing_off`: a short pause after the portal pushed back; `paused`: the portal pushed back repeatedly and the connector sends it nothing until `retryAt`; `probing`: the next request tests whether it answers again",
    ),
  retryAt: z.iso
    .datetime()
    .nullable()
    .describe("When requests flow again; null while they flow or a probe decides"),
});

/** `GET /api/v1/session`: what the connection may do and whether the connector can serve it. */
export const SessionSchema = z.object({
  schoolsoft: z.object({
    signedIn: z.boolean().describe("The connector's SchoolSoft session is present and valid"),
    loginInProgress: z.boolean().describe("The parent started a sign-in that has not finished"),
    webSession: z
      .boolean()
      .describe(
        "A gated web-login session is stored (the connector does not offer one; always false today)",
      ),
    portal: PortalHealthSchema,
  }),
  children: z
    .array(ConnectorChildSchema)
    .describe(
      "The children this connection may read, { id, firstName } as /children returns them; empty while signed out",
    ),
  scopes: z.array(z.string()).describe("The operations this token may call"),
  routes: z
    .array(
      z.object({
        operation: z.string(),
        method: z.literal("GET"),
        path: z.string(),
      }),
    )
    .describe("{ operation, method, path } for each route the scopes allow"),
  ownerDashboard: z.string().describe("Where the parent signs in to SchoolSoft again"),
  connectionExpiresAt: z.iso.datetime().describe("When this connection's approval expires"),
});
export type Session = z.infer<typeof SessionSchema>;
