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
  // pg is a Node driver with dynamic/native bits — keep it external to the bundler.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
