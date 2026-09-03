import { test, expect } from "@playwright/test";

// Release stability: this file performs repeated full-page navigations and/or
// browser-level interactions. Keep its tests sequential inside each project;
// projects may still run concurrently up to playwright.config.ts's worker cap.
test.describe.configure({ mode: "default" });


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

const ATTRIBUTION_STORAGE_KEY = "vercentlabs_attribution_v1";

async function readCrossBrowserAttribution(page: import("@playwright/test").Page) {
  // AttributionInit writes first-touch data from a client-side useEffect.
  // Synchronize on that real product effect, but keep the wait bounded so one
  // resource-starved browser worker cannot consume the entire global timeout.
  await page.waitForFunction(
    (key) => window.localStorage.getItem(key) !== null,
    ATTRIBUTION_STORAGE_KEY,
    { timeout: 10_000 },
  );

  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, ATTRIBUTION_STORAGE_KEY);
}

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
  // The repository enables fullyParallel globally. These five browser-level
  // interactions are intentionally sequential within each browser project
  // to avoid starving Firefox/WebKit contexts during the release-wide run.
  // Rendering-route smoke tests remain fully parallel.
  test.describe.configure({ mode: "default" });
  test("demo form fields accept input and required-field validation fires", async ({ page }) => {
    await page.goto("/book-demo");
    await page.getByLabel("First name").fill("Test");
    await page.getByLabel("Work email").fill("not-an-email");
    await page.getByRole("button", { name: "Book a Demo" }).click();
    await expect(page.getByText(/attention below/i)).toBeVisible();
  });

  test("attribution localStorage write/read works", async ({ page }) => {
    await page.goto(
      "/?utm_source=crossbrowser&utm_medium=test&utm_campaign=smoke",
      { waitUntil: "domcontentloaded" },
    );

    const record = await readCrossBrowserAttribution(page);

    expect(record).not.toBeNull();
    expect(record.utmSource).toBe("crossbrowser");
    expect(record.utmMedium).toBe("test");
    expect(record.utmCampaign).toBe("smoke");
    expect(record.landingPath).toBe("/");
  });

  test("comparison table/cards render on /compare/vercentlabs-vs-odoo", async ({ page }) => {
    await page.goto("/compare/vercentlabs-vs-odoo");
    const hasTable = await page.locator("table").count();
    const hasContent = await page.getByText(/vercentlabs/i).first().isVisible();
    expect(hasTable + Number(hasContent)).toBeGreaterThan(0);
  });

  test("footer legal links resolve", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    const privacyLink = footer.getByRole("link", { name: "Privacy Policy", exact: true });
    await expect(privacyLink).toHaveAttribute("href", "/privacy");
    const termsLink = footer.getByRole("link", { name: "Terms of Use", exact: true });
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
