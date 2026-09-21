import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { getManufacturingWorld } from "./manufacturing-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Process definition as real people: a shift calendar, a work center on it, a routing with
// operations, capacity -- and what a view-only role cannot do.
const origin = () => new URL(BASE_URL).origin;
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown, expectOk = true): Promise<{ status: number; body: T }> {
  const response = await context.request.fetch(`${origin()}/api/manufacturing${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const body = (await response.json()) as T;
  if (expectOk) expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return { status: response.status(), body };
}
async function pick(page: Page, trigger: Locator, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible()) && (await trigger.count()) === 0) return;
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}

test("calendar, shift, closure, work center, routing, capacity; view-only role is read-only", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getManufacturingWorld();
  const manager = await openSession(browser, world.manager);
  const viewer = await openSession(browser, world.viewer);
  try {
    const { items, suffix } = world;
    const m = manager.page;

    // --- calendar (UI)
    await open(m, "/manufacturing/calendars", "Shift calendars");
    await m.getByRole("button", { name: "Add calendar" }).click();
    const cal = m.getByRole("dialog", { name: "Add calendar" });
    await cal.getByLabel(/^Code/).fill(`CAL-${suffix}`);
    await cal.getByLabel(/^Name/).fill(`Plant calendar ${suffix}`);
    await cal.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Calendar saved.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("row", { name: new RegExp(`CAL-${suffix}.*Mon Tue Wed Thu Fri`) })).toBeVisible({ timeout: 30_000 });

    // --- shift: an overlapping one is refused
    await open(m, "/manufacturing/shifts", "Shifts");
    await m.getByRole("button", { name: "Add shift" }).click();
    const shift = m.getByRole("dialog", { name: "Add shift" });
    await pick(m, shift.getByRole("button", { name: /Select calendar/ }), new RegExp(`CAL-${suffix}`));
    await shift.getByLabel(/^Shift name/).fill("Day");
    await shift.getByLabel(/^Starts/).fill("08:00");
    await shift.getByLabel(/^Ends/).fill("16:00");
    await setNumber(shift.getByRole("textbox", { name: /^Break minutes/ }), "60");
    await shift.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Shift added.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("row", { name: new RegExp(`CAL-${suffix}.*Day.*08:00.*16:00.*60 min.*420 min`) })).toBeVisible({ timeout: 30_000 });
    await m.getByRole("button", { name: "Add shift" }).click();
    const overlap = m.getByRole("dialog", { name: "Add shift" });
    await pick(m, overlap.getByRole("button", { name: /Select calendar/ }), new RegExp(`CAL-${suffix}`));
    await overlap.getByLabel(/^Shift name/).fill("Overlap");
    await overlap.getByLabel(/^Starts/).fill("15:00");
    await overlap.getByLabel(/^Ends/).fill("20:00");
    await overlap.getByRole("button", { name: "Save" }).click();
    await expect(overlap.getByRole("alert")).toContainText(/overlaps/i, { timeout: 30_000 });
    await overlap.getByRole("button", { name: "Close" }).last().click();

    // --- work center on that calendar: 2 machines at 50% -> 420 minutes a day
    await open(m, "/manufacturing/work-centers", "Work centers");
    await m.getByRole("button", { name: "Add work center" }).click();
    const wc = m.getByRole("dialog", { name: "Add work center" });
    await wc.getByLabel(/^Code/).fill(`WC-${suffix}`);
    await wc.getByLabel(/^Name/).fill(`Press ${suffix}`);
    await pick(m, wc.getByRole("button", { name: /Select shift calendar/ }), new RegExp(`CAL-${suffix}`));
    await setNumber(wc.getByRole("textbox", { name: /^Machines/ }), "2");
    await setNumber(wc.getByRole("textbox", { name: /^Efficiency/ }), "50");
    await wc.getByRole("button", { name: "Save" }).click();
    await expect(m.getByText("Work center saved.")).toBeVisible({ timeout: 30_000 });
    const wcRow = m.getByRole("row", { name: new RegExp(`WC-${suffix}.*Press ${suffix}.*Machine.*Active.*CAL-${suffix}.*2.*50%.*420`) });
    await expect(wcRow).toBeVisible({ timeout: 30_000 });
    // an invalid edit is refused with a readable message
    await wcRow.getByRole("button", { name: "Edit" }).click();
    const edit = m.getByRole("dialog", { name: /Edit/ });
    await setNumber(edit.getByRole("textbox", { name: /^Machines/ }), "0");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(edit.getByRole("alert")).toContainText(/at least one machine/i, { timeout: 30_000 });
    await edit.getByRole("button", { name: "Close" }).last().click();

    // --- routing (UI): two operations, then activate
    await open(m, "/manufacturing/routings", "Routings");
    await m.getByRole("button", { name: "New routing" }).click();
    await expect(m).toHaveURL(/\/manufacturing\/routing\/new$/, { timeout: 60_000 });
    await expect(m.getByRole("heading", { name: "New routing" })).toBeVisible({ timeout: 60_000 });
    await expect(m.getByRole("button", { name: "Create routing" })).toBeDisabled();
    await m.getByLabel(/^Routing code/).fill(`RT-${suffix}`);
    await m.getByLabel(/^Name/).first().fill(`Finished goods routing ${suffix}`);
    await pick(m, m.getByRole("button", { name: /Select product/ }), new RegExp(items.finished.code));
    await m.getByRole("textbox", { name: "Operation 1 name" }).fill("Press");
    await pick(m, m.getByRole("button", { name: /Operation 1 work center/ }), new RegExp(`WC-${suffix}`));
    await setNumber(m.getByRole("textbox", { name: "Operation 1 setup minutes" }), "30");
    await setNumber(m.getByRole("textbox", { name: "Operation 1 run minutes per unit" }), "5");
    await m.getByRole("button", { name: "Add operation" }).click();
    await m.getByRole("textbox", { name: "Operation 2 name" }).fill("Inspect");
    await pick(m, m.getByRole("button", { name: /Operation 2 work center/ }), new RegExp(`WC-${suffix}`));
    await setNumber(m.getByRole("textbox", { name: "Operation 2 run minutes per unit" }), "1");
    await m.getByRole("button", { name: "Create routing" }).click();
    await expect(m).toHaveURL(/\/manufacturing\/routing\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(m.getByRole("heading", { name: `RT-${suffix} v1` })).toBeVisible({ timeout: 60_000 });
    await expect(m.getByRole("table", { name: "Operations" })).toContainText("Inspect");
    await m.getByRole("button", { name: "Activate" }).click();
    await expect(m.getByText("Routing activated.")).toBeVisible({ timeout: 30_000 });
    await m.getByRole("button", { name: "Revise" }).click();
    await expect(m.getByRole("heading", { name: `RT-${suffix} v2` })).toBeVisible({ timeout: 60_000 });
    await expect(m.getByText("Draft", { exact: true }).first()).toBeVisible();
    await m.getByRole("button", { name: "Activate" }).click();
    await expect(m.getByText("Routing activated.")).toBeVisible({ timeout: 30_000 });
    await expect(m.getByRole("list", { name: "Versions" })).toContainText(/v1.*Inactive/);

    // --- capacity: the work center shows 420 available minutes on a working weekday
    await open(m, "/manufacturing/capacity", "Capacity");
    const capacity = m.getByRole("table", { name: "Capacity by work center" });
    await expect(capacity.getByRole("row", { name: new RegExp(`Press ${suffix}`) })).toBeVisible({ timeout: 60_000 });
    await expect(capacity).toContainText(/0\/420/);

    // --- view-only: can look, cannot change
    await open(viewer.page, "/manufacturing/work-centers", "Work centers");
    await expect(viewer.page.getByRole("button", { name: "Add work center" })).toHaveCount(0);
    const denied = await api<{ message?: string }>(viewer.context, "POST", "/actions/work-center-save", { code: "NOPE", name: "Nope" }, false);
    expect(denied.status).toBe(403);
    const shiftDenied = await api<{ message?: string }>(viewer.context, "POST", "/actions/shift-add", { calendarId: crypto.randomUUID(), startTime: "08:00", endTime: "09:00" }, false);
    expect(shiftDenied.status).toBe(403);
  } finally {
    await manager.context.close();
    await viewer.context.close();
  }
});
