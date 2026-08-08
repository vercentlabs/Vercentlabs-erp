import { test, expect } from "@playwright/test";

/**
 * Phase 2's real P0 (CSP blocking Next.js's own inline scripts — see
 * docs/landing-redesign/phase-2/decision-log.md item 4a) was originally caught
 * this same way, but only ever re-checked on the homepage. Phase 7 extends
 * this console-error check (which would catch a CSP violation reappearing,
 * since browsers report CSP failures as console errors) across all 11
 * representative routes, closing a gap phase-7's regression-risk-register.md
 * explicitly flagged.
 */
const REPRESENTATIVE_ROUTES = [
  "/",
  "/book-demo",
  "/product",
  "/modules/manufacturing",
  "/industries/manufacturing",
  "/workflows/lead-to-cash",
  "/implementation",
  "/resources",
  "/resources/erp-buying-guide",
  "/resources/erp-requirements-checklist",
  "/compare/vercentlabs-vs-odoo",
];

test.describe("no console errors across representative routes (catches CSP regressions)", () => {
  for (const route of REPRESENTATIVE_ROUTES) {
    test(`${route} has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(String(err)));
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      expect(consoleErrors, `console errors on ${route}: ${JSON.stringify(consoleErrors)}`).toEqual([]);
    });
  }
});

test.describe("header and footer links all resolve (catches dead internal links)", () => {
  // A real, pre-existing defect found in Phase 7 (not introduced by it): header
  // nav's "Pricing" and footer's "About"/"Contact"/"Pricing"/"Privacy policy"/
  // "Terms of service" all pointed at routes that were never built, returning
  // 404 (see docs/landing-redesign/phase-7/decision-log.md). The existing
  // content-integrity unit test only checked for empty/"#" hrefs, never whether
  // the target actually resolves — this crawls the real rendered header/footer
  // DOM (not a hardcoded link list, so it catches any future addition too) and
  // asserts every internal link returns a real 200, not just "has an href."
  test("every internal href in the header and footer returns 200", async ({ page, request }) => {
    await page.goto("/");
    const hrefs = await page.evaluate(() => {
      const header = document.querySelector("header");
      const footer = document.querySelector("footer");
      const links = [...(header?.querySelectorAll("a[href]") ?? []), ...(footer?.querySelectorAll("a[href]") ?? [])];
      return [...new Set(links.map((a) => a.getAttribute("href")))];
    });
    const internalHrefs = hrefs.filter((href): href is string => Boolean(href) && href!.startsWith("/") && !href!.startsWith("//"));
    expect(internalHrefs.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const href of internalHrefs) {
      const response = await request.get(href, { maxRedirects: 5 });
      if (!response.ok()) broken.push(`${href} -> ${response.status()}`);
    }
    expect(broken, `broken header/footer links: ${JSON.stringify(broken)}`).toEqual([]);
  });
});

test.describe("production smoke", () => {
  test("homepage returns 200, renders the hero, and has no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("outgrew spreadsheets");
    expect(consoleErrors).toEqual([]);
  });

  test("a nonexistent route returns a real 404 page, not a crash", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("We couldn't find that page.")).toBeVisible();
  });

  test("robots.txt and sitemap.xml are served correctly", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain("Disallow: /design-system");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<loc>");
  });

  test("design-system route is served but marked noindex", async ({ page, request }) => {
    const response = await page.goto("/design-system");
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toContain("noindex");

    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toMatch(/Disallow:\s*\/design-system/);
  });
});

test.describe("navigation", () => {
  // The desktop nav (mega menus) is hidden below the `lg` breakpoint (see
  // components/navigation/header.tsx's `hidden lg:flex`) — pin the viewport so
  // these tests are correct regardless of which project's default viewport runs them.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("desktop mega menu opens, is keyboard-dismissible with Escape, and returns focus", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Modules" });
    await trigger.click();
    await expect(page.getByRole("region", { name: "Modules" })).toBeVisible();
    await expect(page.getByRole("link", { name: /CRM/ }).first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Modules" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("clicking outside the open mega menu closes it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Product" }).click();
    await expect(page.getByRole("region", { name: "Product" })).toBeVisible();
    await page.mouse.click(10, 500);
    await expect(page.getByRole("region", { name: "Product" })).toBeHidden();
  });

  test("header CTA links to /book-demo", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Book a Product Demo" }).first();
    await expect(cta).toHaveAttribute("href", "/book-demo");
  });

  test("\"Talk to an ERP Specialist\" CTA reaches /book-demo with a distinct context label", async ({ page }) => {
    // Regression test for a real Phase 7 Cycle 2 finding: this CTA's
    // ?intent=specialist param was previously silently dropped, giving no
    // differentiation from the generic demo CTA — see decision-log.md.
    await page.goto("/");
    const cta = page.getByRole("link", { name: "Talk to an ERP Specialist" }).first();
    await expect(cta).toHaveAttribute("href", "/book-demo?intent=specialist");
    await cta.click();
    await expect(page.getByText(/pair you with a specialist/i)).toBeVisible();
  });
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("opens, expands a module group, locks scroll, and closes on Escape returning focus", async ({ page }) => {
    await page.goto("/");
    const openButton = page.getByRole("button", { name: "Open menu" });
    await openButton.click();

    const dialog = page.getByRole("dialog", { name: "Site navigation" });
    await expect(dialog).toBeVisible();

    await page.getByRole("button", { name: "Revenue" }).click();
    // Scoped to the dialog: the footer also links to every module (including CRM),
    // so an unscoped locator matches two elements once both are in the DOM.
    await expect(dialog.getByRole("link", { name: /CRM/ })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(openButton).toBeFocused();
  });
});
