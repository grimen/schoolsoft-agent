/** The OpenAPI document against the router it describes, and the schema conversion. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getOperation } from "../../src/core/index.js";
import {
  API_VERSION,
  componentOf,
  jsonSchema,
  openApiDocument,
  operationId,
  responseSchemas,
} from "../../src/http/openapi.js";
import { restApi } from "../../src/http/rest.js";
import { API_BASE, restRoutes } from "../../src/http/routes.js";
import { OVERVIEW_QUERY, OVERVIEW_SCOPES } from "../../src/http/overview.js";
import { PROBLEMS } from "../../src/http/problem.js";

interface Operation {
  operationId: string;
  security: Record<string, string[]>[];
  parameters: { name: string; in: string; schema: Record<string, unknown> }[];
  responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }>;
}
const doc = openApiDocument() as {
  openapi: string;
  info: { version: string; description: string };
  paths: Record<string, { get: Operation }>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
    securitySchemes: {
      oauth: { flows: { authorizationCode: { scopes: Record<string, string> } } };
    };
  };
};

/** The GET paths the real router serves, in the document's `{childId}` spelling. */
function routerPaths(): string[] {
  const unused = () => {
    throw new Error("not called: the router is only inspected");
  };
  const router = restApi({
    publicUrl: "https://connector.example",
    oauth: { verifyAccessToken: unused, verifyGrant: unused },
    runtime: { execute: unused, executeForChild: unused, status: unused },
    lang: "en",
    perCaller: {},
  }) as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      assert.deepEqual(Object.keys(layer.route!.methods), ["get"], layer.route!.path);
      return layer.route!.path.replace(":childId", "{childId}");
    });
}

test("the document describes exactly the routes the router serves", () => {
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.version, API_VERSION, "the API's version, so a release changes nothing");
  assert.deepEqual(Object.keys(doc.paths).sort(), routerPaths().sort());
  for (const route of restRoutes()) {
    const get = doc.paths[route.path.slice(API_BASE.length)].get;
    assert.equal(get.operationId, operationId(route.operation.name));
    assert.deepEqual(get.security, [{ oauth: [route.operation.name] }]);
    assert.deepEqual(
      get.parameters.map((p) => `${p.in}:${p.name}`),
      [
        ...(route.childScoped ? ["path:childId"] : []),
        ...route.query.map((q) => `query:${q.name}`),
      ],
    );
    assert.equal(
      get.responses["200"].content!["application/json"].schema.$ref,
      `#/components/schemas/${componentOf(route)}`,
    );
  }
  const overview = doc.paths["/children/{childId}/overview"].get;
  assert.deepEqual(
    overview.security,
    OVERVIEW_SCOPES.map((scope) => ({ oauth: [scope] })),
    "any one section scope admits the overview",
  );
  assert.deepEqual(
    overview.parameters.map((p) => p.name),
    ["childId", ...OVERVIEW_QUERY.query.map((q) => q.name)],
  );
  assert.deepEqual(doc.paths["/session"].get.security, [{ oauth: [] }]);
  assert.deepEqual(
    Object.keys(doc.components.securitySchemes.oauth.flows.authorizationCode.scopes),
    restRoutes().map((route) => route.operation.name),
  );
});

test("parameters carry their Zod bounds; answers name every problem status they can meet", () => {
  const schedule = doc.paths["/children/{childId}/schedule"].get;
  assert.deepEqual(schedule.parameters[1].schema, {
    description: "ISO week number 1–53. Defaults to the current week.",
    type: "integer",
    minimum: 1,
    maximum: 53,
  });
  const statuses = Object.keys(schedule.responses);
  for (const status of [
    "200",
    "400",
    "401",
    "403",
    "409",
    "429",
    "500",
    "501",
    "502",
    "503",
    "504",
  ])
    assert.ok(statuses.includes(status), status);
  assert.equal(
    schedule.responses["409"].content!["application/problem+json"].schema.$ref,
    "#/components/schemas/Problem",
  );
  const session = Object.keys(doc.paths["/session"].get.responses);
  assert.deepEqual(session, ["200", "401", "403", "429", "500"]);
  assert.ok(Object.keys(PROBLEMS).length > 10);
  assert.match(doc.info.description, /resource=https:\/\/<connector>\/mcp/);
  assert.match(doc.info.description, /refresh one at a time/);
});

test("components are the answers' Zod schemas, open to new fields and without format regexes", () => {
  assert.deepEqual(Object.keys(doc.components.schemas), Object.keys(responseSchemas()));
  const text = JSON.stringify(doc.components.schemas);
  assert.doesNotMatch(text, /"additionalProperties":false/);
  assert.doesNotMatch(text, /"pattern"/);
  assert.doesNotMatch(text, /9007199254740991/);
  assert.deepEqual(
    doc.components.schemas.Schedule,
    jsonSchema(getOperation("get_schedule")!.output!),
  );
  assert.deepEqual(jsonSchema(z.object({ n: z.number().int(), d: z.iso.date() })), {
    type: "object",
    properties: { n: { type: "integer" }, d: { type: "string", format: "date" } },
    required: ["n", "d"],
  });
  assert.deepEqual(jsonSchema(z.object({ n: z.number().int().min(-5) }), "input"), {
    type: "object",
    properties: { n: { type: "integer", minimum: -5 } },
    required: ["n"],
  });
  assert.equal(operationId("get_lunch_menu"), "getLunchMenu");
  assert.equal(operationId("list_children"), "listChildren");
});
