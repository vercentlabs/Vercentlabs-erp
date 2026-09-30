import { test, expect } from "@playwright/test";

// Bank reconciliation is a focused view of the bank statements the module keeps. It must load without error
// and state what it shows.

for (const [route, heading] of [
  ["/accounting/reconciliation", "Bank reconciliation"],
] as const) {
  test(`${route} loads as a real page`, async ({ page }) => {
    test.setTimeout(180_000);
    const response = await page.goto(route, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    expect(response?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByText(/could not|something went wrong|not found/i),
    ).toHaveCount(0);
  });
}
