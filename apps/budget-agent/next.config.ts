import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root: this app lives in an npm workspace, and Next otherwise
  // guesses the root from the nearest lockfile (it wrongly picked ~/package-lock.json).
  turbopack: {
    root: join(__dirname, "..", ".."),
  },
  // @mke/budget-tools ships raw TypeScript (no build step) — transpile it here.
  transpilePackages: ["@mke/budget-tools"],
  // Node/native packages with dynamic bits — keep them external to the bundler.
  // transformers.js (WPF embeddings) pulls onnxruntime-node + sharp; server-only
  // (the `explain` tool runs server-side), never in the client bundle.
  serverExternalPackages: ["pg", "@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
