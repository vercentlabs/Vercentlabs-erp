import { defineConfig, devices } from "@playwright/test";
import { config as loadDotEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

// Prompt 6 (final self-closing pass): this config previously read
// ERP_E2E_EMAIL/PASSWORD straight from the invoking shell's environment,
// with nothing in the repo actually loading them from a file — the only
// way to populate them was a human manually exporting a value they'd been
// told out-of-band. This loads the SAME `.env.local` every other local
// command in this repo already reads (never overriding real shell env),
// plus a dedicated, gitignored `.env.e2e.local` that
// `scripts/e2e-fixture-bootstrap.mjs` writes — run that script once (or
// after credentials need rotating) and `pnpm test:e2e:crm` picks them up
// automatically, with no manual env-var preparation and no secret ever
// committed to source.
for (const file of [
  path.resolve(".env.local"),
  path.resolve(".env.e2e.local"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

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
        // next.config sets output: "standalone" — "next start" does not
        // serve a standalone build correctly (it prints a warning and the
        // app never actually functions, which silently broke this gate:
        // the login POST always failed same-origin below because the app
        // was never really listening as expected). Mirrors
        // apps/landing/playwright.config.ts's own standalone workaround.
        // The standalone server.js is a minimal Node HTTP server with none
        // of Next's own dev-time .env.local auto-loading — every runtime
        // env var (DATABASE_URL etc.) must already be in process.env when
        // it starts. Preload the same local .env.local every other local
        // command in this repo already uses via the `dotenv` dependency
        // apps/web already declares, rather than duplicating secrets into
        // this config.
        command:
          "node scripts/prepare-standalone.mjs && node -r dotenv/config .next/standalone/apps/web/server.js dotenv_config_path=.env.local",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          PORT: "3201",
          HOSTNAME: "127.0.0.1",
          // Must match `baseURL` above exactly — assertSameOrigin() (core/
          // security.ts) rejects any login/mutation POST whose Origin
          // header isn't in this list, and .env.local's default
          // (localhost:3001) doesn't cover the dedicated E2E port.
          // Deliberately NOT setting NODE_ENV=production here: this repo's
          // session cookie is only marked `secure` under NODE_ENV=production
          // (core/auth.ts), which Playwright's plain-HTTP local server
          // cannot store — that would silently break every authenticated
          // test after login.
          FORM_ALLOWED_ORIGINS: baseURL,
        },
      },
});
