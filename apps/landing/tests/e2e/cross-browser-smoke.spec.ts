import { test, expect } from "@playwright/test";

/**
 * Phase 8 cross-browser coverage. Runs on desktop-firefox, desktop-webkit,
 * and mobile-webkit (see playwright.config.ts's per-project testMatch) in
 * addition to the existing desktop-chromium/mobile-chromium projects that
 * already run the full suite. Playwright's WebKit engine is the closest
 * available proxy for Safari's rendering engine in this environment — it is
 * NOT Safari itself, and no result here should be read as "tested in Safari."
 * No real Apple hardware is available in this sandbox.
 */

const ROUTES = [
  "/",
  "/book-demo",
  "/product",
  "/modules/manufacturing",
  "/industries/manufacturing",
  "/workflows/lead-to-cash",
  "/resources",
  "/resources/erp-requirements-checklist",
  "/compare/vercentlabs-vs-odoo",
  "/privacy",
  "/terms",
];

test.describe("cross-browser rendering and console-error sweep", () => {
  for (const route of ROUTES) {
    test(`${route} renders with no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(String(err)));
      const response = await page.goto(route, { waitUntil: "load" });
      expect(response?.status()).toBe(200);
      await expect(page.locator("body")).toBeVisible();
      expect(consoleErrors, `console errors on ${route}: ${JSON.stringify(consoleErrors)}`).toEqual([]);
    });
  }
});

test.describe("cross-browser interaction checks", () => {
  test("demo form fields accept input and required-field validation fires", async ({ page }) => {
    await page.goto("/book-demo");
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Book a Product Demo" }).click();
    await expect(page.getByText(/attention below/i)).toBeVisible();
  });

  test("attribution localStorage write/read works", async ({ page }) => {
    await page.goto("/?utm_source=crossbrowser&utm_medium=test&utm_campaign=smoke");
    await page.waitForFunction(() => window.localStorage.getItem("vercentlabs_attribution_v1") !== null);
    const record = await page.evaluate(() => JSON.parse(window.localStorage.getItem("vercentlabs_attribution_v1") ?? "null"));
    expect(record?.utmSource).toBe("crossbrowser");
  });

  test("comparison table/cards render on /compare/vercentlabs-vs-odoo", async ({ page }) => {
    await page.goto("/compare/vercentlabs-vs-odoo");
    const hasTable = await page.locator("table").count();
    const hasContent = await page.getByText(/vercentlabs/i).first().isVisible();
    expect(hasTable + Number(hasContent)).toBeGreaterThan(0);
  });

  test("footer legal links resolve", async ({ page }) => {
    await page.goto("/");
    const privacyLink = page.getByRole("link", { name: "Privacy Policy" });
    await expect(privacyLink).toHaveAttribute("href", "/privacy");
    const termsLink = page.getByRole("link", { name: "Terms of Use" });
    await expect(termsLink).toHaveAttribute("href", "/terms");
  });

  test("skip link moves keyboard focus", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId).toBe("main-content");
  });
});
