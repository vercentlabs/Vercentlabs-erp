import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { getInventoryWorld } from "./inventory-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Physical inventory as real people: one counts and submits, a DIFFERENT one approves; the
// warehouse is frozen meanwhile; only the variance is posted.
const origin = () => new URL(BASE_URL).origin;
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown, expectOk = true): Promise<{ status: number; body: T }> {
  const response = await context.request.fetch(`${origin()}/api/inventory${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const body = (await response.json()) as T;
  if (expectOk) expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return { status: response.status(), body };
}
async function pick(page: Page, trigger: Locator, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}

test("physical inventory: freeze, count, submit, segregated approval, only the variance is posted", async ({ browser }) => {
  test.setTimeout(600_000);
  const world = await getInventoryWorld();
  const counter = await openSession(browser, world.manager);
  const approver = await openSession(browser, world.approver);
  try {
    const stamp = Date.now().toString(36).toUpperCase();
    const uom = (await api<{ rows: Array<{ id: string; code: string }> }>(counter.context, "GET", "/master/units-of-measure")).body.rows.find((u) => u.code === "EA")!;
    const wh = (await api<{ record: { id: string } }>(counter.context, "POST", "/master/warehouses", { code: `CW-${stamp}`, name: `Count WH ${stamp}` })).body.record;
    const item = (await api<{ record: { id: string } }>(counter.context, "POST", "/master/items", { code: `CI-${stamp}`, name: `Count Item ${stamp}`, uomId: uom.id })).body.record;
    await api(counter.context, "POST", "/actions/movement", { movementType: "receipt", itemId: item.id, warehouseId: wh.id, quantity: 10, unitCost: 3, idempotencyKey: `seed-${stamp}` });

    const c = counter.page;
    await open(c, "/inventory/physical-inventory", "Physical inventory");
    await c.getByRole("button", { name: "Start physical inventory" }).click();
    const dialog = c.getByRole("dialog", { name: "Start physical inventory" });
    await pick(c, dialog.getByRole("button", { name: /Select warehouse/ }), new RegExp(`Count WH ${stamp}`));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(c.getByText("Physical inventory started.")).toBeVisible({ timeout: 30_000 });
    const row = c.getByRole("row", { name: new RegExp(`PHY-.*Counting.*Count WH ${stamp}`) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("link").click();
    await expect(c).toHaveURL(/\/inventory\/counts\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const detailUrl = c.url();

    // frozen: an issue in that warehouse is refused, with the reason
    const frozen = await api<{ message?: string }>(counter.context, "POST", "/actions/movement", { movementType: "issue", itemId: item.id, warehouseId: wh.id, quantity: 1 }, false);
    expect(frozen.status).toBe(409);
    expect(frozen.body.message).toMatch(/frozen/i);

    // count 8 of 10: submit is blocked until the variance has a reason
    await expect(c.getByRole("heading", { name: /^PHY-/ })).toBeVisible({ timeout: 60_000 });
    await setNumber(c.getByRole("textbox", { name: `Counted CI-${stamp}` }), "8");
    await c.getByRole("button", { name: "Save counts" }).click();
    await expect(c.getByText("Counts saved.")).toBeVisible({ timeout: 30_000 });
    await c.getByRole("button", { name: "Submit for review" }).click();
    await expect(c.getByRole("alert").filter({ hasText: /need a reason/ })).toBeVisible({ timeout: 30_000 });
    await c.getByRole("textbox", { name: `Reason CI-${stamp}` }).fill("Two units damaged");
    await c.getByRole("button", { name: "Save counts" }).click();
    await expect(c.getByText("Counts saved.")).toBeVisible({ timeout: 30_000 });
    await c.getByRole("button", { name: "Submit for review" }).click();
    await expect(c.getByText("Submitted for review.")).toBeVisible({ timeout: 30_000 });

    // the counter cannot approve their own count
    await c.getByRole("button", { name: "Approve and post" }).click();
    await expect(c.getByRole("alert").filter({ hasText: /someone other than/ })).toBeVisible({ timeout: 30_000 });

    // a different person approves; only the 2-unit variance is posted
    const a = approver.page;
    await a.goto(detailUrl, { waitUntil: "domcontentloaded" });
    await expect(a.getByRole("button", { name: "Approve and post" })).toBeVisible({ timeout: 180_000 });
    await a.getByRole("button", { name: "Approve and post" }).click();
    await expect(a.getByText("Count approved and variances posted.")).toBeVisible({ timeout: 30_000 });
    await expect(a.getByText("Posted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    const balances = await api<{ rows: Array<{ item_id: string; on_hand_quantity: string }> }>(approver.context, "GET", `/stock/balances?itemId=${item.id}`);
    expect(Number(balances.body.rows[0].on_hand_quantity)).toBe(8);
    const ledger = await api<{ rows: Array<{ movement_type: string; quantity: string; reason: string }> }>(approver.context, "GET", `/stock/ledger?itemId=${item.id}&movementType=adjustment`);
    expect(ledger.body.rows).toHaveLength(1);
    expect(Number(ledger.body.rows[0].quantity)).toBe(-2);
    // and the warehouse is unfrozen again
    await api(counter.context, "POST", "/actions/movement", { movementType: "issue", itemId: item.id, warehouseId: wh.id, quantity: 1 });
  } finally {
    await counter.context.close();
    await approver.context.close();
  }
});
