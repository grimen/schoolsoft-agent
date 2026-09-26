/**
 * The probe's MCP server: `probe_*` tools with fake data, each built to answer one
 * question about the host (docs/planning/specs/2026-09-26-host-probe.md). Nothing here
 * reaches the school portal or reads a session.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  UrlElicitationRequiredError,
  type CallToolResult,
  type ClientCapabilities,
  type ServerNotification,
  type ServerRequest,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
import { PACKAGE_VERSION } from "../../shared/version.js";
import type { ProbeLog, ProbeSurface, ProbeValue } from "./log.js";
import type { ProbeConfirmations } from "./confirmations.js";

export const PROBE_SERVER_NAME = "schoolsoft-agent probe";

/** The probe's OAuth scopes. `probe_read` is needed for any call. */
export const PROBE_SCOPES = {
  read: "probe_read",
  /** Advertised in `scopes_supported`, unticked at consent: challenged with an HTTP 403. */
  stepUp: "probe_step_up",
  /** Advertised, unticked: challenged in the tool result (`_meta["mcp/www_authenticate"]`). */
  stepUpMeta: "probe_step_up_meta",
  /** Never advertised; granted only when a host asks for it. Challenged with an HTTP 403. */
  stepUpHidden: "probe_step_up_hidden",
} as const;

interface ProbeTool {
  name: string;
  title: string;
  annotations: Required<Omit<ToolAnnotations, "title">>;
  /** Only over http: the scope a call must carry, and how its absence is challenged. */
  scope?: string;
  challenge?: "http_403" | "tool_result";
}
const hints = (
  readOnlyHint: boolean,
  destructiveHint: boolean,
  idempotentHint: boolean,
  openWorldHint: boolean,
) => ({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });

/** The tool table, in listing order. The results doc maps each row to its question. */
export const PROBE_TOOLS: readonly ProbeTool[] = [
  { name: "probe_read", title: "Probe: read", annotations: hints(true, false, true, false) },
  {
    name: "probe_read_open_world",
    title: "Probe: read (open world)",
    annotations: hints(true, false, true, true),
  },
  {
    name: "probe_write_reversible",
    title: "Probe: reversible write (does nothing)",
    annotations: hints(false, false, true, false),
  },
  {
    name: "probe_write_destructive",
    title: "Probe: destructive write (does nothing)",
    annotations: hints(false, true, false, true),
  },
  {
    name: "probe_elicit_form",
    title: "Probe: ask in a form",
    annotations: hints(true, false, false, false),
  },
  {
    name: "probe_elicit_url",
    title: "Probe: ask to open a page",
    annotations: hints(true, false, false, false),
  },
  {
    name: "probe_elicit_url_required",
    title: "Probe: require a page first",
    annotations: hints(true, false, false, false),
  },
  {
    name: "probe_confirmed_write",
    title: "Probe: preview and confirm a fake absence",
    annotations: hints(false, true, false, true),
  },
  {
    name: "probe_step_up",
    title: "Probe: needs an advertised extra scope",
    annotations: hints(true, false, true, false),
    scope: PROBE_SCOPES.stepUp,
    challenge: "http_403",
  },
  {
    name: "probe_step_up_meta",
    title: "Probe: needs an extra scope, asked in the result",
    annotations: hints(true, false, true, false),
    scope: PROBE_SCOPES.stepUpMeta,
    challenge: "tool_result",
  },
  {
    name: "probe_step_up_hidden",
    title: "Probe: needs an unadvertised extra scope",
    annotations: hints(true, false, true, false),
    scope: PROBE_SCOPES.stepUpHidden,
    challenge: "http_403",
  },
];

const DESCRIPTIONS: Record<string, string> = {
  probe_read:
    "Host probe (fake, reads nothing real): a read-only tool. Call it when the user asks to test the probe's read tool.",
  probe_read_open_world:
    "Host probe (fake, reads nothing real): a read-only tool marked as reaching an outside system. Call it when the user asks to test the open-world read.",
  probe_write_reversible:
    "Host probe (fake, changes nothing): a tool marked as a reversible, non-destructive write. Call it when the user asks to test the reversible write.",
  probe_write_destructive:
    "Host probe (fake, changes nothing): a tool marked as destructive. Call it when the user asks to test the destructive write.",
  probe_elicit_form:
    "Host probe (fake): asks the user a yes/no question in the host's own form (MCP form elicitation). Nothing is sent either way.",
  probe_elicit_url:
    "Host probe (fake): asks the host to let the user open a page on the probe (MCP URL elicitation). Nothing real happens on the page.",
  probe_elicit_url_required:
    "Host probe (fake): answers that a page must be opened first (MCP URL elicitation required error). Call it again after the user finished the page.",
  probe_confirmed_write:
    "Host probe (fake, sends nothing): pretend to report a made-up child absent, with a preview and a confirmation token like the real write framework. First call without confirmation: returns a preview. Show the preview to the user and call again with the same arguments and the confirmation only after they say yes; never on your own.",
  probe_step_up:
    "Host probe (fake): needs an extra permission that is advertised by the probe but not granted by default. The first call may ask the user to reconnect.",
  probe_step_up_meta:
    "Host probe (fake): needs an extra permission, asked for in the tool result the way ChatGPT apps document it. The first call may ask the user to reconnect.",
  probe_step_up_hidden:
    "Host probe (fake): needs an extra permission that the probe does not advertise. The first call may ask the user to reconnect.",
};

export interface UrlPage {
  id: string;
  session: string;
  createdAt: number;
  opened: boolean;
  completed: boolean;
  onComplete?: () => Promise<void>;
}

/** The pages URL elicitations point at. Ids are 32 random bytes; pages live 30 minutes. */
export class UrlPages {
  private readonly pages = new Map<string, UrlPage>();
  private readonly now: () => number;
  private readonly random: (size: number) => Buffer;
  private readonly max: number;
  constructor(
    private readonly base: () => Promise<string>,
    options: { now?: () => number; random?: (size: number) => Buffer; max?: number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? randomBytes;
    this.max = options.max ?? 64;
  }
  async create(
    session: string,
    onComplete?: () => Promise<void>,
  ): Promise<{ id: string; url: string }> {
    const base = await this.base();
    if (this.pages.size >= this.max) this.pages.delete(this.pages.keys().next().value!);
    const id = this.random(32).toString("base64url");
    this.pages.set(id, {
      id,
      session,
      createdAt: this.now(),
      opened: false,
      completed: false,
      onComplete,
    });
    return { id, url: `${base}/probe/elicit/${id}` };
  }
  get(id: string): UrlPage | undefined {
    const page = this.pages.get(id);
    if (page && page.createdAt + 30 * 60_000 <= this.now()) {
      this.pages.delete(id);
      return undefined;
    }
    return page;
  }
  open(id: string): UrlPage | undefined {
    const page = this.get(id);
    if (page) page.opened = true;
    return page;
  }
  /** Marks the page done and tells the host (`notifications/elicitation/complete`); once only. */
  async complete(id: string): Promise<boolean> {
    const page = this.get(id);
    if (!page || page.completed) return false;
    page.completed = true;
    try {
      await page.onComplete?.();
    } catch {
      // The session may be gone by now; the page still counts as completed.
    }
    return true;
  }
}

export interface ProbeToolContext {
  surface: ProbeSurface;
  log: ProbeLog;
  /** A short random tag for this MCP session; never the transport's session id. */
  session: string;
  confirmations: ProbeConfirmations;
  pages: UrlPages;
  now?: () => number;
  /** How long a host may take to answer an elicitation (a person is reading). */
  elicitTimeoutMs?: number;
  /** http only: the protected-resource metadata URL for step-up challenges. */
  resourceMetadataUrl?: string;
}

const say = (text: string, structuredContent?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text }],
  ...(structuredContent ? { structuredContent } : {}),
});

const PART_WORDS = { whole_day: "whole day", morning: "morning", afternoon: "afternoon" };
const FORM_PREVIEW =
  "Probe (fake): Report Probe Child absent on Monday, whole day. Probe Child is not a real child and nothing will reach any school. Nothing has been sent. Send this?";

/**
 * Every message the host sends, by JSON-RPC method (responses as "response"), before the
 * SDK sees it. `initialize` is recorded from the raw request: the SDK rewrites a legacy
 * `elicitation: {}` into form mode, and the raw shape is part of the answer.
 */
export function tapMessages(transport: Transport, log: ProbeLog, session: string): void {
  const original = transport.onmessage;
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP transports take one onmessage callback.
  transport.onmessage = (message, extra) => {
    const method = "method" in message ? message.method : "response";
    const params = "params" in message ? (message.params as Record<string, unknown>) : undefined;
    // 2026-07-28 moves client capabilities into every request's _meta.
    const perRequest = (params?.["_meta"] as Record<string, unknown> | undefined)?.[
      "io.modelcontextprotocol/clientCapabilities"
    ];
    log.record({
      event: "rpc",
      session,
      method,
      ...(perRequest && typeof perRequest === "object"
        ? { metaCapabilities: Object.keys(perRequest).sort() }
        : {}),
    });
    if (method === "initialize") {
      const info = (params?.clientInfo ?? {}) as { name?: unknown; version?: unknown };
      log.record({
        event: "initialize",
        session,
        client: String(info.name ?? "unknown").slice(0, 60),
        clientVersion: String(info.version ?? "unknown").slice(0, 40),
        protocolVersion: String(params?.protocolVersion).slice(0, 20),
        ...capabilities(params?.capabilities as ClientCapabilities | undefined),
      });
    }
    original?.(message, extra);
  };
}

/**
 * ChatGPT reads a top-level `securitySchemes` on each listed tool (its apps
 * documentation); MCP has no such field, so it is added to `tools/list` answers on the
 * way out. Other hosts ignore it.
 */
export function advertiseSecuritySchemes(transport: Transport): void {
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    const tools = "result" in message ? (message.result as { tools?: unknown }).tools : undefined;
    if (Array.isArray(tools))
      for (const tool of tools as { name: string; securitySchemes?: unknown }[]) {
        const scope = PROBE_TOOLS.find((candidate) => candidate.name === tool.name)?.scope;
        tool.securitySchemes = [
          { type: "oauth2", scopes: scope ? [PROBE_SCOPES.read, scope] : [PROBE_SCOPES.read] },
        ];
      }
    return send(message, options);
  };
}

function capabilities(caps: ClientCapabilities | undefined) {
  const elicitation = caps?.elicitation as Record<string, unknown> | undefined;
  return {
    // An empty `elicitation: {}` is the pre-2025-11-25 declaration and means form mode.
    elicitationForm: Boolean(elicitation && (elicitation.form || !Object.keys(elicitation).length)),
    elicitationUrl: Boolean(elicitation?.url),
    elicitation: elicitation ? Object.keys(elicitation).sort() : null,
    sampling: Boolean(caps?.sampling),
    roots: Boolean(caps?.roots),
    declared: Object.keys(caps ?? {}).sort(),
  };
}

export function createProbeServer(ctx: ProbeToolContext): McpServer {
  const now = ctx.now ?? Date.now;
  const timeout = ctx.elicitTimeoutMs ?? 10 * 60_000;
  const server = new McpServer({ name: PROBE_SERVER_NAME, version: PACKAGE_VERSION });
  const record = (event: string, fields: Record<string, ProbeValue>) =>
    ctx.log.record({ event, session: ctx.session, ...fields });
  const clockTime = () => new Date(now()).toISOString().slice(11, 19);
  let requiredPage: string | undefined;

  const tools = PROBE_TOOLS.filter((tool) => !tool.scope || ctx.surface === "http");
  for (const tool of tools) {
    const input: z.ZodRawShape =
      tool.name === "probe_confirmed_write"
        ? {
            date: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .describe("Made-up absence date, YYYY-MM-DD."),
            part: z
              .enum(["whole_day", "morning", "afternoon"])
              .optional()
              .describe("Part of the day. Default whole_day."),
            confirmation: z
              .string()
              .max(200)
              .optional()
              .describe(
                "The confirmation from the preview. Only after the user said yes to that preview.",
              ),
          }
        : {};
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: DESCRIPTIONS[tool.name],
        inputSchema: input,
        annotations: { title: tool.title, ...tool.annotations },
      },
      async (args: Record<string, unknown>, extra: ToolExtra) => {
        record("tool_call", { tool: tool.name, args: Object.keys(args).sort() });
        const binding = extra.authInfo?.extra?.grantId
          ? `grant:${String(extra.authInfo.extra.grantId)}`
          : "local";
        const caps = server.server.getClientCapabilities();
        const elicit = async (mode: "form" | "url", params: Record<string, unknown>) => {
          const started = now();
          try {
            const result = await server.server.elicitInput(params as never, {
              relatedRequestId: extra.requestId,
              timeout,
            });
            const confirmed = result.action === "accept" && result.content?.confirm === true;
            record("elicitation", {
              tool: tool.name,
              mode,
              outcome: result.action,
              confirmed,
              ms: now() - started,
            });
            return say(
              `Probe: the ${mode} elicitation was answered "${result.action}"${
                mode === "form" && result.action === "accept"
                  ? ` with "${confirmed ? "yes, send" : "no"}"`
                  : ""
              }. Nothing was sent.`,
            );
          } catch (error) {
            const code = String((error as { code?: unknown }).code);
            record("elicitation", { tool: tool.name, mode, outcome: "error", code });
            return {
              ...say(`Probe: the ${mode} elicitation failed (code ${code}). Nothing was sent.`),
              isError: true,
            };
          }
        };
        const unsupported = (mode: "form" | "URL") => {
          record("elicitation", {
            tool: tool.name,
            mode: mode.toLowerCase(),
            outcome: "unsupported",
          });
          return say(
            `Probe: the host did not declare ${mode} elicitation, so nothing was asked. Tell the user exactly this.`,
          );
        };
        switch (tool.name) {
          case "probe_elicit_form":
            if (!caps?.elicitation?.form) return unsupported("form");
            return elicit("form", {
              mode: "form",
              message: FORM_PREVIEW,
              requestedSchema: {
                type: "object",
                properties: {
                  confirm: {
                    type: "boolean",
                    title: "Send this?",
                    description: "Probe only: nothing is sent either way.",
                  },
                },
                required: ["confirm"],
              },
            });
          case "probe_elicit_url": {
            if (!caps?.elicitation?.url) return unsupported("URL");
            const page = await ctx.pages.create(ctx.session, () =>
              server.server.createElicitationCompletionNotifier(page.id)(),
            );
            return elicit("url", {
              mode: "url",
              elicitationId: page.id,
              url: page.url,
              message:
                "Probe (fake): open the probe's page and press Done. Nothing real happens there.",
            });
          }
          case "probe_elicit_url_required": {
            if (!caps?.elicitation?.url) return unsupported("URL");
            if (requiredPage !== undefined) {
              const done = ctx.pages.get(requiredPage)?.completed === true;
              record("url_required", {
                tool: tool.name,
                step: done ? "retried_after_completion" : "retried_early",
              });
              if (done) {
                requiredPage = undefined;
                return say(
                  "Probe: the host retried after the page was completed. Nothing was sent.",
                );
              }
            }
            const page = await ctx.pages.create(ctx.session, () =>
              server.server.createElicitationCompletionNotifier(page.id)(),
            );
            requiredPage = page.id;
            record("url_required", { tool: tool.name, step: "required" });
            throw new UrlElicitationRequiredError(
              [
                {
                  mode: "url",
                  elicitationId: page.id,
                  url: page.url,
                  message:
                    "Probe (fake): open the probe's page and press Done, then ask me to try again.",
                },
              ],
              "Probe: open the page first.",
            );
          }
          case "probe_confirmed_write":
            return confirmedWrite(args, binding);
          default:
            if (tool.scope) {
              const granted = extra.authInfo?.scopes ?? [];
              if (tool.challenge === "tool_result" && !granted.includes(tool.scope)) {
                record("step_up", { tool: tool.name, outcome: "challenged_in_result", granted });
                return {
                  ...say(
                    `Probe: this call needs the scope ${tool.scope}. The host was asked to reconnect with it.`,
                  ),
                  isError: true,
                  _meta: {
                    "mcp/www_authenticate": [
                      `Bearer resource_metadata="${ctx.resourceMetadataUrl}", error="insufficient_scope", scope="${[...new Set([...granted, tool.scope])].join(" ")}", error_description="The probe needs the ${tool.scope} permission"`,
                    ],
                  },
                };
              }
              record("step_up", { tool: tool.name, outcome: "passed" });
              return say(
                `Probe: this call carried the scope ${tool.scope}, so the host re-authorised or it was granted. Nothing was changed.`,
              );
            }
            return say(
              `Probe: ${tool.name} ran at ${clockTime()} UTC and changed nothing. Nothing real was read or written.`,
            );
        }
      },
    );
  }

  function confirmedWrite(args: Record<string, unknown>, binding: string): CallToolResult {
    const date = String(args.date);
    const part = (args.part as keyof typeof PART_WORDS | undefined) ?? "whole_day";
    const intent = { tool: "probe_confirmed_write", date, part };
    if (typeof args.confirmation !== "string") {
      const preview = ctx.confirmations.preview(binding, intent);
      const expires = new Date(preview.expiresAt).toISOString().slice(11, 16);
      record("write", { step: "preview", writeId: preview.writeId });
      const lines = [
        { label: "Child", value: "Probe Child (made up)" },
        { label: "Date", value: date },
        { label: "Part of the day", value: PART_WORDS[part] },
      ];
      return say(
        [
          "Preview (probe, fake): Report Probe Child absent",
          ...lines.map((line) => `- ${line.label}: ${line.value}`),
          "Can it be undone: no (pretend).",
          `The confirmation expires at ${expires} UTC. Nothing has been sent.`,
          `Show this preview to the user. Call probe_confirmed_write again with the same arguments and confirmation "${preview.confirmation}" only after the user says yes; never on your own.`,
        ].join("\n"),
        {
          status: "preview",
          write_id: preview.writeId,
          confirmation: preview.confirmation,
          expires_at: new Date(preview.expiresAt).toISOString(),
          preview: { title: "Report Probe Child absent", lines },
        },
      );
    }
    const result = ctx.confirmations.confirm(binding, intent, args.confirmation);
    record("write", {
      step: "confirm",
      outcome: result.outcome,
      ...(result.writeId ? { writeId: result.writeId } : {}),
      ...(result.secondsSincePreview !== undefined
        ? { secondsSincePreview: result.secondsSincePreview }
        : {}),
    });
    if (result.outcome === "sent" || result.outcome === "replayed")
      return say(
        result.outcome === "sent"
          ? `Probe: pretend-sent once (write ${result.writeId}). Nothing reached any school.`
          : `Probe: already pretend-sent (write ${result.writeId}); nothing was sent again.`,
        { status: result.outcome, write_id: result.writeId },
      );
    const reasons = {
      invalid: "The confirmation is unknown, already used elsewhere, or for another caller.",
      expired: "The confirmation expired. Ask for a new preview.",
      input_changed:
        "The arguments changed since the preview, so the confirmation is void. Ask for a new preview and show it to the user.",
    };
    return {
      ...say(`Probe: not sent. ${reasons[result.outcome]}`, {
        status: "not_sent",
        reason: result.outcome,
      }),
      isError: true,
    };
  }
  return server;
}
