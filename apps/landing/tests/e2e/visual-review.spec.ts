import { test } from "@playwright/test";
import { LANDING_MODULES, PLATFORM_PAGES } from "@vercentlabs/landing-content";

/**
 * Not an assertion suite — captures screenshots to test-results/ for direct human
 * (or agent) visual review. Viewport set matches docs/landing-redesign/phase-3/
 * responsive-validation.md's required list. Run with:
 * pnpm --filter @vercentlabs/landing exec playwright test visual-review
 */
const VIEWPORTS = {
  w320: { width: 320, height: 568 },
  w360: { width: 360, height: 800 },
  w390: { width: 390, height: 844 },
  w768: { width: 768, height: 1024 },
  w1024: { width: 1024, height: 768 },
  w1280: { width: 1280, height: 800 },
  w1440: { width: 1440, height: 900 },
  w1920: { width: 1920, height: 1080 },
};

test.describe("visual review captures — homepage across required viewports", () => {
  for (const [name, size] of Object.entries(VIEWPORTS)) {
    test(`homepage — ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      await page.screenshot({ path: `test-results/review-homepage-${name}.png`, fullPage: true });
    });
  }
});

test.describe("visual review captures — other pages and states", () => {
  test("hero only — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.screenshot({ path: "test-results/review-hero.png" });
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

  test("book-demo — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/book-demo");
    await page.screenshot({ path: "test-results/review-book-demo-desktop.png", fullPage: true });
  });

  test("book-demo — mobile 375", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/book-demo");
    await page.screenshot({ path: "test-results/review-book-demo-mobile.png", fullPage: true });
  });

  test("book-demo — mobile 320", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/book-demo");
    await page.screenshot({ path: "test-results/review-book-demo-320.png", fullPage: true });
  });

  test("book-demo validation errors", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/book-demo");
    await page.getByRole("button", { name: "Book a Product Demo" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "test-results/review-book-demo-errors.png", fullPage: true });
  });

  test("thank-you page — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/book-demo/thank-you?rid=test-review");
    await page.screenshot({ path: "test-results/review-thank-you.png" });
  });

  test("thank-you page — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/book-demo/thank-you?rid=test-review");
    await page.screenshot({ path: "test-results/review-thank-you-mobile.png" });
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

// Phase 4 — every new module/platform route, desktop + mobile, per the Cycle 2
// "full route review" requirement. `fullPage` screenshots need a settle wait
// after `networkidle` since lazy-loaded below-the-fold product screenshots can
// still be decoding when the scroll-and-stitch capture reaches them (a false
// alarm investigated and confirmed in this phase's Cycle 1 review — the real
// fix is patience here, not a code change).
test.describe("visual review captures — Phase 4 module and platform routes", () => {
  const routes = [
    { path: "/modules", name: "modules-index" },
    ...LANDING_MODULES.map((moduleInfo) => ({ path: `/modules/${moduleInfo.key}`, name: `module-${moduleInfo.key}` })),
    { path: "/product", name: "product-overview" },
    ...PLATFORM_PAGES.map((page) => ({ path: page.slug, name: `platform-${page.slug.replace(/\//g, "-")}` })),
  ];

  for (const route of routes) {
    test(`${route.path} — desktop`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/review-${route.name}-desktop.png`, fullPage: true });
    });

    test(`${route.path} — mobile 390`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route.path, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/review-${route.name}-mobile.png`, fullPage: true });
    });
  }
});
