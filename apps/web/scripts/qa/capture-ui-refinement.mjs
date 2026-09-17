import { chromium } from "@playwright/test";
import fs from "node:fs";

const label = process.argv[2] || "before";
const OUT_DIR = "scripts/qa/artifacts/ui-refinement";
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();

const viewports = [
  ["desktop", 1440, 900],
  ["tablet", 1024, 900],
  ["mobile", 390, 844],
];

for (const [name, width, height] of viewports) {
  const context = await browser.newContext({ storageState: "e2e/.auth/owner.json", viewport: { width, height } });
  const page = await context.newPage();
  await page.goto("http://localhost:3001/crm/leads", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT_DIR}/${label}-leads-${name}.png` });
  console.log(`captured ${label}-leads-${name}`);
  await context.close();
}

// Also grab CRM Home for shell/sidebar context at desktop.
const homeContext = await browser.newContext({ storageState: "e2e/.auth/owner.json", viewport: { width: 1440, height: 900 } });
const homePage = await homeContext.newPage();
await homePage.goto("http://localhost:3001/crm", { waitUntil: "networkidle" });
await homePage.waitForTimeout(600);
await homePage.screenshot({ path: `${OUT_DIR}/${label}-crm-home-desktop.png` });
console.log(`captured ${label}-crm-home-desktop`);
await homeContext.close();

await browser.close();
