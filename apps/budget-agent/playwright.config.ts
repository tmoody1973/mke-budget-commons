import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load the app's real secrets so (a) the skip guard can see ANTHROPIC_API_KEY and
// (b) the webServer Playwright starts inherits MCP_DATABASE_URL + the API key.
loadEnv({ path: ".env.local" });

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    // Turbopack dev prints to stderr; surface it if the server fails to boot.
    stdout: "pipe",
    stderr: "pipe",
  },
});
