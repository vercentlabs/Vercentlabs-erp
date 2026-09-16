import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = "http://localhost:3001";
const OUT_DIR = "scripts/qa/artifacts/screenshots";
const VIEWPORT = { width: 1440, height: 900 };

const leadId = "53199386-ae16-41bc-ba4b-4772bf711b9f";
const accountId = "43363836-1fb7-4c8f-9040-b452e4581a7c";
const contactId = "5b1e6fb2-6fc1-46d6-8741-e480470d18dc";
const opportunityId = "c44679df-9c32-448e-a65d-0602bed5e845";

const ROUTES = [
  ["home", "/crm", "CRM Home"],
  ["lead-list", "/crm/leads", "Lead List"],
  ["lead-new", "/crm/leads/new", "Lead Form (create)"],
  ["lead-360", `/crm/leads/${leadId}`, "Lead 360"],
  ["account-list", "/crm/accounts", "Account List"],
  ["account-360", `/crm/accounts/${accountId}`, "Account 360"],
  ["contact-list", "/crm/contacts", "Contact List"],
  ["contact-360", `/crm/contacts/${contactId}`, "Contact 360"],
  ["opportunity-list", "/crm/opportunities", "Opportunity List"],
  ["opportunity-360", `/crm/opportunities/${opportunityId}`, "Opportunity 360"],
  ["pipeline", "/crm/pipeline", "Pipeline"],
  ["calls", "/crm/calls", "Calls"],
  ["meetings", "/crm/meetings", "Meetings"],
  ["tasks", "/crm/tasks", "Tasks"],
  ["follow-ups", "/crm/follow-ups", "Follow-ups"],
  ["communications", "/crm/communications", "Communications"],
  ["duplicates", "/crm/data/duplicates", "Duplicate Management"],
  ["import-export", "/crm/data/import-export", "Import/Export"],
  ["custom-fields", "/crm/settings/custom-fields-and-tags", "Custom Fields & Tags"],
  ["territories", "/crm/settings/territories", "Territories & Sales Teams"],
  ["dashboard", "/crm/dashboard", "Dashboard"],
  ["forecast", "/crm/forecast", "Forecast"],
  ["reports", "/crm/reports", "Reports"],
  ["lead-sources", "/crm/settings/lead-sources", "CRM Settings — Lead Sources"],
  ["pipeline-stages", "/crm/settings/pipeline-stages", "CRM Settings — Pipeline Stages"],
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();

await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
await page.getByLabel(/email/i).fill("e2e-owner@crm-e2e-fixture.test");
await page.getByLabel(/password/i).fill("CrmQaFixture!2026");
await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/auth/login")),
  page.getByRole("button", { name: /sign in|log in/i }).click(),
]);
await page.waitForTimeout(1000);

const inventory = [];
for (const [slug, route, label] of ROUTES) {
  const filePath = path.join(OUT_DIR, `${slug}__desktop.png`);
  const consoleErrors = [];
  const handler = (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200)); };
  page.on("console", handler);
  try {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: filePath, fullPage: true });
    inventory.push({ route, label, file: filePath, url: page.url(), consoleErrors: [...consoleErrors] });
    console.log(`OK   ${route}`);
  } catch (error) {
    inventory.push({ route, label, file: filePath, url: page.url(), error: error.message, consoleErrors: [...consoleErrors] });
    console.log(`FAIL ${route} -- ${error.message}`);
  }
  page.off("console", handler);
}

await browser.close();
fs.writeFileSync("scripts/qa/artifacts/desktop-inventory.json", JSON.stringify(inventory, null, 2));
console.log(`\nWrote ${inventory.length} desktop screenshots.`);
