import { defineConfig } from "@playwright/test";
import path from "node:path";
import { checkoutsRoot, createSampleCheckout } from "./tests/fixtures";

const port = 3211;

createSampleCheckout();

export default defineConfig({
  testDir: "./tests/integration",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    env: {
      PORT: String(port),
      IMPL_DEMO_STEP_MS: "500",
      IMPL_SEARCH_ROOTS: checkoutsRoot,
      // Isolate the suite from whatever .env the developer keeps locally.
      IMPL_ENV_FILE: path.join(checkoutsRoot, "absent.env"),
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
