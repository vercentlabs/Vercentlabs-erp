import { test, expect } from "@playwright/test";

// The whole page must never scroll sideways at phone, tablet and laptop widths. A wide table may scroll inside its own
// labelled region, which is not counted here because the document itself stays the width of the screen.
const WIDTHS = [
  { name: "phone 360", width: 360, height: 740 },
  { name: "tablet 768", width: 768, height: 1024 },
  { name: "laptop 1024", width: 1024, height: 768 },
] as const;

const PAGES = [
  ["/", "Home"],
  ["/work", "My work"],
  ["/search?q=ab", "Search"],
  ["/crm", "CRM home"],
  ["/crm/leads", "Leads"],
  ["/crm/accounts", "Accounts"],
  ["/crm/opportunities", "Opportunities"],
  ["/crm/pipeline", "Pipeline"],
  ["/crm/forecast", "Forecast"],
  ["/crm/tasks", "Tasks"],
  ["/crm/reports", "Reports"],
  ["/crm/settings/lead-lifecycle", "Lead lifecycle settings"],
  ["/crm/settings/custom-fields-and-tags", "Custom fields and tags settings"],
] as const;

for (const size of WIDTHS) {
  for (const [route, label] of PAGES) {
    test(`${label} fits a ${size.name} screen`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 150_000 });
      await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(1_500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `the page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(1);
    });
  }
}
