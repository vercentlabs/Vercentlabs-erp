import { test, expect } from "@playwright/test";

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
