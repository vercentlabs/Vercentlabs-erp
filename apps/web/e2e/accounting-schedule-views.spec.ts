import { test, expect } from "@playwright/test";

// Prepayments, revenue schedules and bank reconciliation are focused views of data the module already keeps
// (deferral schedules and bank statements). They must load without error and state what they show.

for (const [route, heading] of [
  ["/accounting/prepayments", "Prepayments"],
  ["/accounting/revenue-schedules", "Revenue schedules"],
  ["/accounting/reconciliation", "Bank reconciliation"],
] as const) {
  test(`${route} loads as a real page`, async ({ page }) => {
    test.setTimeout(180_000);
    const response = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/could not|something went wrong|not found/i)).toHaveCount(0);
  });
}
