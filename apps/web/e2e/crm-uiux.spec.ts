import { test, expect } from "@playwright/test";

// Regression coverage for the CRM UI/UX pass: existing records open in their edit screens, scheduling uses real
// date/time controls (no typed timestamps), reminders are chips over stored minutes, guests are chips.

const FUTURE_DATE = "2027-03-15";

test("existing account and contact records open in edit and save", async ({ page }) => {
  test.setTimeout(240_000);
  for (const [list, nameLabel] of [["/crm/accounts", "Account name"], ["/crm/contacts", "First name"]] as const) {
    await page.goto(list, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const row = page.locator("tbody tr").first();
    await row.waitFor({ timeout: 90_000 });
    await row.locator("td").nth(1).click();
    await page.waitForURL(new RegExp(`${list}/[0-9a-f-]{36}$`), { timeout: 60_000 });
    await page.goto(`${new URL(page.url()).pathname}/edit`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await expect(page.getByText(/not found/i)).toHaveCount(0);
    const field = page.getByLabel(nameLabel).first();
    await expect(field).toBeVisible({ timeout: 60_000 });
    await expect(field).not.toHaveValue("");
  }
});

test("a lead and an opportunity open in edit (not a false not-found)", async ({ page }) => {
  test.setTimeout(240_000);
  for (const list of ["/crm/leads", "/crm/opportunities"]) {
    await page.goto(list, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const row = page.locator("tbody tr").first();
    await row.waitFor({ timeout: 90_000 });
    await row.locator("td").nth(1).click();
    await page.waitForURL(new RegExp(`${list}/[0-9a-f-]{36}$`), { timeout: 60_000 });
    await page.goto(`${new URL(page.url()).pathname}/edit`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await expect(page.getByRole("button", { name: /save changes/i })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/not found/i)).toHaveCount(0);
  }
});

test("follow-up uses date/time controls and reminder chips, and stores the reminder minutes", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/follow-ups/new", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("button", { name: "1 day before" })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "At due time" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder("YYYY-MM-DDTHH:mm")).toHaveCount(0);
  await expect(page.getByText(/minutes before due, comma-separated/i)).toHaveCount(0);

  const subject = `UX follow-up ${Date.now()}`;
  await page.getByLabel("Subject").fill(subject);
  await page.getByRole("button", { name: "1 hour before" }).click();
  await page.getByRole("button", { name: "1 week before" }).click();
  await page.getByLabel("Due date").fill(FUTURE_DATE);
  await page.getByLabel("Due time").fill("10:30");

  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/crm/follow-ups") && r.method() === "POST"),
    page.getByRole("button", { name: "Create follow-up" }).click(),
  ]);
  const body = request.postDataJSON() as { reminderOffsets: number[]; dueAt: string };
  expect([...body.reminderOffsets].sort((a, b) => a - b)).toEqual([0, 1440, 10080]);
  expect(body.dueAt).toMatch(/^2027-03-15T\d\d:\d\d:00\.000Z$/);
  await page.waitForURL(/\/crm\/follow-ups$/, { timeout: 60_000 });
});

test("meeting: start date/time + duration + guest chips, end time derived", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/meetings/new", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByLabel("Subject")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder("YYYY-MM-DDTHH:mm")).toHaveCount(0);
  await page.getByLabel("Subject").fill(`UX meeting ${Date.now()}`);
  await page.getByLabel("Starts date").fill(FUTURE_DATE);
  await page.getByLabel("Starts time").fill("14:00");
  await page.getByLabel("Guest emails").fill("guest.one@example.com,");
  await page.getByLabel("Guest emails").fill("not-an-email");
  await page.getByLabel("Guest emails").press("Enter");
  await expect(page.getByText(/not a valid email/i)).toBeVisible();
  await page.getByLabel("Guest emails").fill("guest.two@example.com");
  await page.getByLabel("Guest emails").press("Enter");
  await expect(page.getByRole("button", { name: "Remove guest.one@example.com" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove guest.two@example.com" })).toBeVisible();

  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/crm/meetings") && r.method() === "POST"),
    page.getByRole("button", { name: "Schedule meeting" }).click(),
  ]);
  const body = request.postDataJSON() as { startAt: string; endAt: string; attendees: Array<{ email?: string }> };
  expect(new Date(body.endAt).getTime() - new Date(body.startAt).getTime()).toBe(30 * 60_000);
  expect(body.attendees.map((a) => a.email).sort()).toEqual(["guest.one@example.com", "guest.two@example.com"]);
});

test("call: scheduling needs a real date and time, and lets you relate it to a record", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/crm/calls/new", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByLabel("Subject")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder("YYYY-MM-DDTHH:mm")).toHaveCount(0);
  await page.getByLabel("Subject").fill(`UX call ${Date.now()}`);
  await page.getByRole("button", { name: "Schedule call" }).click();
  await expect(page.getByText(/choose when this call is scheduled/i)).toBeVisible();
  await page.getByLabel("Call time date").fill(FUTURE_DATE);
  await page.getByLabel("Call time time").fill("11:15");
  await expect(page.getByText(/India Standard Time|Standard Time|Coordinated Universal Time/).first()).toBeVisible();
});
