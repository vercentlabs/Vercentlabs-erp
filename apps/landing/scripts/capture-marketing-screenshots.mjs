#!/usr/bin/env node
/**
 * capture-marketing-screenshots.mjs
 *
 * Captures the marketing screenshots listed in marketing-capture-plan.mjs
 * from the real Vercentlabs ERP (apps/web), signed in to the synthetic
 * "Northstar Demo" organisation created by scripts/qa/seed-marketing-demo-org.mjs.
 * It only reads the UI — it never creates or changes data.
 *
 * Requirements:
 *  - A PRODUCTION build of the ERP (no Next.js development indicator), served
 *    on loopback with the ERP's local profile — a plain `next start` refuses
 *    to boot without production infrastructure:
 *      pnpm --filter @vercentlabs/web build
 *      RUNTIME_PROFILE=local-production-build pnpm --filter @vercentlabs/web exec next start -p 3001 -H 127.0.0.1
 *  - apps/landing/scripts/.demo-org-credentials.local.md (written by the seed
 *    script) or DEMO_EMAIL / DEMO_PASSWORD.
 *  - http://localhost:3001 (the app's configured origin; sign-in is
 *    origin-checked, so 127.0.0.1 does not work).
 *
 * Each plan entry must load its exact route and show its `ready` text, or the
 * run fails — there is no silent fallback to another screen. Images are
 * written to apps/landing/public/product/<id>.png at a fixed viewport, under
 * ids that never reuse a retired screenshot's file. Capturing does NOT
 * approve an image: inspect every file, then approve it in
 * apps/landing/lib/product/screenshots.ts with its capturedAt date.
 *
 * Usage:
 *   node apps/landing/scripts/capture-marketing-screenshots.mjs [id ...]
 *
 * Env overrides:
 *   DEMO_BASE_URL   - defaults to http://localhost:3001
 *   DEMO_HEADLESS   - "false" to watch the browser run
 *   DEMO_EMAIL / DEMO_PASSWORD - override the credentials file
 */

import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_VIEWPORT, MARKETING_CAPTURE_PLAN } from "./marketing-capture-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3001";
const HEADLESS = process.env.DEMO_HEADLESS !== "false";
const OUTPUT_DIR = path.resolve(__dirname, "../public/product");
const CREDENTIALS_PATH = path.join(__dirname, ".demo-org-credentials.local.md");

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run: NODE_ENV is 'production'. This script must never run against production.");
  }
  const host = new URL(BASE_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to run: target host '${host}' is not localhost. This script must only run against a local ERP.`);
  }
}

async function loadCredentials() {
  if (process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD) {
    return { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD };
  }
  const text = await readFile(CREDENTIALS_PATH, "utf8").catch(() => {
    throw new Error(`Could not read ${CREDENTIALS_PATH}. Run scripts/qa/seed-marketing-demo-org.mjs first, or set DEMO_EMAIL/DEMO_PASSWORD.`);
  });
  const email = text.match(/Email:\s*(\S+)/)?.[1];
  const password = text.match(/Password:\s*(\S+)/)?.[1];
  if (!email || !password) throw new Error(`Could not parse credentials out of ${CREDENTIALS_PATH}.`);
  if (!email.endsWith("@example.com")) throw new Error(`Refusing to capture as ${email}: marketing captures use the synthetic demo owner only.`);
  return { email, password };
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.getByText(/^Loading/).first().waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
}

async function main() {
  assertSafeEnvironment();
  const requested = new Set(process.argv.slice(2));
  const plan = requested.size ? MARKETING_CAPTURE_PLAN.filter((entry) => requested.has(entry.id)) : MARKETING_CAPTURE_PLAN;
  if (requested.size && plan.length !== requested.size) {
    throw new Error(`Unknown capture id(s): ${[...requested].filter((id) => !plan.some((entry) => entry.id === id)).join(", ")}`);
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  const { email, password } = await loadCredentials();

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: CAPTURE_VIEWPORT, deviceScaleFactor: 1 });
  const failures = [];
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.getByLabel(/email/i).first().fill(email);
    await page.getByLabel(/password/i).first().fill(password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
      page.getByRole("button", { name: /^sign in$/i }).click(),
    ]);
    console.log(`[capture] signed in to ${BASE_URL}`);

    for (const entry of plan) {
      try {
        const response = await page.goto(`${BASE_URL}${entry.route}`);
        if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status() ?? "no response"}`);
        const expectedPath = new URL(entry.route, BASE_URL).pathname;
        if (new URL(page.url()).pathname !== expectedPath) throw new Error(`redirected to ${new URL(page.url()).pathname}`);
        await settle(page);
        await page.getByText(entry.ready, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
        await page.screenshot({ path: path.join(OUTPUT_DIR, `${entry.id}.png`), fullPage: false, ...(entry.clip ? { clip: entry.clip } : {}) });
        console.log(`[capture] ${entry.id} <- ${entry.route}`);
      } catch (error) {
        failures.push(entry.id);
        console.error(`[capture] FAILED ${entry.id} (${entry.route}): ${error.message.split("\n")[0]}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`[capture] ${plan.length - failures.length}/${plan.length} captured. Inspect each file before approving it in lib/product/screenshots.ts.`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[capture] Failed:", error.message);
  process.exitCode = 1;
});
