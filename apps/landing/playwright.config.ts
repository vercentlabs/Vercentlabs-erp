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
    // Phase 8: cross-browser coverage. Scoped to cross-browser-smoke.spec.ts
    // only (via testMatch) — re-running the full 578-test Chromium-oriented
    // suite on every engine would mostly re-validate browser-agnostic
    // internals (PII payload shape, attribution localStorage logic) that
    // don't vary by rendering engine. What actually needs cross-engine
    // coverage is rendering/layout/CSS/focus/console-error behavior on the
    // representative routes — that's what the smoke spec targets.
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } }, testMatch: /cross-browser-smoke\.spec\.ts/ },
    // Playwright's WebKit engine is the closest available proxy for Safari's
    // rendering engine — it is NOT Safari itself, and this is stated
    // explicitly everywhere this project's results are reported (see
    // docs/landing-redesign/phase-8/cross-browser-validation.md).
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } }, testMatch: /cross-browser-smoke\.spec\.ts/ },
    { name: "mobile-webkit", use: { ...devices["iPhone 14"] }, testMatch: /cross-browser-smoke\.spec\.ts/ },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "node scripts/prepare-standalone.mjs && node .next/standalone/apps/landing/server.js",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        // TRUSTED_PROXY_IP_HEADER: the rate-limit tests (lead-reliability.spec.ts)
        // simulate distinct clients via x-forwarded-for. Since Phase 8's security
        // fix (decision-log.md) made clientIp() ignore that header unless a
        // trusted-proxy header is explicitly configured, tests need it set here —
        // exactly mirroring how a real deployment behind a trusted reverse proxy
        // would configure it, not a test-only bypass.
        env: { PORT: "3000", HOSTNAME: "0.0.0.0", NODE_ENV: "production", TRUSTED_PROXY_IP_HEADER: "x-forwarded-for" },
      },
});
