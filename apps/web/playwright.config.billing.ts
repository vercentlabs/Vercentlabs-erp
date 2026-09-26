import { defineConfig, devices } from "@playwright/test";

// Focused SaaS billing browser journeys against a temporary, isolated web
// server (port 3107) with billing enforcement ON and online checkout enabled,
// talking to a local Razorpay stand-in (port 3199). No real Razorpay
// credentials are used. Both servers are started and stopped by Playwright;
// nothing is left running afterwards.
//
//   pnpm --filter @vercentlabs/web test:e2e:billing
const PORT = 3107;
const STANDIN_PORT = 3199;
const BASE_URL = `http://localhost:${PORT}`;

export const BILLING_E2E_ENV = {
  RAZORPAY_MODE: "test",
  RAZORPAY_KEY_ID: "rzp_test_e2e_standin",
  RAZORPAY_KEY_SECRET: "e2e_standin_key_secret",
  RAZORPAY_WEBHOOK_SECRET: "e2e_standin_webhook_secret",
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "",
  RAZORPAY_API_BASE: `http://127.0.0.1:${STANDIN_PORT}/v1`,
  RAZORPAY_REQUEST_TIMEOUT_MS: "2000",
  STANDIN_URL: `http://127.0.0.1:${STANDIN_PORT}`,
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["billing-saas.spec.ts", "billing-expired-subscription.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 60_000,
    navigationTimeout: 180_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `node ../../tests/support/razorpay-standin.mjs --port ${STANDIN_PORT}`,
      url: `http://127.0.0.1:${STANDIN_PORT}/__control/subscriptions`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: BILLING_E2E_ENV,
    },
    {
      command: `npx --yes pnpm@11.21.0 dev -p ${PORT}`,
      url: `${BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        ...BILLING_E2E_ENV,
        APP_URL: BASE_URL,
        FORM_ALLOWED_ORIGINS: BASE_URL,
        BILLING_CHECKOUT_ENABLED: "true",
        BILLING_ENFORCEMENT_MODE: "enforce",
        // Own build directory: runs alongside a developer's `pnpm dev` without sharing its lock or cache.
        NEXT_DIST_DIR: ".next/billing-e2e",
      },
    },
  ],
  projects: [{ name: "billing", use: { ...devices["Desktop Chrome"] } }],
});
