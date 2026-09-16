import { chromium } from "@playwright/test";

const BASE_URL = process.env.QA_BASE_URL || "http://localhost:3001";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console.error]", msg.text());
});
page.on("pageerror", (err) => console.log("[pageerror]", err.message));

await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
await page.screenshot({ path: "scripts/qa/artifacts/00-login-page.png" });

await page.getByLabel(/email/i).fill("e2e-owner@crm-e2e-fixture.test");
await page.getByLabel(/password/i).fill("CrmQaFixture!2026");
const [response] = await Promise.all([
  page.waitForResponse((res) => res.url().includes("/api/auth/login")),
  page.getByRole("button", { name: /sign in|log in/i }).click(),
]);
console.log("login response status:", response.status());
console.log("login response body:", await response.text().catch(() => "<unreadable>"));
await page.waitForTimeout(1500);
console.log("URL right after response:", page.url());
await page.goto(`${BASE_URL}/crm`, { waitUntil: "networkidle" });
console.log("URL after navigating to /crm:", page.url());
await page.screenshot({ path: "scripts/qa/artifacts/01-after-login.png", fullPage: true });
console.log("storageState will be saved to scripts/qa/artifacts/storage-state.json");
await context.storageState({ path: "scripts/qa/artifacts/storage-state.json" });

await browser.close();
