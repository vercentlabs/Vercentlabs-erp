import { test } from "@playwright/test";
import fs from "node:fs";

const PAGES = (process.env.AUDIT_PAGES || "/crm/settings/territories,/crm/calls/new,/crm/follow-ups/new,/crm/meetings/new,/crm/tasks/new,/crm/dashboard,/crm").split(",");

test("capture pages", async ({ page }) => {
  test.setTimeout(590_000);
  fs.mkdirSync("test-results/audit", { recursive: true });
  const out: string[] = [];
  for (const p of PAGES) {
    await page.goto(p, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 40_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const name = p.replace(/[^a-z0-9]+/gi, "_");
    await page.screenshot({ path: `test-results/audit/${name}.png`, fullPage: true });
    out.push(`${p} :: ${(await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400)}`);
    fs.writeFileSync("test-results/audit/summary2.txt", out.join("\n"));
  }
});
