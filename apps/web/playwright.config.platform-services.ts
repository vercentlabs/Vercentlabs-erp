import { defineConfig, devices } from "@playwright/test";

import { FILE_STORAGE_LOCAL_ROOT, OAUTH_CLIENTS, OAUTH_STANDIN_PORT } from "./e2e/platform-services-env";

// Focused Shared Platform services journeys (developer API, webhooks, OAuth,
// numbering, governance, automations, reports, CRM attachments) against a
// temporary, isolated web server on its own port and build directory, plus
// the deterministic OAuth stand-in (tests/support/oauth-standin.mjs), so no
// real provider credentials are ever needed. Playwright starts and stops both.
//
//   pnpm --filter @vercentlabs/web test:e2e:platform-services
const PORT = 3109;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["platform-services.spec.ts"],
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
  webServer: [
    {
      command: `node ../../tests/support/oauth-standin.mjs --port ${OAUTH_STANDIN_PORT}`,
      port: OAUTH_STANDIN_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...OAUTH_CLIENTS },
    },
    {
      command: `npx --yes pnpm@11.21.0 dev -p ${PORT}`,
      url: `${BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        APP_URL: BASE_URL,
        FORM_ALLOWED_ORIGINS: BASE_URL,
        NEXT_DIST_DIR: ".next/platform-e2e",
        FILE_STORAGE_DRIVER: "local",
        FILE_STORAGE_LOCAL_ROOT,
        OAUTH_STANDIN_URL: `http://127.0.0.1:${OAUTH_STANDIN_PORT}`,
        ...OAUTH_CLIENTS,
      },
    },
  ],
  projects: [{ name: "platform-services", use: { ...devices["Desktop Chrome"] } }],
});
