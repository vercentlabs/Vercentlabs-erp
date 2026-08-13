import { test, expect } from "@playwright/test";

/**
 * Real, narrow-viewport conversion-path checks — distinct from
 * visual-review.spec.ts (which only captures screenshots for human review).
 * Every assertion here is MEASURED against the real DOM, not inferred from
 * a screenshot. Widths match the Phase 7 brief's minimum set.
 */
const MOBILE_WIDTHS = [320, 360, 375, 390, 412];

test.describe("no horizontal overflow across the real conversion path", () => {
  const routes = ["/", "/book-demo", "/resources/erp-requirements-checklist", "/compare/vercentlabs-vs-odoo"];

  for (const width of MOBILE_WIDTHS) {
    for (const route of routes) {
      test(`${route} has zero horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(route, { waitUntil: "networkidle" });
        const [scrollWidth, clientWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        expect(scrollWidth, `${route} at ${width}px: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth + 1);
      });
    }
  }
});

test.describe("sticky mobile CTA behavior", () => {
  test("sticky CTA is visible and reaches the minimum WCAG 2.2 AA target size (24x24) below the sm breakpoint", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const stickyCta = page.locator("[data-sticky-mobile-cta] a");
    await expect(stickyCta).toBeVisible();
    const box = await stickyCta.boundingBox();
    expect(box, "sticky CTA has no bounding box").toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });

  test("sticky CTA is hidden at desktop width (sm breakpoint and above)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // The element still mounts (sm:hidden is a CSS class, not conditional
    // rendering), so assert it's not *visible*, not that it's absent.
    await expect(page.locator("[data-sticky-mobile-cta]")).toBeHidden();
  });

  test("sticky CTA does not render on /book-demo (the form's own submit button is the CTA there)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/book-demo");
    await expect(page.locator("[data-sticky-mobile-cta]")).toHaveCount(0);
  });

  test("header CTA and sticky CTA never both render at the same width (the Phase 6 duplication bug this guards against)", async ({ page }) => {
    for (const width of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const headerCtaVisible = await page.locator("header a", { hasText: "Book a Demo" }).first().isVisible().catch(() => false);
      const stickyCtaVisible = await page.locator("[data-sticky-mobile-cta]").first().isVisible().catch(() => false);
      expect(headerCtaVisible && stickyCtaVisible, `both header and sticky CTA visible simultaneously at ${width}px`).toBe(false);
    }
  });
});

test.describe("demo form mobile usability", () => {
  test("email and phone fields use the correct input type for mobile keyboards", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/book-demo");
    await expect(page.getByLabel("Work email")).toHaveAttribute("type", "email");
    await expect(page.getByLabel("Phone number")).toHaveAttribute("type", "tel");
  });

  test("submit button reaches the minimum WCAG 2.2 AA target size at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/book-demo");
    const submit = page.getByRole("button", { name: "Book a Demo" });
    const box = await submit.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });

  test("zoom is not disabled (viewport meta must not block user scaling)", async ({ page }) => {
    await page.goto("/book-demo");
    const viewportContent = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewportContent ?? "").not.toMatch(/user-scalable=no|maximum-scale=1(\.0)?(?!\d)/);
  });
});

test.describe("mobile navigation reachability", () => {
  test("mobile nav opens, and the footer is reachable by scroll at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("button", { name: "Revenue" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator("footer")).toBeVisible();
  });
});
