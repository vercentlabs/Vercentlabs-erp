import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { offlineMailEnv } from "./e2e/offline-mail-env";

// The spec process runs CRM worker jobs and fixtures against the database
// itself (e2e/crm-worker.ts), so it needs the same database settings the dev
// server reads. Next loads apps/web/.env.local only for the server, so load it
// (then the repo .env) here too. process.loadEnvFile never overrides a variable
// that is already set, so values from the shell or CI keep precedence.
// Playwright runs from apps/web.
for (const file of [".env.local", "../../.env"]) {
  const envFile = path.resolve(process.cwd(), file);
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

// CRM browser journeys (F001–F030) against a temporary, isolated web server on
// its own port and build directory, so they run beside a developer's
// `pnpm dev` without sharing its lock, cache or leaked connections.
// Background steps (large lead imports, report runs) are completed by the
// real worker code from the spec process (e2e/crm-worker.ts); report files
// are written to local storage shared with the server.
//
//   pnpm --filter @vercentlabs/web test:e2e:crm
const PORT = Number(process.env.CRM_E2E_PORT ?? 3117);
const BASE_URL = `http://localhost:${PORT}`;
const STORAGE_ROOT = path.join(os.tmpdir(), "vercentlabs-crm-e2e-storage");
process.env.FILE_STORAGE_DRIVER = "local";
process.env.FILE_STORAGE_LOCAL_ROOT = STORAGE_ROOT;
process.env.QA_BASE_URL = BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "auth.setup.ts",
    "crm-mvp.spec.ts",
    "crm-completion.spec.ts",
    "crm-navigation.spec.ts",
    "crm-authorization.spec.ts",
    "crm-regression.spec.ts",
    "crm-public-booking.spec.ts",
    "opportunity-stage-transition.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  // First hits compile routes on demand in `next dev`.
  expect: { timeout: 60_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-crm", open: "never" }],
  ],
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
    timeout: 300_000,
    env: {
      ...offlineMailEnv(BASE_URL),
      APP_URL: BASE_URL,
      FORM_ALLOWED_ORIGINS: BASE_URL,
      NEXT_DIST_DIR: ".next/crm-e2e",
      FILE_STORAGE_DRIVER: "local",
      FILE_STORAGE_LOCAL_ROOT: STORAGE_ROOT,
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "crm",
      testIgnore: /auth\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/owner.json",
      },
      dependencies: ["setup"],
    },
  ],
});
