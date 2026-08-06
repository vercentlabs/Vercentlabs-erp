#!/usr/bin/env node
/**
 * One-time setup: creates and publishes a real CRM lead-capture form on the
 * synthetic "Vercent Demo Manufacturing" org (seeded by
 * seed-marketing-demo-org.mjs), via the real apps/web UI/API — never direct
 * SQL. Prints only the resulting public_key (never credentials or secrets).
 *
 * Requires apps/landing/scripts/.demo-org-credentials.local.md to exist.
 * Must never be run against a non-localhost target.
 *
 * Usage: node apps/landing/scripts/create-capture-form.mjs
 */

import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3001";
const CREDENTIALS_PATH = path.join(__dirname, ".demo-org-credentials.local.md");

function assertSafeEnvironment() {
  const host = new URL(BASE_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing to run: target host '${host}' is not localhost.`);
  }
}

async function loadCredentials() {
  const text = await readFile(CREDENTIALS_PATH, "utf8");
  const email = text.match(/Email:\s*(\S+)/)?.[1];
  const password = text.match(/Password:\s*(\S+)/)?.[1];
  if (!email || !password) throw new Error(`Could not parse credentials from ${CREDENTIALS_PATH}.`);
  return { email, password };
}

async function main() {
  assertSafeEnvironment();
  const { email, password } = await loadCredentials();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("[form] Logging in...");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 }), page.click('button[type="submit"]')]);
  console.log("[form] Logged in.");

  const definition = {
    name: "Vercentlabs Landing — Book a Demo",
    successMessage: "Thank you. Our team will contact you shortly.",
    thankYouUrl: "/book-demo/thank-you",
    consentText: "I agree to be contacted by Vercentlabs about this demo request.",
    duplicateStrategy: "warn",
    captchaMode: "honeypot",
    fields: [
      { name: "firstName", label: "First name", type: "text", required: true },
      { name: "lastName", label: "Last name", type: "text", required: false },
      { name: "email", label: "Work email", type: "email", required: true },
      { name: "phone", label: "Phone number", type: "phone", required: true },
      { name: "companyName", label: "Company name", type: "text", required: true },
      { name: "jobTitle", label: "Job title", type: "text", required: false },
      { name: "industry", label: "Industry", type: "text", required: false },
      { name: "productInterest", label: "Primary interest", type: "text", required: false },
      { name: "consentEmail", label: "Email consent", type: "checkbox", required: false },
    ],
  };

  const saveResult = await page.evaluate(async (def) => {
    const response = await fetch("/api/crm/lead-acquisition/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(def),
    });
    const body = await response.json();
    return { status: response.status, body };
  }, definition);

  if (saveResult.status !== 201) {
    throw new Error(`Failed to create capture form: ${saveResult.status} ${JSON.stringify(saveResult.body)}`);
  }
  const form = saveResult.body.result;
  console.log(`[form] Created form id=${form.id}`);

  const publishResult = await page.evaluate(async (formId) => {
    const response = await fetch("/api/crm/lead-acquisition/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish", formId }),
    });
    const body = await response.json();
    return { status: response.status, body };
  }, form.id);

  if (publishResult.status !== 200) {
    throw new Error(`Failed to publish capture form: ${publishResult.status} ${JSON.stringify(publishResult.body)}`);
  }
  const published = publishResult.body.result;
  console.log(`[form] Published. status=${published.status}`);
  console.log(`CRM_CAPTURE_FORM_KEY=${published.public_key}`);

  await browser.close();
}

main().catch((error) => {
  console.error("[form] Failed:", error.message);
  process.exitCode = 1;
});
