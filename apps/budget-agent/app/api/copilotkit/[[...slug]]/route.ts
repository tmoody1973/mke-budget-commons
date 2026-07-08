import { CopilotRuntime, BuiltInAgent, createCopilotHonoHandler } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

// Node runtime — the CopilotKit runtime + Anthropic SDK need Node APIs, and this
// endpoint streams, so it must never be statically optimized.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BuiltInAgent reads ANTHROPIC_API_KEY from the environment automatically.
// Model string is `provider/model`; claude-sonnet-4.5 is the newest Anthropic id
// this CopilotKit build knows by name (Sonnet 5 to be verified via passthrough).
const agent = new BuiltInAgent({
  model: "anthropic/claude-sonnet-4.5",
  prompt: "You are the Milwaukee Budget Expert.",
  tools: [],
  maxSteps: 6,
});

const budgetRuntime = new CopilotRuntime({ agents: { default: agent } });

const app = createCopilotHonoHandler({
  runtime: budgetRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
