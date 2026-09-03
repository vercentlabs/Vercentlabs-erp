import { defineConfig, devices } from "@playwright/test";

/**
 * Runs against the production build+start command (not `next dev`) so what we
 * validate matches what actually ships — see docs/landing-redesign/phase-2/
 * production-deployment.md.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Keep logical parallelism but bound simultaneous browsers against the
  // single production Next.js test server. Unbounded/default worker
  // scheduling caused cross-file navigation/hydration starvation in the
  // full 544-test release gate despite focused suites being green.
  // Windows Chromium can exhaust the local socket/buffer pool during the
  // complete 544-test production-navigation matrix. Keep every test and
  // every browser, but serialize local Windows browser execution. Linux
  // and CI runners retain two workers.
  workers: process.platform === "win32" ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, testIgnore: /visual-review\.spec\.ts/ },
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
  // Dedicated E2E loopback: avoid collisions with the normal landing dev
  // server on :3000 and avoid localhost IPv4/IPv6 resolution ambiguity
  // on Windows. Never silently reuse an older process when certifying.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "node scripts/prepare-standalone.mjs && node .next/standalone/apps/landing/server.js",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: false,
        timeout: 90_000,
        // TRUSTED_PROXY_IP_HEADER: the rate-limit tests (lead-reliability.spec.ts)
        // simulate distinct clients via x-forwarded-for. Since Phase 8's security
        // fix (decision-log.md) made clientIp() ignore that header unless a
        // trusted-proxy header is explicitly configured, tests need it set here —
        // exactly mirroring how a real deployment behind a trusted reverse proxy
        // would configure it, not a test-only bypass.
        env: { PORT: "3100", HOSTNAME: "127.0.0.1", NODE_ENV: "production", TRUSTED_PROXY_IP_HEADER: "x-forwarded-for" },
      },
});
