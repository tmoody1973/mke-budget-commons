/**
 * Next.js instrumentation hook — runs once per server process, before any request.
 *
 * The Arize/OTel stack is Node-only (and pulls native-ish deps), so it is imported
 * dynamically and only in the nodejs runtime. Importing it at module scope would
 * break the edge runtime build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startArizeTracing } = await import("./lib/tracing/arize");
  startArizeTracing();
}
