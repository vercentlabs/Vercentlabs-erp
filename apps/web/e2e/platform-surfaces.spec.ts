import { test, expect } from "@playwright/test";

// Home, My work and Search are real surfaces backed by the same endpoints as the pages they link to.

test("home shows real attention counts and the modules the person can open, with no placeholder copy", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("heading", { name: /^Welcome,/ })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Needs your attention" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your modules" }).getByRole("link").first()).toBeVisible();
  await expect(page.getByText(/being connected to their backing APIs/i)).toHaveCount(0);
  // A count links to the page that lists exactly those records.
  await expect(page.getByRole("link", { name: /Unread notifications/ })).toHaveAttribute("href", "/notifications");
});

test("my work groups approvals, tasks and follow-ups and says so when there is nothing", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/work", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "My work", exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Waiting for your decision" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tasks and follow-ups" })).toBeVisible();
  await expect(page.getByText(/being connected|not yet built/i)).toHaveCount(0);
});

test("search finds pages and records, asks for more letters, and reports no match plainly", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/search", { waitUntil: "domcontentloaded", timeout: 120_000 });
  const box = page.getByRole("searchbox", { name: "Search records and pages" });
  await expect(box).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Type at least 2 letters/)).toBeVisible();

  // A page by name.
  await box.fill("Leads");
  await expect(page.getByRole("region", { name: "Pages" }).getByRole("link", { name: /^Leads/ }).first()).toHaveAttribute("href", "/crm/leads", { timeout: 60_000 });

  // A record by name, using an account that exists.
  const first = await (await page.request.get("/api/crm/accounts?limit=1&status=active")).json();
  const name = String(first.rows?.[0]?.displayName ?? "");
  test.skip(!name, "the organisation has no account to search for");
  await box.fill(name);
  await expect(page.getByRole("region", { name: "Accounts" }).getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/search\?q=/);

  // Nothing matches.
  await box.fill("zzzqqxx-no-such-thing");
  await expect(page.getByText(/Nothing matches/)).toBeVisible({ timeout: 60_000 });
});
