#!/usr/bin/env node
/**
 * capture-marketing-screenshots.mjs
 *
 * Logs into the synthetic "Vercent Demo Manufacturing" demo organization
 * (created by seed-marketing-demo-org.mjs) using the real Vercentlabs ERP
 * app (apps/web) and captures a small set of full-page/targeted screenshots
 * of genuine, populated product views for use on the public marketing site.
 *
 * This script only ever reads the app's UI — it does not create or modify
 * any data. It must NEVER be run against a production environment.
 *
 * Captures are saved as PNG only. next.config.mjs already configures
 * next/image to transcode to AVIF/WebP on request, so pre-generating a
 * WebP sibling here would just be unused dead weight shipped in every
 * deploy (see docs/landing-redesign/phase-3/screenshot-capture-process.md).
 *
 * After running, review each capture and register only the ones that are
 * genuinely marketing-ready in apps/landing/lib/product/screenshots.ts with
 * `approvedForMarketing: true` — do not assume every capture is approved by
 * default (see that file's own comment on why one capture was excluded).
 *
 * Usage:
 *   node apps/landing/scripts/capture-marketing-screenshots.mjs
 *
 * Requires apps/landing/scripts/.demo-org-credentials.local.md to exist
 * (written by seed-marketing-demo-org.mjs) unless DEMO_EMAIL/DEMO_PASSWORD
 * env vars are supplied instead.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3001";
const HEADLESS = process.env.DEMO_HEADLESS !== "false";
const OUTPUT_DIR = path.resolve(__dirname, "../public/product");
const CREDENTIALS_PATH = path.join(__dirname, ".demo-org-credentials.local.md");

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: NODE_ENV is 'production'. This script must never run against production.",
    );
  }
  const host = new URL(BASE_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `Refusing to run: target host '${host}' is not localhost. This script must only run against a local dev server.`,
    );
  }
}

async function loadCredentials() {
  if (process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD) {
    return { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD };
  }
  const text = await readFile(CREDENTIALS_PATH, "utf8").catch(() => {
    throw new Error(
      `Could not read ${CREDENTIALS_PATH}. Run seed-marketing-demo-org.mjs first, or set DEMO_EMAIL/DEMO_PASSWORD.`,
    );
  });
  const email = text.match(/Email:\s*(\S+)/)?.[1];
  const password = text.match(/Password:\s*(\S+)/)?.[1];
  if (!email || !password) {
    throw new Error(`Could not parse credentials out of ${CREDENTIALS_PATH}.`);
  }
  return { email, password };
}

function log(step, message) {
  console.log(`[capture] ${step} :: ${message}`);
}

const CAPTURES = [
  { id: "crm-pipeline-board", path: "/crm/pipeline", fullPage: false },
  { id: "crm-leads-list", path: "/crm/leads", fullPage: true },
  { id: "crm-opportunity-detail", path: null, fullPage: true }, // navigated to dynamically, see main()
  { id: "sales-quotation-detail", path: null, fullPage: true },
  { id: "sales-order-detail", path: null, fullPage: true },
  { id: "stock-overview", path: "/stock", fullPage: false },
];

async function main() {
  assertSafeEnvironment();
  await mkdir(OUTPUT_DIR, { recursive: true });
  const { email, password } = await loadCredentials();
  log("guard", `Target ${BASE_URL} looks safe. Using credentials for ${email}.`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  log("auth", "Logging in...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);
  log("auth", "Logged in.");

  const captured = [];
  for (const capture of CAPTURES) {
    if (!capture.path) {
      log("skip", `${capture.id} requires a record-specific URL — capture manually or extend this script with the real id.`);
      continue;
    }
    await page.goto(`${BASE_URL}${capture.path}`, { waitUntil: "networkidle" });
    const outputPath = path.join(OUTPUT_DIR, `${capture.id}.png`);
    await page.screenshot({ path: outputPath, fullPage: capture.fullPage });
    log("captured", outputPath);
    captured.push(capture.id);
  }

  log("done", `Captured ${captured.length}/${CAPTURES.length}. Review each file, then update lib/product/screenshots.ts.`);
  await browser.close();
}

main().catch((error) => {
  console.error("[capture] Failed:", error.message);
  process.exitCode = 1;
});
