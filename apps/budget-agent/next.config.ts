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
  // transformers.js (WPF embeddings) pulls onnxruntime-node + sharp; server-only
  // (the `explain` tool runs server-side), never in the client bundle.
  serverExternalPackages: ["pg", "@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
