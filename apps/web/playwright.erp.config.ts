import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const externalBaseUrl = process.env.ERP_E2E_BASE_URL?.trim();
const baseURL = externalBaseUrl || "http://127.0.0.1:3201";
const authFile = path.resolve("test-results/erp-auth.json");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /erp-.*\.(?:spec|setup)\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate:
    "{testDir}/__snapshots__/{testFilePath}/{projectName}/{arg}{ext}",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /erp-auth\.setup\.ts/,
    },
    {
      name: "erp-chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      dependencies: ["setup"],
      testIgnore: /erp-auth\.setup\.ts/,
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "corepack pnpm exec next start -p 3201",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
