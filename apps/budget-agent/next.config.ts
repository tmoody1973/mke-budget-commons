import type { NextConfig } from "next";
import { join } from "node:path";

// The monorepo root, two levels up from this app. Computed from process.cwd()
// (which is the app dir during `next build`) rather than __dirname — __dirname is
// undefined when the config is loaded as ESM (e.g. under `vercel build`), which
// silently invalidated turbopack.root and broke the Vercel build.
const monorepoRoot = join(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  // Pin the workspace root: this app lives in an npm workspace, and Next otherwise
  // guesses the root from the nearest lockfile (it wrongly picked ~/package-lock.json).
  // turbopack.root and outputFileTracingRoot MUST be equal (Next enforces it) and
  // both point at the monorepo root so file tracing includes the workspace package.
  turbopack: {
    root: monorepoRoot,
  },
  outputFileTracingRoot: monorepoRoot,
  // @mke/budget-tools ships raw TypeScript (no build step) — transpile it here.
  transpilePackages: ["@mke/budget-tools"],
  // Node/native packages with dynamic bits — keep them external to the bundler.
  // transformers.js / onnxruntime-node used to be here for WPF embeddings; they're
  // gone now that embedding is an HTTP call (the native addon was exactly what made
  // `explain` unrunnable on serverless in the first place).
  //
  // `ai` MUST be external. Arize tracing calls registerTelemetryIntegration() from
  // `ai`, which stashes the integration on globalThis — but that only reaches
  // CopilotKit's internal streamText if BOTH resolve to the SAME runtime module
  // instance. Bundled, Next gave our route one copy of `ai` and @copilotkit/runtime
  // another, so the registration was written into a registry nobody read: on Vercel
  // the tracing initialized and the exporter worked, yet not one telemetry callback
  // ever fired. Externalizing forces a single require()'d instance shared with
  // CopilotKit. (It works locally either way, which is what made this so slippery.)
  serverExternalPackages: ["pg", "ai"],
};

export default nextConfig;
