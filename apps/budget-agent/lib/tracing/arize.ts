import "server-only";
import { trace, context as otelContext, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  SemanticConventions as SC,
  OpenInferenceSpanKind,
  SEMRESATTRS_PROJECT_NAME,
} from "@arizeai/openinference-semantic-conventions";
import { registerTelemetryIntegration } from "ai";

/**
 * Arize AX tracing for the budget copilot.
 *
 * WHY IT LOOKS LIKE THIS (the non-obvious part):
 *
 * The canonical Arize path for AI SDK v6 is @arizeai/openinference-vercel, which
 * transforms the OTel spans the AI SDK emits natively. But the AI SDK only emits
 * those spans when a call passes `experimental_telemetry: { isEnabled: true }` —
 * it is per-call, with no global or env switch. We never make the model call: it
 * happens inside CopilotKit's BuiltInAgent, whose `BuiltInAgentClassicConfig` has
 * no passthrough for that flag. So the native-span route is closed to us unless we
 * take over the LLM call (CopilotKit "factory mode"), which would mean
 * re-implementing message conversion and tool merging — including
 * `forwardSystemMessages: false`, the app's prompt-injection posture. Not worth
 * re-deriving a security boundary to get telemetry.
 *
 * Instead we use `registerTelemetryIntegration()` from `ai` — a GLOBAL lifecycle
 * hook. In streamText the global integration's listeners are wired in
 * unconditionally (they are NOT gated on telemetry.isEnabled), so we observe every
 * step and every tool call of CopilotKit's internal generation while changing
 * nothing about how the agent runs. We author the OpenInference spans ourselves,
 * using the official semantic conventions, so what lands in Arize is canonical.
 *
 * Concurrency: we key in-flight tool timings by `toolCallId`, which is unique per
 * call — so we never rely on async-context propagation, which is exactly what
 * tends to break under a streaming response.
 */

const PROJECT_NAME = process.env.ARIZE_PROJECT_NAME ?? "mke-budget-agent";
const ARIZE_ENDPOINT = "https://otlp.arize.com/v1/traces";

/** Arize rejects spans (HTTP 500) without a project name — service.name alone is not enough. */
function buildProvider(spaceId: string, apiKey: string): NodeTracerProvider {
  return new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: PROJECT_NAME,
      [SEMRESATTRS_PROJECT_NAME]: PROJECT_NAME,
    }),
    spanProcessors: [
      // Simple, not Batch: a serverless function can freeze the moment the response
      // is flushed, and a batched span would never be exported. We emit one trace at
      // the end of a turn, so exporting immediately costs us nothing.
      new SimpleSpanProcessor(
        new OTLPTraceExporter({
          url: ARIZE_ENDPOINT,
          headers: { "arize-space-id": spaceId, "arize-api-key": apiKey },
        }),
      ),
    ],
  });
}

/** Truncate: a full budget tool result can be hundreds of KB; Arize doesn't need all of it. */
const MAX_ATTR_CHARS = 12_000;
function asJson(value: unknown): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  } catch {
    s = String(value);
  }
  return s.length > MAX_ATTR_CHARS ? `${s.slice(0, MAX_ATTR_CHARS)}…[truncated]` : s;
}

/** Flatten AI SDK message content (string | parts[]) into text for llm.input_messages. */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (p?.type === "text" ? p.text : p?.type ? `[${p.type}]` : ""))
      .join("");
  }
  return asJson(content);
}

function setMessages(span: Span, prefix: string, messages: any[] | undefined): void {
  if (!Array.isArray(messages)) return;
  messages.forEach((m, i) => {
    span.setAttribute(`${prefix}.${i}.${SC.MESSAGE_ROLE}`, String(m?.role ?? "unknown"));
    span.setAttribute(`${prefix}.${i}.${SC.MESSAGE_CONTENT}`, asJson(messageText(m?.content)));
  });
}

function setUsage(span: Span, usage: any): void {
  if (!usage) return;
  const { inputTokens, outputTokens, totalTokens } = usage;
  if (typeof inputTokens === "number") span.setAttribute(SC.LLM_TOKEN_COUNT_PROMPT, inputTokens);
  if (typeof outputTokens === "number") span.setAttribute(SC.LLM_TOKEN_COUNT_COMPLETION, outputTokens);
  if (typeof totalTokens === "number") span.setAttribute(SC.LLM_TOKEN_COUNT_TOTAL, totalTokens);
}

/** Exact tool timings, keyed by the globally-unique toolCallId. */
type ToolTiming = { startMs: number; endMs: number };
const toolTimings = new Map<string, ToolTiming>();

/**
 * Build the whole trace for one agent turn at onFinish, when every step, tool call,
 * and token count is known. Emitting atomically (rather than opening spans on
 * onStart and closing them later) means we never depend on async-context
 * propagation surviving a streamed response.
 */
function emitTurnTrace(tracer: Tracer, event: any): void {
  const steps: any[] = Array.isArray(event?.steps) && event.steps.length ? event.steps : [event];

  const firstTs = steps[0]?.response?.timestamp;
  const turnStartMs = firstTs instanceof Date ? firstTs.getTime() : Date.now();
  const turnEndMs = Date.now();

  const root = tracer.startSpan("agent turn", { startTime: turnStartMs });
  root.setAttribute(SC.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.AGENT);

  // The question that started the turn, and the answer that ended it.
  const inputMessages: any[] | undefined = steps[0]?.request?.body?.messages ?? undefined;
  const lastUser = [...(inputMessages ?? [])].reverse().find((m) => m?.role === "user");
  if (lastUser) root.setAttribute(SC.INPUT_VALUE, asJson(messageText(lastUser.content)));

  const finalText: string = steps[steps.length - 1]?.text ?? event?.text ?? "";
  root.setAttribute(SC.OUTPUT_VALUE, asJson(finalText));
  setUsage(root, event?.totalUsage);

  const rootCtx = trace.setSpan(otelContext.active(), root);

  steps.forEach((step, i) => {
    const stepTs = step?.response?.timestamp;
    const stepStartMs = stepTs instanceof Date ? stepTs.getTime() : turnStartMs;
    const nextTs = steps[i + 1]?.response?.timestamp;
    const stepEndMs = nextTs instanceof Date ? nextTs.getTime() : turnEndMs;

    const llm = tracer.startSpan(
      `llm step ${step?.stepNumber ?? i}`,
      { startTime: stepStartMs },
      rootCtx,
    );
    llm.setAttribute(SC.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.LLM);
    if (step?.model?.modelId) llm.setAttribute(SC.LLM_MODEL_NAME, String(step.model.modelId));
    if (step?.model?.provider) llm.setAttribute(SC.LLM_PROVIDER, String(step.model.provider));
    if (step?.finishReason) llm.setAttribute("llm.finish_reason", String(step.finishReason));
    setUsage(llm, step?.usage);
    setMessages(llm, SC.LLM_INPUT_MESSAGES, step?.request?.body?.messages);
    if (step?.text) llm.setAttribute(SC.OUTPUT_VALUE, asJson(step.text));

    const llmCtx = trace.setSpan(otelContext.active(), llm);

    // One TOOL span per tool call, with its result paired back in by toolCallId.
    const calls: any[] = Array.isArray(step?.toolCalls) ? step.toolCalls : [];
    const results: any[] = Array.isArray(step?.toolResults) ? step.toolResults : [];

    for (const call of calls) {
      const id = String(call?.toolCallId ?? "");
      const timing = toolTimings.get(id);
      toolTimings.delete(id);

      const tStart = timing?.startMs ?? stepStartMs;
      const tEnd = timing?.endMs ?? stepEndMs;

      const toolSpan = tracer.startSpan(
        String(call?.toolName ?? "tool"),
        { startTime: tStart },
        llmCtx,
      );
      toolSpan.setAttribute(SC.OPENINFERENCE_SPAN_KIND, OpenInferenceSpanKind.TOOL);
      toolSpan.setAttribute(SC.TOOL_NAME, String(call?.toolName ?? "unknown"));
      if (id) toolSpan.setAttribute(SC.TOOL_CALL_ID, id);
      toolSpan.setAttribute(SC.INPUT_VALUE, asJson(call?.input ?? call?.args));
      toolSpan.setAttribute(SC.INPUT_MIME_TYPE, "application/json");

      const result = results.find((r) => r?.toolCallId === call?.toolCallId);
      const output = result?.output ?? result?.result;
      if (output !== undefined) {
        toolSpan.setAttribute(SC.OUTPUT_VALUE, asJson(output));
        toolSpan.setAttribute(SC.OUTPUT_MIME_TYPE, "application/json");
      }

      // Our tools never throw — server-tools.ts `safe()` converts failures into
      // { error }. Surface that as a real span error so it shows up in Arize.
      const errMsg =
        output && typeof output === "object" && typeof (output as any).error === "string"
          ? (output as any).error
          : undefined;
      if (errMsg) {
        toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
      }

      toolSpan.end(tEnd);
    }

    llm.end(stepEndMs);
  });

  root.end(turnEndMs);
}

let started = false;
let provider: NodeTracerProvider | undefined;

/** Idempotent: Next may evaluate this module more than once in dev. */
export function startArizeTracing(): void {
  if (started) return;

  const spaceId = process.env.ARIZE_SPACE_ID;
  const apiKey = process.env.ARIZE_API_KEY;

  // Fail gracefully — tracing is never allowed to take the app down.
  if (!spaceId || !apiKey) {
    console.warn(
      "[arize] ARIZE_SPACE_ID / ARIZE_API_KEY not set — agent tracing is disabled.",
    );
    return;
  }

  started = true;
  provider = buildProvider(spaceId, apiKey);
  provider.register();
  const tracer = trace.getTracer("mke-budget-agent", "1.0.0");

  registerTelemetryIntegration({
    onToolCallStart: (e: any) => {
      const id = e?.toolCall?.toolCallId;
      if (id) toolTimings.set(String(id), { startMs: Date.now(), endMs: Date.now() });
    },
    onToolCallFinish: (e: any) => {
      const id = e?.toolCall?.toolCallId;
      if (!id) return;
      const existing = toolTimings.get(String(id));
      const endMs = Date.now();
      const startMs =
        existing?.startMs ??
        (typeof e?.durationMs === "number" ? endMs - e.durationMs : endMs);
      toolTimings.set(String(id), { startMs, endMs });
    },
    // Async on purpose. The AI SDK AWAITS each telemetry listener, so awaiting the
    // flush here holds the generation open until the spans are actually shipped.
    //
    // That is load-bearing on serverless: a Vercel function is frozen the moment the
    // response flushes, which killed the in-flight OTLP request and silently dropped
    // every production trace (local and `next start` both worked — only Vercel lost
    // them). Blocking on the flush costs a few hundred ms at the end of a turn that
    // already takes tens of seconds, and it is the difference between having
    // production traces and not having them.
    onFinish: async (e: any) => {
      try {
        emitTurnTrace(tracer, e);
        await provider?.forceFlush();
      } catch (err) {
        // A tracing bug must never surface as a broken chat.
        console.error("[arize] failed to emit trace:", err);
      }
    },
  });

  console.log(`[arize] agent tracing enabled → project "${PROJECT_NAME}"`);
}
