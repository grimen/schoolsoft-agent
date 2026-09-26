/**
 * The OpenAPI 3.1 document of `/api/v1`, built from the same tables and Zod schemas the
 * router serves and validates with: the generated routes, the overview, the session
 * endpoint and the problem types. `make docs` writes it to docs/reference/openapi.json;
 * the generated-docs test keeps that copy current. Pure: no Express, no I/O.
 */
import { z } from "zod";
import { API_BASE, restRoutes, type QueryShape, type RestRoute } from "./routes.js";
import { ConnectorChildrenSchema, SessionSchema } from "./api-schemas.js";
import { OVERVIEW_QUERY, OVERVIEW_SCOPES, OVERVIEW_SLUG, OverviewSchema } from "./overview.js";
import { PROBLEMS, PROBLEM_TYPE_PREFIX, ProblemSchema, type ProblemName } from "./problem.js";
import { REST_REQUESTS_PER_MINUTE } from "./rest.js";

/** The API's own version (the `v1` in the path), not the package's. */
export const API_VERSION = "1";
/** The connector's one OAuth protected resource, below the connector's origin. */
export const RESOURCE_PATH = "/mcp";

type Json = Record<string, unknown>;

/**
 * A Zod schema as the JSON Schema a response or parameter is described with. Objects
 * lose `additionalProperties: false`: new response fields are compatible within v1,
 * and clients must ignore fields they do not know.
 */
export function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output"): Json {
  const open = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(open);
    if (node === null || typeof node !== "object") return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$schema" || (key === "additionalProperties" && value === false)) continue;
      // Zod spells the formats out as regular expressions and bounds integers to the
      // safe range; `format` and `integer` already say that.
      if (key === "pattern" && "format" in node) continue;
      if ((key === "minimum" || key === "maximum") && Math.abs(value as number) === SAFE) continue;
      out[key] = open(value);
    }
    return out;
  };
  return open(z.toJSONSchema(schema, { io, unrepresentable: "any" })) as Json;
}
const SAFE = Number.MAX_SAFE_INTEGER;

/** Response components by name: one per answer shape. */
export function responseSchemas(): Record<string, z.ZodType> {
  const byOperation: Record<string, string> = {
    get_schedule: "Schedule",
    get_calendar: "Calendar",
    get_lunch_menu: "LunchMenu",
  };
  const schemas: Record<string, z.ZodType> = {
    Session: SessionSchema,
    Children: ConnectorChildrenSchema,
  };
  for (const route of restRoutes())
    if (route.childScoped) schemas[byOperation[route.operation.name]] = route.operation.output!;
  schemas.Overview = OverviewSchema;
  schemas.Problem = ProblemSchema;
  return schemas;
}

/** The component that answers a route. */
export function componentOf(route: Pick<RestRoute, "operation" | "childScoped">): string {
  if (!route.childScoped) return "Children";
  return (
    { get_schedule: "Schedule", get_calendar: "Calendar", get_lunch_menu: "LunchMenu" } as Record<
      string,
      string
    >
  )[route.operation.name];
}

/** `get_lunch_menu` → `getLunchMenu`, the client's and generators' operation id. */
export function operationId(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const CHILD_PARAMETER = {
  name: "childId",
  in: "path",
  required: true,
  description:
    "An `id` from `/children`; a child outside the connection's approval is refused with `403` before anything is read.",
  schema: { type: "integer", minimum: 1 },
};

function queryParameters(shape: QueryShape): Json[] {
  return shape.query.map((param) => ({
    name: param.name,
    in: "query",
    required: false,
    description: param.description,
    schema: jsonSchema(shape.schema.shape[param.name] as z.ZodType, "input"),
  }));
}

/** The statuses a route can answer, each with the problem types that use it. */
function problemResponses(names: readonly ProblemName[]): Json {
  const byStatus = new Map<number, ProblemName[]>();
  for (const name of names) {
    const status = PROBLEMS[name].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), name]);
  }
  const out: Json = {};
  for (const [status, problems] of [...byStatus].sort((a, b) => a[0] - b[0]))
    out[String(status)] = {
      description: problems.map((name) => `\`${name}\`: ${PROBLEMS[name].meaning}`).join(" "),
      content: { "application/problem+json": { schema: ref("Problem") } },
    };
  return out;
}

/** Problems every authenticated route can answer, before or around the handler. */
const COMMON: ProblemName[] = ["oauth-token", "foreign-origin", "rate-limited", "internal"];
/** Problems a route that reads through the runtime can answer. */
const READS: ProblemName[] = [
  "invalid-input",
  "scope-not-granted",
  "child-not-permitted",
  "schoolsoft-session",
  "web-session",
  "not-implemented",
  "response-drift",
  "upstream",
  "connector-busy",
  "portal-pushback",
  "not-available",
  "network",
];

function operation(options: {
  id: string;
  summary: string;
  description: string;
  scopes: readonly string[][];
  parameters: Json[];
  component: string;
  problems: readonly ProblemName[];
}): Json {
  return {
    get: {
      operationId: options.id,
      summary: options.summary,
      description: options.description,
      security: options.scopes.map((scopes) => ({ oauth: scopes })),
      parameters: options.parameters,
      responses: {
        "200": {
          description: "The validated answer",
          content: { "application/json": { schema: ref(options.component) } },
        },
        "401": {
          description:
            "The access token is missing, invalid or expired (the MCP SDK's RFC 6750 answer with `WWW-Authenticate`), or the connection was revoked while the request waited (`oauth-token`). Refresh the token once; connect again if that fails.",
        },
        ...problemResponses(options.problems.filter((name) => name !== "oauth-token")),
      },
    },
  };
}

/** The whole document. */
export function openApiDocument(): Json {
  const routes = restRoutes();
  const paths: Json = {
    "/session": operation({
      id: "getSession",
      summary: "Connection status",
      description:
        "What the calling connection may do and whether the connector can serve it now. Never starts a SchoolSoft login or BankID. Show data when `schoolsoft.signedIn` is true; otherwise link the parent to `ownerDashboard`, unless `schoolsoft.portal.state` is not `ok`.",
      scopes: [[]],
      parameters: [],
      component: "Session",
      problems: COMMON,
    }),
  };
  for (const route of routes) {
    const name = route.operation.name;
    paths[route.path.slice(API_BASE.length)] = operation({
      id: operationId(name),
      summary: route.operation.title,
      description: `Operation \`${name}\`, scope \`${name}\`. The answer is the operation's validated domain object; one that does not fit is a \`502\` \`response-drift\`.`,
      scopes: [[name]],
      parameters: [...(route.childScoped ? [CHILD_PARAMETER] : []), ...queryParameters(route)],
      component: componentOf(route),
      problems: [...COMMON, ...READS],
    });
  }
  paths[`/children/{childId}/${OVERVIEW_SLUG}`] = operation({
    id: "getOverview",
    summary: "One child's first paint",
    description:
      "The week's lessons and lunch and the next school event, each section `ok`, `not-granted` or `error` with its own problem, read in one turn of the connector's queue. No scope of its own: any one of the three section scopes admits the request, and a section whose scope is missing is `not-granted`. Weeks are ISO weeks named by their Europe/Stockholm dates.",
    scopes: OVERVIEW_SCOPES.map((scope) => [scope]),
    parameters: [CHILD_PARAMETER, ...queryParameters(OVERVIEW_QUERY)],
    component: "Overview",
    problems: [...COMMON, ...READS],
  });
  const scopes = Object.fromEntries(
    routes.map((route) => [route.operation.name, route.operation.title]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "schoolsoft-agent connector REST API",
      version: API_VERSION,
      description:
        "Read-only JSON for custom UIs, served by a parent-hosted schoolsoft-agent connector (an independent project; SchoolSoft AB is not involved). " +
        "Generated from the connector's own route table and Zod schemas (`make docs`); the human-readable reference is `docs/reference/rest-api.md`.\n\n" +
        `**Tokens.** Every request carries \`Authorization: Bearer <access token>\` from the connector's OAuth 2.1 authorization-code flow with PKCE (register with \`POST /register\` as a public client, then \`/authorize\` and \`/token\`). The connector is one OAuth protected resource named \`https://<connector>${RESOURCE_PATH}\`, also for REST: ask for tokens with \`resource=https://<connector>${RESOURCE_PATH}\`; its metadata is at \`/.well-known/oauth-protected-resource${RESOURCE_PATH}\`, and the \`401\` challenge on \`${API_BASE}\` points there. Access tokens live 5 minutes. Refresh tokens rotate, and presenting one twice revokes the whole connection: refresh one at a time.\n\n` +
        `**Problems.** Failures are \`application/problem+json\` with \`type\` \`${PROBLEM_TYPE_PREFIX}<name>\`; branch on \`type\`, \`status\`, \`kind\` and \`retryable\`, never on text. \`401\` is always the app's token; \`409\` is always the connector's SchoolSoft sign-in (send the parent to \`ownerDashboard\`).\n\n` +
        `**Limits.** Same-origin only (no CORS headers; another site's \`Origin\` is refused). ${REST_REQUESTS_PER_MINUTE} requests per minute per caller. New response fields may appear within v1: ignore fields you do not know.`,
    },
    servers: [
      {
        url: `https://{connector}${API_BASE}`,
        variables: {
          connector: { default: "connector.example", description: "Your connector's host" },
        },
      },
    ],
    security: [{ oauth: [] }],
    paths,
    components: {
      securitySchemes: {
        oauth: {
          type: "oauth2",
          description: `Authorization code with PKCE (S256), public clients. Resource indicator: \`https://<connector>${RESOURCE_PATH}\`. One scope per operation; the parent approves scopes and children on the connector's consent page.`,
          flows: {
            authorizationCode: {
              authorizationUrl: "/authorize",
              tokenUrl: "/token",
              refreshUrl: "/token",
              scopes,
            },
          },
        },
      },
      schemas: Object.fromEntries(
        Object.entries(responseSchemas()).map(([name, schema]) => [name, jsonSchema(schema)]),
      ),
    },
  };
}
