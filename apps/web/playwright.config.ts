import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.QA_PORT ?? "3001";
const BASE_URL = process.env.QA_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Cleans up apps/web/e2e/pos-fixtures.ts's seeded store/terminal/item/
  // personas exactly once after the whole run, regardless of which spec
  // files matched -- see pos-global-teardown.ts. A no-op if no POS spec
  // ever ran (it checks for its own marker file first).
  globalTeardown: "./e2e/pos-global-teardown.ts",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  // 45s, not 30s: the POS specs (pos-*.spec.ts) run several multi-step
  // journeys per test against a Next.js DEV server, where the FIRST hit of
  // any not-yet-compiled API route/page can itself take 10-20s of on-demand
  // webpack/turbopack compilation before the request even starts executing
  // -- a real, structural cost of testing against `next dev` rather than a
  // production build, not flakiness in the tests themselves.
  timeout: 45_000,
  use: {
    baseURL: BASE_URL,
    // An action that cannot find its target fails after a minute with the line that was waiting, instead of waiting for the
    // whole test timeout (some specs allow fifteen minutes).
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // npx --yes pnpm@11.21.0 (not bare `pnpm`) for the same reason
    // root package.json's scripts all do this now: Corepack enforces the
    // repo's `packageManager` field (npm@11.5.1, changed for Hostinger's
    // own install step) against ANY bare `pnpm` invocation, which would
    // otherwise refuse to run this webServer command at all.
    command: `npx --yes pnpm@11.21.0 dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/owner.json" },
      dependencies: ["setup"],
    },
  ],
});
