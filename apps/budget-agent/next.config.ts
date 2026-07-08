import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root: this app lives in an npm workspace, and Next otherwise
  // guesses the root from the nearest lockfile (it wrongly picked ~/package-lock.json).
  turbopack: {
    root: join(__dirname, "..", ".."),
  },
};

export default nextConfig;
