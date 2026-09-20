import { test, expect, type BrowserContext, type Locator } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";
import { getProcurementWorld } from "./procurement-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Receive-to-pay with real roles and REAL stock: goods are received partly and one
// unit rejected (only the accepted quantity enters stock), part is returned to the
// supplier (dispatch takes it out again), and the supplier invoice is matched --
// a clean invoice matches, an over-invoice opens an exception that is resolved.
// Stock quantities are read straight from the database so the assertion is about
// the ledger, not about what the screen says.
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const origin = new URL(process.env.QA_BASE_URL ?? "http://localhost:3000").origin;
  const response = await context.request.fetch(`${origin}/api/procurement${path}`, { method, data, headers: { Origin: origin, "Content-Type": "application/json" } });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body as T;
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}
async function onHand(organizationId: string, itemCode: string): Promise<number> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(`SELECT COALESCE(sum(b.quantity),0) AS q FROM tenant.stock_balances b JOIN tenant.items i ON i.id=b.item_id WHERE b.organization_id=$1 AND i.code=$2`, [organizationId, itemCode]);
    return Number(result.rows[0].q);
  } finally {
    await client.end();
  }
}

type Rec = { record: { id: string; version: number } };

test.describe("Procurement receiving, returns and invoice matching", () => {
  test("partial receipt with a rejection, return to supplier, invoice match and exception", async ({ browser }) => {
    test.setTimeout(720_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const manager = await openSession(browser, world.manager);
    const approver = await openSession(browser, world.approver);
    const receiver = await openSession(browser, world.receiver);
    const owner = await openSession(browser, { email: fixtures.ownerEmail, password: fixtures.ownerPassword, userId: "" });
    try {
      const stamp = Date.now().toString(36).toUpperCase();
      // --- a dispatched PO for 10 units of the stock-tracked item, built through the real API
      const supplier = await api<Rec>(buyer.context, "POST", "/suppliers", { supplierCode: `RCV-${stamp}`, legalName: `Receiving Supplier ${stamp}`, displayName: `Receiving Supplier ${stamp}`, currencyCode: "INR" });
      const s1 = await api<Rec>(buyer.context, "POST", `/suppliers/${supplier.record.id}/submit`, { expectedVersion: supplier.record.version });
      const s2 = await api<Rec>(manager.context, "POST", `/suppliers/${supplier.record.id}/qualify`, { expectedVersion: s1.record.version });
      await api<Rec>(manager.context, "POST", `/suppliers/${supplier.record.id}/activate`, { expectedVersion: s2.record.version });
      const options = (await api<{ options: { items: Array<{ id: string; code: string }>; warehouses: Array<{ id: string; code: string }> } }>(buyer.context, "GET", "/options")).options;
      const item = options.items.find((i) => i.code === world.itemCode)!;
      const warehouse = options.warehouses.find((w) => w.code === world.warehouseCode)!;
      const po = await api<Rec>(buyer.context, "POST", "/purchase-orders", { title: `Receiving ${stamp}`, supplierId: supplier.record.id, expectedDeliveryDate: "2027-03-01", lines: [{ itemId: item.id, description: world.itemName, quantity: "10", unitPrice: "100", warehouseId: warehouse.id }] });
      const p1 = await api<Rec>(buyer.context, "POST", `/purchase-orders/${po.record.id}/submit`, { expectedVersion: po.record.version });
      const p2 = await api<Rec>(approver.context, "POST", `/purchase-orders/${po.record.id}/approve`, { expectedVersion: p1.record.version });
      await api<Rec>(buyer.context, "POST", `/purchase-orders/${po.record.id}/dispatch`, { expectedVersion: p2.record.version });
      const poUrl = `/procurement/orders/${po.record.id}`;
      const stockStart = await onHand(world.organizationId, world.itemCode);

      // --- receiver: receive 7 accepted + 1 rejected (with a reason) from the PO
      const r = receiver.page;
      await r.goto(poUrl, { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("button", { name: "Receive goods" })).toBeVisible({ timeout: 180_000 });
      await r.getByRole("button", { name: "Receive goods" }).click();
      await expect(r.getByRole("heading", { name: "New goods receipt" })).toBeVisible({ timeout: 60_000 });
      await r.getByLabel("Received on").fill("2027-02-10");
      await expect(r.getByRole("textbox", { name: "Accepted 1" })).toHaveValue("10", { timeout: 30_000 }); // prefilled with the outstanding quantity
      await setNumber(r.getByRole("textbox", { name: "Accepted 1" }), "7");
      await setNumber(r.getByRole("textbox", { name: "Rejected 1" }), "1");
      await r.getByRole("textbox", { name: "Rejection reason 1" }).fill("Damaged in transit");
      await r.getByRole("button", { name: "Save goods receipt" }).click();
      await expect(r).toHaveURL(/\/procurement\/receipts\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const receiptUrl = r.url();
      await r.getByRole("button", { name: "Submit for approval" }).click();
      await expect(r.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(r.getByRole("button", { name: /Approve and post to stock/ })).toHaveCount(0); // receivers hold no approve permission
      expect(await onHand(world.organizationId, world.itemCode)).toBe(stockStart); // nothing in stock yet

      // approver approves: the accepted 7 (not the rejected 1) enter stock
      const a = approver.page;
      await a.goto(receiptUrl, { waitUntil: "domcontentloaded" });
      await a.getByRole("button", { name: /Approve and post to stock/ }).click({ timeout: 120_000 });
      await expect(a.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      expect(await onHand(world.organizationId, world.itemCode)).toBe(stockStart + 7);

      // the order is partially received; the rejection is listed with its reason
      await a.goto(poUrl, { waitUntil: "domcontentloaded" });
      await expect(a.getByText("Partially received", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(a.getByText(/7 of 10/).first()).toBeVisible();
      await a.goto("/procurement/rejections", { waitUntil: "domcontentloaded" });
      await expect(a.getByRole("row", { name: /GRN-.*Damaged in transit/ }).first()).toBeVisible({ timeout: 60_000 });

      // --- return 2 units to the supplier: dispatch takes them out of stock again
      await r.goto(receiptUrl, { waitUntil: "domcontentloaded" });
      await r.getByRole("button", { name: "Return goods" }).click({ timeout: 60_000 });
      await expect(r.getByRole("heading", { name: "New return" })).toBeVisible({ timeout: 60_000 });
      await r.getByLabel("Reason for return").fill("Wrong specification");
      await setNumber(r.getByRole("textbox", { name: "Quantity 1" }), "2");
      await r.getByRole("button", { name: "Save return" }).click();
      await expect(r).toHaveURL(/\/procurement\/returns\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const returnUrl = r.url();
      await r.getByRole("button", { name: "Submit for approval" }).click();
      await expect(r.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await a.goto(returnUrl, { waitUntil: "domcontentloaded" });
      await a.getByRole("button", { name: "Approve", exact: true }).click({ timeout: 120_000 });
      await expect(a.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await r.reload({ waitUntil: "domcontentloaded" });
      await r.getByRole("button", { name: "Dispatch to supplier" }).click({ timeout: 60_000 });
      await expect(r.getByText("Dispatched", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      expect(await onHand(world.organizationId, world.itemCode)).toBe(stockStart + 5);

      // --- invoice: the buyer holds no matching permission; the owner (finance) records it
      await buyer.page.goto("/procurement/invoices", { waitUntil: "domcontentloaded" });
      await expect(buyer.page.getByRole("heading", { name: "Supplier invoices" })).toBeVisible({ timeout: 120_000 });
      await expect(buyer.page.getByRole("button", { name: "Record supplier invoice" })).toHaveCount(0);

      const o = owner.page;
      await o.goto(`/procurement/invoices/new?order=${po.record.id}`, { waitUntil: "domcontentloaded" });
      await expect(o.getByRole("heading", { name: "Record supplier invoice" })).toBeVisible({ timeout: 180_000 });
      await o.getByLabel("Supplier's invoice number").fill(`INV-${stamp}-1`);
      await expect(o.getByRole("textbox", { name: "Invoiced quantity 1" })).toHaveValue("7", { timeout: 30_000 }); // received and not yet invoiced
      await o.getByRole("button", { name: "Match invoice" }).click();
      await expect(o.getByText("Matched", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(o.getByText(/INR\s*700\.00/).first()).toBeVisible();

      // an invoice for MORE than was received is an exception, with the reason spelled out
      await o.goto(`/procurement/invoices/new?order=${po.record.id}`, { waitUntil: "domcontentloaded" });
      await o.getByLabel("Supplier's invoice number").fill(`INV-${stamp}-2`);
      await setNumber(o.getByRole("textbox", { name: "Invoiced quantity 1" }), "5");
      await o.getByRole("button", { name: "Match invoice" }).click();
      await expect(o.getByText("Exception", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(o.getByText(/Receipt quantity variance/i).first()).toBeVisible();
      await o.getByRole("link", { name: "Review it" }).click();
      await expect(o).toHaveURL(/\/procurement\/three-way-match\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(o.getByRole("row", { name: /receipt quantity variance/i })).toBeVisible({ timeout: 30_000 });

      // overriding needs a reason; the exception ends up overridden and stays on record
      await o.getByRole("button", { name: "Override", exact: true }).click();
      const dialog = o.getByRole("dialog", { name: "Override" });
      await expect(dialog.getByRole("button", { name: "Override" })).toBeDisabled();
      await dialog.getByLabel("Reason").fill("Supplier will credit the difference");
      await dialog.getByRole("button", { name: "Override" }).click();
      await expect(o.getByText("Overridden", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // the invoice register lists both, and the duplicate number is refused
      await o.goto("/procurement/invoices", { waitUntil: "domcontentloaded" });
      await expect(o.getByRole("row", { name: new RegExp(`INV-${stamp}-1.*Matched`) })).toBeVisible({ timeout: 60_000 });
      await expect(o.getByRole("row", { name: new RegExp(`INV-${stamp}-2.*Exception`) })).toBeVisible();
      await o.goto(`/procurement/invoices/new?order=${po.record.id}`, { waitUntil: "domcontentloaded" });
      await o.getByLabel("Supplier's invoice number").fill(`inv-${stamp}-1`);
      await setNumber(o.getByRole("textbox", { name: "Invoiced quantity 1" }), "1");
      await o.getByRole("button", { name: "Match invoice" }).click();
      await expect(o.getByText(/already been matched/i)).toBeVisible({ timeout: 30_000 });
    } finally {
      await buyer.context.close();
      await manager.context.close();
      await approver.context.close();
      await receiver.context.close();
      await owner.context.close();
    }
  });
});
