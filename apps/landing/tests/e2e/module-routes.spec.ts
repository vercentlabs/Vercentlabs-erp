import { test, expect } from "@playwright/test";
import { LANDING_MODULES, PLATFORM_PAGES } from "@vercentlabs/landing-content";

test.describe("module routes", () => {
  for (const moduleInfo of LANDING_MODULES) {
    test(`/modules/${moduleInfo.key} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      const response = await page.goto(`/modules/${moduleInfo.key}`);
      expect(response?.status()).toBe(200);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      await expect(h1).toContainText(moduleInfo.name);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("an unknown module slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/modules/not-a-real-module");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("We couldn't find that page.")).toBeVisible();
  });

  test("/modules index returns 200 and links to all 12 module pages", async ({ page }) => {
    const response = await page.goto("/modules");
    expect(response?.status()).toBe(200);
    for (const moduleInfo of LANDING_MODULES) {
      await expect(page.locator(`a[href="/modules/${moduleInfo.key}"]`).first()).toBeAttached();
    }
  });

  test("book-demo preselects the module passed via query param, and the user can change it", async ({ page }) => {
    await page.goto("/book-demo?module=manufacturing");
    const checkbox = page.getByRole("checkbox", { name: "Manufacturing" });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });

  test("book-demo ignores an invalid module query param instead of crashing", async ({ page }) => {
    const response = await page.goto("/book-demo?module=not-a-real-module");
    expect(response?.status()).toBe(200);
    const checked = await page.locator('input[type="checkbox"]:checked').count();
    expect(checked).toBe(0);
  });
});

test.describe("platform routes", () => {
  test("/product returns 200 with one real H1", async ({ page }) => {
    const response = await page.goto("/product");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  for (const platformPage of PLATFORM_PAGES) {
    test(`${platformPage.slug} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      const response = await page.goto(platformPage.slug);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("/product/security redirects permanently to the canonical /security", async ({ page }) => {
    const response = await page.goto("/product/security");
    expect(response?.status()).toBe(200); // Playwright follows the redirect; assert the final URL instead.
    expect(new URL(page.url()).pathname).toBe("/security");
  });
});
