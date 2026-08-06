import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the production build+start command (not `next dev`) so what we
 * validate matches what actually ships — see docs/landing-redesign/phase-2/
 * production-deployment.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "node scripts/prepare-standalone.mjs && node .next/standalone/apps/landing/server.js",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { PORT: "3000", HOSTNAME: "0.0.0.0", NODE_ENV: "production" },
      },
});
