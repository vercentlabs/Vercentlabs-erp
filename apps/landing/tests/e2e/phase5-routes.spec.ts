import { test, expect } from "@playwright/test";
import { LANDING_INDUSTRIES, LANDING_SOLUTIONS, ROUTED_WORKFLOW_SLUGS, getWorkflow, getLandingModule } from "@vercentlabs/landing-content";

test.describe("industry routes", () => {
  for (const industry of LANDING_INDUSTRIES) {
    test(`/industries/${industry.slug} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      const response = await page.goto(`/industries/${industry.slug}`);
      expect(response?.status()).toBe(200);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("an unknown industry slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/industries/not-a-real-industry");
    expect(response?.status()).toBe(404);
  });

  test("/industries index returns 200 and links to all 4 industry pages", async ({ page }) => {
    const response = await page.goto("/industries");
    expect(response?.status()).toBe(200);
    for (const industry of LANDING_INDUSTRIES) {
      await expect(page.locator(`a[href="/industries/${industry.slug}"]`).first()).toBeAttached();
    }
  });
});

test.describe("solution routes", () => {
  for (const solution of LANDING_SOLUTIONS) {
    test(`/solutions/${solution.slug} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      const response = await page.goto(`/solutions/${solution.slug}`);
      expect(response?.status()).toBe(200);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("an unknown solution slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/solutions/not-a-real-solution");
    expect(response?.status()).toBe(404);
  });

  test("/solutions index returns 200 and links to all 5 solution pages", async ({ page }) => {
    const response = await page.goto("/solutions");
    expect(response?.status()).toBe(200);
    for (const solution of LANDING_SOLUTIONS) {
      await expect(page.locator(`a[href="/solutions/${solution.slug}"]`).first()).toBeAttached();
    }
  });
});

test.describe("workflow routes", () => {
  for (const slug of ROUTED_WORKFLOW_SLUGS) {
    test(`/workflows/${slug} returns 200, renders one real H1, and has no console errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });

      const response = await page.goto(`/workflows/${slug}`);
      expect(response?.status()).toBe(200);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toHaveCount(1);
      expect(consoleErrors).toEqual([]);
    });
  }

  test("an unknown workflow slug returns a real 404, not a crash", async ({ page }) => {
    const response = await page.goto("/workflows/not-a-real-workflow");
    expect(response?.status()).toBe(404);
  });

  test("an unrouted-but-real workflow slug (e.g. quote-to-order) also 404s on the route, since it has no page this phase", async ({ page }) => {
    const response = await page.goto("/workflows/quote-to-order");
    expect(response?.status()).toBe(404);
  });

  test("/workflows index returns 200 and links to all 6 routed workflow pages", async ({ page }) => {
    const response = await page.goto("/workflows");
    expect(response?.status()).toBe(200);
    for (const slug of ROUTED_WORKFLOW_SLUGS) {
      await expect(page.locator(`a[href="/workflows/${slug}"]`).first()).toBeAttached();
    }
  });
});

test.describe("implementation route", () => {
  test("/implementation returns 200, renders one real H1, and has no console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const response = await page.goto("/implementation");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(consoleErrors).toEqual([]);
  });

  test("/implementation renders all 8 phase names", async ({ page }) => {
    await page.goto("/implementation");
    for (const name of ["Discovery", "Solution Design", "Configuration", "Data Migration", "Testing", "Training", "Launch", "Post-Launch"]) {
      await expect(page.getByRole("heading", { name, exact: true, level: 3 })).toBeVisible();
    }
  });
});

test.describe("book-demo conversion context: industry/workflow/solution", () => {
  test("book-demo preselects modules and shows a contextual heading for a valid ?industry=", async ({ page }) => {
    const industry = LANDING_INDUSTRIES[0];
    await page.goto(`/book-demo?industry=${industry.slug}`);
    const firstModule = getLandingModule(industry.moduleStack[0].moduleKey);
    if (firstModule) {
      await expect(page.getByRole("checkbox", { name: firstModule.name })).toBeChecked();
    }
    await expect(page.getByText(`Built for ${industry.name.toLowerCase()}`, { exact: false })).toBeVisible();
  });

  test("book-demo preselects modules for a valid ?workflow=", async ({ page }) => {
    const workflow = getWorkflow(ROUTED_WORKFLOW_SLUGS[0]);
    if (!workflow) throw new Error("expected a real routed workflow");
    await page.goto(`/book-demo?workflow=${workflow.slug}`);
    const firstModule = getLandingModule(workflow.modules[0]);
    if (firstModule) {
      await expect(page.getByRole("checkbox", { name: firstModule.name })).toBeChecked();
    }
  });

  test("book-demo preselects modules for a valid ?solution=", async ({ page }) => {
    const solution = LANDING_SOLUTIONS[0];
    await page.goto(`/book-demo?solution=${solution.slug}`);
    const firstModule = getLandingModule(solution.relatedModuleKeys[0]);
    if (firstModule) {
      await expect(page.getByRole("checkbox", { name: firstModule.name })).toBeChecked();
    }
  });

  test("book-demo ignores an invalid ?industry= instead of crashing", async ({ page }) => {
    const response = await page.goto("/book-demo?industry=not-a-real-industry");
    expect(response?.status()).toBe(200);
    const checked = await page.locator('input[type="checkbox"]:checked').count();
    expect(checked).toBe(0);
  });

  test("book-demo ignores an invalid ?workflow= instead of crashing", async ({ page }) => {
    const response = await page.goto("/book-demo?workflow=not-a-real-workflow");
    expect(response?.status()).toBe(200);
    const checked = await page.locator('input[type="checkbox"]:checked').count();
    expect(checked).toBe(0);
  });

  test("book-demo ignores an invalid ?solution= instead of crashing", async ({ page }) => {
    const response = await page.goto("/book-demo?solution=not-a-real-solution");
    expect(response?.status()).toBe(200);
    const checked = await page.locator('input[type="checkbox"]:checked').count();
    expect(checked).toBe(0);
  });

  test("a real ?workflow= that is not routed this phase (e.g. quote-to-order) is ignored, not trusted", async ({ page }) => {
    const response = await page.goto("/book-demo?workflow=quote-to-order");
    expect(response?.status()).toBe(200);
    const checked = await page.locator('input[type="checkbox"]:checked').count();
    expect(checked).toBe(0);
  });
});
