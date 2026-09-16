import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = process.env.QA_BASE_URL || "http://localhost:3001";
const OUT_DIR = "scripts/qa/artifacts/screenshots";
const STORAGE_STATE = "scripts/qa/artifacts/storage-state.json";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

// Manifest: route + human label. Every major CRM page archetype named in
// the Prompt 3 brief, plus the app shell/home.
const ROUTES = [
  ["home", "/crm", "CRM Home"],
  ["lead-list", "/crm/leads", "Lead List"],
  ["lead-new", "/crm/leads/new", "Lead Form (create)"],
  ["account-list", "/crm/accounts", "Account List"],
  ["contact-list", "/crm/contacts", "Contact List"],
  ["opportunity-list", "/crm/opportunities", "Opportunity List"],
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

const inventory = [];

const browser = await chromium.launch();
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    storageState: STORAGE_STATE,
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`.slice(0, 200)));

  for (const [slug, route, label] of ROUTES) {
    const fileName = `${slug}__${viewport.name}.png`;
    const filePath = path.join(OUT_DIR, fileName);
    consoleErrors.length = 0;
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: filePath, fullPage: true });
      inventory.push({
        route,
        viewport: viewport.name,
        label,
        file: filePath,
        url: page.url(),
        consoleErrors: [...consoleErrors],
      });
      console.log(`OK   ${viewport.name.padEnd(8)} ${route}`);
    } catch (error) {
      inventory.push({
        route,
        viewport: viewport.name,
        label,
        file: filePath,
        url: page.url(),
        error: error.message,
        consoleErrors: [...consoleErrors],
      });
      console.log(`FAIL ${viewport.name.padEnd(8)} ${route} -- ${error.message}`);
    }
  }
  await context.close();
}
await browser.close();

fs.writeFileSync("scripts/qa/artifacts/screenshot-inventory.json", JSON.stringify(inventory, null, 2));
console.log(`\nWrote ${inventory.length} inventory entries.`);
