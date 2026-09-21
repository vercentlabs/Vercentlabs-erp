import { test, expect } from "@playwright/test";

// CRM setup pages read in plain language: stages are ordered and explained, allowed moves are grouped by stage, record
// fields say where they appear, and destructive actions ask first. Read-only except for dialogs that are cancelled.

test("lead lifecycle shows ordered stages and allowed moves without leaking internals", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/settings/lead-lifecycle", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Lead lifecycle stages" })).toBeVisible({ timeout: 90_000 });
  const stages = page.getByRole("list", { name: "Lead stages in order" });
  await expect(stages.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Allowed moves" })).toBeVisible();
  await expect(page.getByText("Loading stages")).toHaveCount(0);
  // Codes and raw enum text stay out of the way.
  await expect(stages).not.toContainText(/order \d+ ·/);
  await expect(page.getByText("Transition reasons")).toHaveCount(0);

  // Stopping an allowed move asks first, and cancelling changes nothing.
  const stop = page.getByRole("button", { name: /^Stop allowing/ }).first();
  if (await stop.count()) {
    await stop.click();
    await expect(page.getByRole("alertdialog")).toContainText("Stop allowing this move?");
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  }
});

test("record fields explain where a field appears and build the internal name from the label", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/settings/record-fields", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByLabel("Which records do these fields belong to?")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/360|server-side/)).toHaveCount(0);
  await page.getByRole("button", { name: "New field" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Field name").fill("Preferred channel");
  await expect(dialog.getByLabel("Internal name")).toHaveValue("preferred_channel");
  await page.keyboard.press("Escape");
});

test("custom fields and tags separates tags, record types and fields", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/settings/custom-fields-and-tags", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("heading", { level: 2, name: "Tags", exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Custom record types", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fields on custom record types" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Custom Record Fields" })).toHaveAttribute("href", "/crm/settings/record-fields");
});

test("forecast uses date controls, plain labels and validates the date range", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/forecast", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Forecast", exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel("Expected to close from")).toHaveAttribute("type", "date");
  await expect(page.getByPlaceholder("YYYY-MM-DD")).toHaveCount(0);
  await expect(page.getByText("Weighted by probability")).toBeVisible();
  await page.getByLabel("Expected to close from").fill("2026-09-30");
  await page.getByLabel("Expected to close until").fill("2026-09-01");
  await expect(page.getByText("The end date is before the start date.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show these dates" })).toBeDisabled();
  await page.getByLabel("Expected to close until").fill("2026-12-31");
  await expect(page.getByRole("button", { name: "Show these dates" })).toBeEnabled();
});
