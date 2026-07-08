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
// Model string is `provider/model`; claude-sonnet-4.5 is the newest Anthropic id
// this CopilotKit build knows by name (Sonnet 5 to be verified via passthrough).
const agent = new BuiltInAgent({
  model: "anthropic/claude-sonnet-4.5",
  prompt: systemPrompt,
  tools: serverTools,
  maxSteps: 6, // 4–6 step "find the story" investigations
});

const budgetRuntime = new CopilotRuntime({ agents: { default: agent } });

const app = createCopilotHonoHandler({
  runtime: budgetRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
