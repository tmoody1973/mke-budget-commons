import { CopilotRuntime, BuiltInAgent, createCopilotHonoHandler } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverTools } from "@/lib/tools/server-tools";

// Node runtime — the CopilotKit runtime + Anthropic SDK + pg need Node APIs, and
// this endpoint streams, so it must never be statically optimized.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Versioned system prompt: base Milwaukee Budget Expert + Journalist overlay.
// Read from cwd (the app dir under `next dev`/`next build`).
const promptsDir = join(process.cwd(), "prompts");
const systemPrompt = [
  readFileSync(join(promptsDir, "base.md"), "utf8"),
  readFileSync(join(promptsDir, "journalist.md"), "utf8"),
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
  maxSteps: 6, // 4–6 step "find the story" investigations
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
