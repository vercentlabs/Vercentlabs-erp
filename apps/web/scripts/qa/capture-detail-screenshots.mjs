import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE_URL = "http://localhost:3001";
const OUT_DIR = "scripts/qa/artifacts/screenshots";
const STORAGE_STATE = "scripts/qa/artifacts/storage-state.json";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const leadId = "53199386-ae16-41bc-ba4b-4772bf711b9f";
const accountId = "43363836-1fb7-4c8f-9040-b452e4581a7c";
const contactId = "5b1e6fb2-6fc1-46d6-8741-e480470d18dc";
const opportunityId = "c44679df-9c32-448e-a65d-0602bed5e845";

const ROUTES = [
  ["lead-360", `/crm/leads/${leadId}`, "Lead 360"],
  ["account-360", `/crm/accounts/${accountId}`, "Account 360"],
  ["contact-360", `/crm/contacts/${contactId}`, "Contact 360"],
  ["opportunity-360", `/crm/opportunities/${opportunityId}`, "Opportunity 360"],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const inventory = JSON.parse(fs.readFileSync("scripts/qa/artifacts/screenshot-inventory.json", "utf8"));

const browser = await chromium.launch();
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ storageState: STORAGE_STATE, viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200)); });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`.slice(0, 200)));

  for (const [slug, route, label] of ROUTES) {
    const filePath = path.join(OUT_DIR, `${slug}__${viewport.name}.png`);
    consoleErrors.length = 0;
    try {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: filePath, fullPage: true });
      inventory.push({ route, viewport: viewport.name, label, file: filePath, url: page.url(), consoleErrors: [...consoleErrors] });
      console.log(`OK   ${viewport.name.padEnd(8)} ${route}`);
    } catch (error) {
      inventory.push({ route, viewport: viewport.name, label, file: filePath, url: page.url(), error: error.message, consoleErrors: [...consoleErrors] });
      console.log(`FAIL ${viewport.name.padEnd(8)} ${route} -- ${error.message}`);
    }
  }
  await context.close();
}
await browser.close();

fs.writeFileSync("scripts/qa/artifacts/screenshot-inventory.json", JSON.stringify(inventory, null, 2));
console.log(`\nTotal inventory entries: ${inventory.length}`);
