import { defineConfig, devices } from "@playwright/test";

// Focused Shared Runtime browser journeys (notifications, approvals, audit,
// search, background tasks) against a temporary, isolated web server on its
// own port and build directory, so it runs alongside a developer's `pnpm dev`
// without sharing its lock or cache. Playwright starts and stops the server.
//
//   pnpm --filter @vercentlabs/web test:e2e:shared-runtime
const PORT = 3108;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["shared-runtime.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  // First hits compile routes on demand in `next dev`.
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 60_000,
    navigationTimeout: 180_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx --yes pnpm@11.21.0 dev -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { APP_URL: BASE_URL, FORM_ALLOWED_ORIGINS: BASE_URL, NEXT_DIST_DIR: ".next/runtime-e2e" },
  },
  projects: [{ name: "shared-runtime", use: { ...devices["Desktop Chrome"] } }],
});
