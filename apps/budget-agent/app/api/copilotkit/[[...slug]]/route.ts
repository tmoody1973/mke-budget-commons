import { CopilotRuntime, BuiltInAgent, createCopilotHonoHandler } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverTools, wpfExplainAvailable } from "@/lib/tools/server-tools";
import { startArizeTracing } from "@/lib/tracing/arize";

// Arize tracing is started HERE, at module scope, and not from Next's
// `instrumentation.ts` register() hook. That hook simply never executes in this
// Vercel deployment — verified by putting a bare top-level console.log in
// instrumentation.ts and never seeing it in the function logs, while logs from this
// route module show up fine. So we initialize where we know the code actually loads.
//
// Module scope is early enough: this module is imported before any request is
// handled, and registerTelemetryIntegration() is global — it just has to run before
// the first generation. startArizeTracing() is idempotent.
startArizeTracing();

// Node runtime — the CopilotKit runtime + Anthropic SDK + pg need Node APIs, and
// this endpoint streams, so it must never be statically optimized.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A "find the story" investigation makes several sequential model calls plus tool
// DB round-trips — measured up to ~40s for deep questions (e.g. "explain a
// department's whole budget step by step"). Without this, the function used the
// low platform default (~10s) and timed out mid-stream: the tool cards had already
// streamed, but the closing narrative was cut off — so the answer looked like it
// "stopped after the chart." 90s gives deep investigations room to finish.
export const maxDuration = 90;

// Versioned system prompt: base Milwaukee Budget Expert + Journalist overlay.
// Read from cwd (the app dir under `next dev`/`next build`).
//
// base.md instructs the model to call `explain` for why/context questions. Where WPF
// retrieval is off (any deploy without WPF_EXPLAIN_ENABLED, which is prod today) that
// instruction is a lie, and the model burns a step calling a tool that only errors.
// Append an override so the prompt can never advertise a capability the tool layer
// lacks. The tool layer independently fails fast (see server-tools.ts) — this just
// stops the wasted call.
const promptsDir = join(process.cwd(), "prompts");
const systemPrompt = [
  readFileSync(join(promptsDir, "base.md"), "utf8"),
  readFileSync(join(promptsDir, "journalist.md"), "utf8"),
  ...(wpfExplainAvailable ? [] : [readFileSync(join(promptsDir, "no-wpf-explain.md"), "utf8")]),
].join("\n\n");

// BuiltInAgent reads ANTHROPIC_API_KEY from the environment automatically.
// Model string is `provider/model`; CopilotKit passes the bare model id through to
// the Anthropic API, so it must be a REAL API id. CopilotKit's built-in alias
// "claude-sonnet-4.5" is NOT a valid API id (404 not_found) — use the actual
// current id. claude-sonnet-5 is Sonnet 5 (the chosen model).
const agent = new BuiltInAgent({
  model: "anthropic/claude-sonnet-5",
  prompt: systemPrompt,
  tools: serverTools,
  maxSteps: 8, // headroom for a "find the story" investigation + the closing narrative
               // (the loop stops on stepCountIs(maxSteps); ending on a tool call = no synthesis)
  // Prompt-injection posture (explicit, not relying on defaults): our system
  // prompt is static and never concatenated with user input, and we do NOT
  // forward user-supplied system/developer-role messages to the model — so a
  // user can't smuggle in system instructions. Combined with read-only,
  // SELECT-only tools over public budget data, the blast radius of a jailbreak
  // is "the bot says something off-persona", never data loss or exfiltration.
  forwardSystemMessages: false,
  forwardDeveloperMessages: false,
});

const budgetRuntime = new CopilotRuntime({ agents: { default: agent } });

const app = createCopilotHonoHandler({
  runtime: budgetRuntime,
  basePath: "/api/copilotkit",
  // The v2 client defaults to single-route mode (fetchRuntimeInfoSingle); match it.
  mode: "single-route",
});

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
