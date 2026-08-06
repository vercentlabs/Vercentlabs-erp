import { test } from "@playwright/test";

/**
 * Not an assertion suite — captures screenshots to test-results/ for direct human
 * (or agent) visual review, per docs/landing-redesign/phase-2/responsive-validation.md.
 * Run with: pnpm --filter @vercentlabs/landing exec playwright test visual-review
 */
test.describe("visual review captures", () => {
  test("homepage — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.screenshot({ path: "test-results/review-homepage-desktop.png", fullPage: true });
  });

  test("homepage — mobile 375", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.screenshot({ path: "test-results/review-homepage-mobile.png", fullPage: true });
  });

  test("homepage — mobile 320", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    await page.screenshot({ path: "test-results/review-homepage-320.png", fullPage: true });
  });

  test("desktop mega menu open", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Modules" }).click();
    await page.screenshot({ path: "test-results/review-mega-menu.png" });
  });

  test("mobile nav open", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "Revenue" }).click();
    await page.screenshot({ path: "test-results/review-mobile-nav.png" });
  });

  test("design-system — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.goto("/design-system");
    await page.screenshot({ path: "test-results/review-design-system.png", fullPage: true });
  });

  test("404 page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/this-route-does-not-exist");
    await page.screenshot({ path: "test-results/review-404.png" });
  });
});
