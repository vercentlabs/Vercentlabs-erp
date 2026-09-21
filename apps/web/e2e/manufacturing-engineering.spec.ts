import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { getManufacturingWorld } from "./manufacturing-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Engineering as real people: define a multi-level BOM, approval by a second person, explosion,
// where-used, an engineering change -- and what a view-only role cannot do.
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
    // a previous attempt may already have selected it (the trigger then shows the choice, not the placeholder)
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
type Rec = { record: { id: string } };

test("BOM definition, second-person approval, multi-level explosion, where-used, engineering change", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getManufacturingWorld();
  const manager = await openSession(browser, world.manager);
  const approver = await openSession(browser, world.approver);
  const viewer = await openSession(browser, world.viewer);
  try {
    const { items, suffix } = world;
    // a sub-assembly BOM (API, approved by the second person) so the finished BOM is multi-level
    const sub = await api<Rec>(manager.context, "POST", "/actions/bom-create", { itemId: items.sub.id, code: `SUB-${suffix}`, components: [{ itemId: items.subPart.id, quantity: 3 }] });
    await api(manager.context, "POST", "/actions/bom-submit", { id: sub.body.record.id });
    await api(approver.context, "POST", "/actions/bom-approve", { id: sub.body.record.id });

    // --- create the finished-goods BOM in the UI
    const m = manager.page;
    await open(m, "/manufacturing/boms", "Bills of materials");
    await m.getByRole("button", { name: "New BOM" }).click();
    await expect(m).toHaveURL(/\/manufacturing\/bom\/new$/, { timeout: 60_000 });
    await expect(m.getByRole("heading", { name: "New BOM" })).toBeVisible({ timeout: 60_000 });
    await expect(m.getByRole("button", { name: "Create BOM" })).toBeDisabled(); // nothing chosen yet
    await pick(m, m.getByRole("button", { name: /Select product/ }), new RegExp(items.finished.code));
    await m.getByLabel(/^BOM code/).fill(`FG-${suffix}`);
    await pick(m, m.getByRole("button", { name: /Component 1 item/ }), new RegExp(items.compA.code));
    await setNumber(m.getByRole("textbox", { name: "Component 1 quantity" }), "2");
    await setNumber(m.getByRole("textbox", { name: "Component 1 scrap percent" }), "10");
    await m.getByRole("button", { name: "Add component" }).click();
    await pick(m, m.getByRole("button", { name: /Component 2 item/ }), new RegExp(items.sub.code));
    await setNumber(m.getByRole("textbox", { name: "Component 2 quantity" }), "4");
    await m.getByRole("button", { name: "Create BOM" }).click();
    await expect(m).toHaveURL(/\/manufacturing\/bom\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const bomUrl = m.url();
    await expect(m.getByRole("heading", { name: `FG-${suffix} v1` })).toBeVisible({ timeout: 60_000 });
    await expect(m.getByText("Draft", { exact: true }).first()).toBeVisible();
    await expect(m.getByRole("table", { name: "Components" })).toContainText(items.sub.code);

    // --- submit; the author cannot approve; a second person sends it back, then approves
    await m.getByRole("button", { name: "Submit for approval" }).click();
    await expect(m.getByText("Submitted for approval.")).toBeVisible({ timeout: 30_000 });
    await m.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(m.getByRole("alert").filter({ hasText: /someone other than/i })).toBeVisible({ timeout: 30_000 });
    const a = approver.page;
    await a.goto(bomUrl, { waitUntil: "domcontentloaded" });
    await a.getByRole("button", { name: "Send back" }).click();
    const back = a.getByRole("dialog", { name: "Send back" });
    await expect(back.getByRole("button", { name: "Send back" })).toBeDisabled(); // a reason is required
    await back.getByLabel(/^Reason/).fill("Confirm the scrap allowance");
    await back.getByRole("button", { name: "Send back" }).click();
    await expect(a.getByText("Sent back to draft.")).toBeVisible({ timeout: 30_000 });
    await m.reload({ waitUntil: "domcontentloaded" });
    await expect(m.getByText(/Sent back: Confirm the scrap allowance/)).toBeVisible({ timeout: 60_000 });
    await m.getByRole("button", { name: "Submit for approval" }).click();
    await expect(m.getByText("Submitted for approval.")).toBeVisible({ timeout: 30_000 });
    await a.reload({ waitUntil: "domcontentloaded" });
    await a.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(a.getByText("BOM approved and active.")).toBeVisible({ timeout: 30_000 });

    // --- explosion: 5 finished = 10 A (+10% scrap) and 20 SUB -> 60 SP
    await setNumber(a.getByRole("textbox", { name: "Quantity to make" }), "5");
    await a.getByRole("button", { name: "Explode" }).click();
    const purchased = a.getByRole("list", { name: "Purchased totals" });
    await expect(purchased).toContainText(items.subPart.code, { timeout: 30_000 });
    await expect(purchased).toContainText(/60/);
    await expect(purchased).toContainText(/11\.11/); // 10 / 0.9
    await expect(a.getByRole("list", { name: "Explosion levels" })).toContainText(new RegExp(`${items.sub.code}.*built from SUB-${suffix}`));

    // --- where used: the sub-part is used by the sub-assembly and, through it, the finished product
    await open(a, "/manufacturing/where-used", "Where used");
    await pick(a, a.getByRole("button", { name: /Select item/ }), new RegExp(items.subPart.code));
    await a.getByRole("button", { name: "Find" }).click();
    const used = a.getByRole("list", { name: "Where used results" });
    await expect(used).toContainText(items.sub.code, { timeout: 30_000 });
    await expect(used).toContainText(items.finished.code);

    // --- engineering change: propose (manager), decided by a different person, implemented -> v2
    await m.goto(bomUrl, { waitUntil: "domcontentloaded" });
    await m.getByRole("button", { name: "Propose change" }).click();
    const propose = m.getByRole("dialog", { name: "Propose change" });
    await propose.getByLabel(/^Title/).fill("Add a third component");
    await propose.getByLabel(/^Why is this change needed/).fill("Field failures");
    await propose.getByRole("button", { name: "Add component" }).click();
    await pick(m, propose.getByRole("button", { name: /Component 3 item/ }), new RegExp(items.compC.code));
    await propose.getByRole("button", { name: "Submit proposal" }).click();
    await expect(m.getByText(/Engineering change proposed/)).toBeVisible({ timeout: 30_000 });
    await open(m, "/manufacturing/engineering-changes", "Engineering changes");
    const change = m.getByRole("row", { name: /ECN-.*Add a third component.*Draft/ });
    await expect(change).toBeVisible({ timeout: 30_000 });
    await change.getByRole("button", { name: "Submit" }).click();
    await expect(m.getByText("Change submitted.")).toBeVisible({ timeout: 30_000 });
    await m.getByRole("row", { name: /ECN-.*Add a third component.*Submitted/ }).getByRole("button", { name: "Approve" }).click();
    await expect(m.getByRole("alert").filter({ hasText: /someone other than its requester/i })).toBeVisible({ timeout: 30_000 });
    await open(a, "/manufacturing/engineering-changes", "Engineering changes");
    await a.getByRole("row", { name: /ECN-.*Add a third component.*Submitted/ }).getByRole("button", { name: "Approve" }).click();
    await expect(a.getByText("Change approved.")).toBeVisible({ timeout: 30_000 });
    await m.reload({ waitUntil: "domcontentloaded" });
    await m.getByRole("row", { name: /ECN-.*Add a third component.*Approved/ }).getByRole("button", { name: "Implement" }).click();
    await expect(m.getByText(/a new BOM version is active/)).toBeVisible({ timeout: 30_000 });
    await m.getByRole("row", { name: /ECN-.*Implemented/ }).getByRole("link", { name: "New version" }).click();
    await expect(m.getByRole("heading", { name: `FG-${suffix} v2` })).toBeVisible({ timeout: 60_000 });
    await expect(m.getByRole("table", { name: "Components" })).toContainText(items.compC.code);
    await expect(m.getByRole("list", { name: "Versions" })).toContainText(/v1.*Inactive/);

    // --- a view-only role can look, but cannot create; the server refuses too
    await open(viewer.page, "/manufacturing/boms", "Bills of materials");
    await expect(viewer.page.getByRole("button", { name: "New BOM" })).toHaveCount(0);
    const denied = await api<{ message?: string }>(viewer.context, "POST", "/actions/bom-create", { itemId: items.finished.id, code: "NOPE", components: [{ itemId: items.compA.id, quantity: 1 }] }, false);
    expect(denied.status).toBe(403);
  } finally {
    await manager.context.close();
    await approver.context.close();
    await viewer.context.close();
  }
});
