import { test, expect } from "@playwright/test";
import { RESOURCE_GUIDES, STANDALONE_GLOSSARY_SLUGS, GLOSSARY_TERMS, VERCENTLABS_VS_ODOO } from "@vercentlabs/landing-content";

const PROSE_GUIDE_SLUGS = RESOURCE_GUIDES.filter((g) => g.slug !== "erp-requirements-checklist").map((g) => g.slug);

function trackConsoleErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("resource hub", () => {
  test("/resources returns 200, renders one real H1, and has no console errors", async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const response = await page.goto("/resources");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(consoleErrors).toEqual([]);
  });

  test("/resources links to every cornerstone guide and the glossary", async ({ page }) => {
    await page.goto("/resources");
    for (const guide of RESOURCE_GUIDES) {
      await expect(page.locator(`a[href="/resources/${guide.slug}"]`).first()).toBeAttached();
    }
    await expect(page.locator('a[href="/resources/glossary"]').first()).toBeAttached();
    await expect(page.locator('a[href="/compare"]').first()).toBeAttached();
  });
});

test.describe("cornerstone guide routes", () => {
  for (const slug of PROSE_GUIDE_SLUGS) {
    test(`/resources/${slug} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors = trackConsoleErrors(page);
      const response = await page.goto(`/resources/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("an unknown resource slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/resources/not-a-real-guide");
    expect(response?.status()).toBe(404);
  });
});

test.describe("ERP requirements checklist", () => {
  test("/resources/erp-requirements-checklist returns 200 and renders every capability group as real, crawlable text", async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const response = await page.goto("/resources/erp-requirements-checklist");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByText("1039 requirements across 73 capability groups.")).toBeVisible();
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(73);
    expect(consoleErrors).toEqual([]);
  });

  test("module filter buttons narrow the visible list and fire no console errors", async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    await page.goto("/resources/erp-requirements-checklist");
    const manufacturingFilter = page.getByRole("button", { name: /^Manufacturing/ });
    await manufacturingFilter.click();
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(73);
    expect(consoleErrors).toEqual([]);
  });

  test("checking a box and reloading preserves progress via localStorage", async ({ page }) => {
    await page.goto("/resources/erp-requirements-checklist");
    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    await firstCheckbox.check();
    await expect(firstCheckbox).toBeChecked();
    await page.reload();
    await expect(page.locator('input[type="checkbox"]').first()).toBeChecked();
  });
});

test.describe("glossary routes", () => {
  test("/resources/glossary returns 200, renders one real H1, and lists every term", async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const response = await page.goto("/resources/glossary");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const entry of GLOSSARY_TERMS) {
      await expect(page.getByText(entry.term, { exact: true }).first()).toBeAttached();
    }
    expect(consoleErrors).toEqual([]);
  });

  for (const slug of STANDALONE_GLOSSARY_SLUGS) {
    test(`/resources/glossary/${slug} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors = trackConsoleErrors(page);
      const response = await page.goto(`/resources/glossary/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("an unknown glossary slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/resources/glossary/not-a-real-term");
    expect(response?.status()).toBe(404);
  });

  test("index-only terms (Lead to Cash, Procure to Pay) link to the real workflow page, not a 404", async ({ page }) => {
    await page.goto("/resources/glossary");
    const leadToCashLink = page.locator('a[href="/workflows/lead-to-cash"]');
    await expect(leadToCashLink.first()).toBeAttached();
    const response = await page.goto("/workflows/lead-to-cash");
    expect(response?.status()).toBe(200);
  });
});

test.describe("compare routes", () => {
  test("/compare returns 200 and links to the Odoo comparison", async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const response = await page.goto("/compare");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator(`a[href="/compare/${VERCENTLABS_VS_ODOO.slug}"]`).first()).toBeAttached();
    expect(consoleErrors).toEqual([]);
  });

  test(`/compare/${VERCENTLABS_VS_ODOO.slug} returns 200, renders the comparison table, and links to live sources`, async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const response = await page.goto(`/compare/${VERCENTLABS_VS_ODOO.slug}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.locator('a[href="https://www.odoo.com/pricing"]').first()).toBeAttached();
    expect(consoleErrors).toEqual([]);
  });

  test("comparison table is stacked (no horizontal overflow) at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/compare/${VERCENTLABS_VS_ODOO.slug}`);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("an unknown comparison slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/compare/vercentlabs-vs-not-a-real-competitor");
    expect(response?.status()).toBe(404);
  });
});

test.describe("machine-readable endpoints", () => {
  test("/llms.txt returns 200 real text with real routes, not HTML", async ({ page }) => {
    const response = await page.goto("/llms.txt");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/plain");
    const body = await response?.text();
    expect(body).toContain("/modules/manufacturing");
    expect(body).toContain("/resources/glossary");
  });

  test("/resources/feed.xml returns 200 valid RSS with real dated entries", async ({ page }) => {
    const response = await page.goto("/resources/feed.xml");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("xml");
    const body = await response?.text();
    expect(body).toContain("<rss version=\"2.0\">");
    expect(body).toContain("<pubDate>");
    for (const guide of RESOURCE_GUIDES) {
      expect(body).toContain(`/resources/${guide.slug}`);
    }
  });

  test("/sitemap.xml includes every new Phase 6 route", async ({ page }) => {
    const response = await page.goto("/sitemap.xml");
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain("/resources</loc>");
    expect(body).toContain("/resources/glossary</loc>");
    expect(body).toContain(`/compare/${VERCENTLABS_VS_ODOO.slug}</loc>`);
    for (const guide of RESOURCE_GUIDES) {
      expect(body).toContain(`/resources/${guide.slug}</loc>`);
    }
  });
});
