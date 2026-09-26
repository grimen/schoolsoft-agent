/**
 * `--format text` output: the operation's view when it has one, otherwise
 * pretty JSON on stdout (still parseable) with one note on stderr saying
 * why there is no view. The JSON default never passes through here.
 */
import { detectLang } from "../../core/index.js";
import type { CliDeps } from "../program.js";
import { label } from "./labels.js";
import type { RenderContext } from "./render.js";
import { toText } from "./render.js";
import { textRenderer } from "./registry.js";
import { colorEnabled, outputWidth } from "./terminal.js";
import { stockholmDate } from "./time.js";

export const FORMATS = ["json", "text"] as const;

export type TextDeps = Pick<CliDeps, "stdout" | "stderr" | "env" | "isTTY" | "columns" | "now">;

/** Language, width and today's Stockholm date for a render, from the injected deps. */
export function renderContext(deps: TextDeps): RenderContext {
  return {
    lang: detectLang(deps.env),
    width: outputWidth(deps),
    today: stockholmDate((deps.now ?? Date.now)()),
  };
}

export function emitText(
  deps: TextDeps,
  data: unknown,
  operation: string | undefined,
  command: string,
): void {
  const ctx = renderContext(deps);
  const render = operation === undefined ? undefined : textRenderer(operation);
  if (render === undefined) {
    deps.stderr(label(ctx.lang, "fallback", { command }));
    deps.stdout(JSON.stringify(data, null, 2));
    return;
  }
  deps.stdout(toText(render(data, ctx), ctx.width, colorEnabled(deps)));
}
