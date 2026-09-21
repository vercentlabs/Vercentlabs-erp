import { test, expect, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { getProcurementWorld } from "./procurement-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Sourcing to purchase order with real roles: buyer runs an RFQ, two suppliers
// quote, the purchase manager (the only seeded role holding sourcing.award)
// awards to the cheaper one, the PO is approved by a DIFFERENT person, dispatched
// and amended -- the amendment approved by someone other than its requester.
async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown): Promise<T> {
  const origin = new URL(BASE_URL).origin;
  const response = await context.request.fetch(`${origin}/api/procurement${path}`, { method, data, headers: { Origin: origin, "Content-Type": "application/json" } });
  const body = await response.json();
  expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body as T;
}
async function pick(page: Page, trigger: Locator, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}
async function selectTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}

type Created = { record: { id: string; version: number } };

test.describe("Procurement sourcing, orders and agreements", () => {
  test("RFQ -> quotations -> award -> PO approval -> dispatch -> amendment", async ({ browser }) => {
    test.setTimeout(600_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const manager = await openSession(browser, world.manager);
    const approver = await openSession(browser, world.approver);
    try {
      // two active suppliers, seeded through the real API with the real onboarding rules
      const stamp = Date.now().toString(36).toUpperCase();
      const supplierNames: string[] = [];
      for (const label of ["A", "B"]) {
        const created = await api<Created>(buyer.context, "POST", "/suppliers", { supplierCode: `SRC-${label}-${stamp}`, legalName: `Sourcing ${label} ${stamp} Ltd`, displayName: `Sourcing ${label} ${stamp}`, currencyCode: "INR" });
        const submitted = await api<Created>(buyer.context, "POST", `/suppliers/${created.record.id}/submit`, { expectedVersion: created.record.version });
        const qualified = await api<Created>(manager.context, "POST", `/suppliers/${created.record.id}/qualify`, { expectedVersion: submitted.record.version });
        await api<Created>(manager.context, "POST", `/suppliers/${created.record.id}/activate`, { expectedVersion: qualified.record.version });
        supplierNames.push(`Sourcing ${label} ${stamp}`);
      }

      // --- buyer creates the RFQ
      const b = buyer.page;
      await b.goto("/procurement/rfqs/new", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "New RFQ" })).toBeVisible({ timeout: 180_000 });
      await b.getByLabel("Title").fill(`E2E RFQ ${stamp}`);
      await b.getByLabel("Bids close").fill("2027-02-01");
      await pick(b, b.getByRole("button", { name: /Select an item/ }).first(), new RegExp(world.itemCode));
      await setNumber(b.getByRole("textbox", { name: "Quantity 1" }), "10");
      await b.getByRole("button", { name: "Save RFQ" }).click();
      await expect(b).toHaveURL(/\/procurement\/rfqs\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const rfqUrl = b.url();
      await b.getByRole("button", { name: "Submit for approval" }).click();
      await expect(b.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await b.getByRole("button", { name: "Approve", exact: true }).click(); // creator: refused by the server
      await expect(b.getByText(/cannot approve the same document/i)).toBeVisible({ timeout: 30_000 });

      // a different person approves; the buyer opens it for bids
      const m = manager.page;
      await m.goto(rfqUrl, { waitUntil: "domcontentloaded" });
      await m.getByRole("button", { name: "Approve", exact: true }).click({ timeout: 120_000 });
      await expect(m.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await b.reload({ waitUntil: "domcontentloaded" });
      await b.getByRole("button", { name: "Open for bids" }).click({ timeout: 60_000 });
      await expect(b.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // invite one supplier through the UI
      await selectTab(b, /Suppliers/);
      await b.getByRole("button", { name: "Add supplier" }).click();
      const invite = b.getByRole("dialog", { name: "Add supplier" });
      await pick(b, invite.getByRole("button", { name: /Select supplier/ }), new RegExp(supplierNames[0]));
      await invite.getByRole("button", { name: "Add supplier" }).click();
      await expect(b.getByRole("dialog", { name: "Add supplier" })).toHaveCount(0, { timeout: 30_000 });

      // record two quotations: A at 100/unit, B at 90/unit (B is cheaper)
      await selectTab(b, /Quotations & award/);
      for (const [name, price] of [[supplierNames[0], "100"], [supplierNames[1], "90"]] as const) {
        await b.getByRole("button", { name: "Record quotation" }).click();
        const dialog = b.getByRole("dialog", { name: "Record supplier quotation" });
        await pick(b, dialog.getByRole("button", { name: /Select a supplier/ }), new RegExp(name));
        await setNumber(dialog.getByRole("textbox", { name: /Unit price/ }), price);
        await dialog.getByRole("button", { name: "Save quotation" }).click();
        await expect(b.getByRole("dialog", { name: "Record supplier quotation" })).toHaveCount(0, { timeout: 30_000 });
      }
      await expect(b.getByRole("row", { name: new RegExp(`${supplierNames[1]}.*900\\.00.*Lowest`) })).toBeVisible({ timeout: 30_000 });
      await expect(b.getByRole("row", { name: new RegExp(`${supplierNames[0]}.*1,000\\.00`) })).toBeVisible();
      await expect(b.getByRole("button", { name: "Award", exact: true })).toHaveCount(0); // buyer lacks sourcing.award

      // --- manager scores and awards to the cheaper bid
      await m.reload({ waitUntil: "domcontentloaded" });
      await selectTab(m, /Quotations & award/);
      await m.getByRole("button", { name: "Add score" }).click();
      const score = m.getByRole("dialog", { name: "Score a quotation" });
      await pick(m, score.getByRole("button", { name: /Select a quotation/ }), new RegExp(supplierNames[1]));
      await setNumber(score.getByRole("textbox", { name: /Score/ }), "92");
      await score.getByRole("button", { name: "Save score" }).click();
      await expect(m.getByRole("row", { name: /price.*92/ })).toBeVisible({ timeout: 30_000 });

      await m.getByRole("button", { name: "Award", exact: true }).click();
      const award = m.getByRole("dialog", { name: "Award this RFQ" });
      await pick(m, award.getByRole("button", { name: /Select the winner/ }), new RegExp(supplierNames[1]));
      await award.getByLabel("Expected delivery").fill("2027-03-01");
      await award.getByRole("button", { name: "Award", exact: true }).click();
      await expect(m).toHaveURL(/\/procurement\/orders\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const poUrl = m.url();
      await expect(m.getByText("Draft", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(m.getByText(/INR\s*900\.00/).first()).toBeVisible(); // 10 x 90, server-priced

      // --- PO approval by a different person
      await m.getByRole("button", { name: "Submit for approval" }).click();
      await expect(m.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await m.getByRole("button", { name: "Approve", exact: true }).click(); // creator (awarder): refused
      await expect(m.getByText(/cannot approve the same document/i)).toBeVisible({ timeout: 30_000 });
      const a = approver.page;
      await a.goto(poUrl, { waitUntil: "domcontentloaded" });
      await a.getByRole("button", { name: "Approve", exact: true }).click({ timeout: 120_000 });
      await expect(a.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // --- buyer dispatches and acknowledges
      await b.goto(poUrl, { waitUntil: "domcontentloaded" });
      await b.getByRole("button", { name: "Dispatch to supplier" }).click({ timeout: 120_000 });
      await expect(b.getByText("Dispatched", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await b.getByRole("button", { name: "Mark acknowledged" }).click();
      await expect(b.getByText("Acknowledged", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // --- buyer amends (quantity 10 -> 8); a reason is required; someone else approves
      await b.getByRole("button", { name: "Amend" }).click();
      await expect(b.getByRole("heading", { name: "Amend purchase order" })).toBeVisible({ timeout: 60_000 });
      await expect(b.getByRole("button", { name: "Submit amendment" })).toBeDisabled();
      await setNumber(b.getByRole("textbox", { name: "Quantity 1" }), "8");
      await b.getByLabel("Reason").fill("Reduced requirement");
      await b.getByRole("button", { name: "Submit amendment" }).click();
      await expect(b).toHaveURL(poUrl, { timeout: 60_000 });
      await expect(b.getByText("Pending amendment approval", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(b.getByRole("button", { name: "Approve amendment" })).toHaveCount(0); // buyer holds no po.approve

      await a.reload({ waitUntil: "domcontentloaded" });
      await a.getByRole("button", { name: "Approve amendment" }).click({ timeout: 120_000 });
      const decision = a.getByRole("dialog", { name: "Approve amendment" });
      await decision.getByRole("button", { name: "Approve amendment" }).click();
      await expect(a.getByText("Acknowledged", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(a.getByText(/INR\s*720\.00/).first()).toBeVisible(); // 8 x 90
      await selectTab(a, /Amendments/);
      await expect(a.getByRole("row", { name: /Reduced requirement.*Approved/ })).toBeVisible({ timeout: 30_000 });
    } finally {
      await buyer.context.close();
      await manager.context.close();
      await approver.context.close();
    }
  });

  test("agreement: created, approved by a contracts approver, activated, and a call-off order is raised from it", async ({ browser }) => {
    test.setTimeout(420_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const approver = await openSession(browser, world.approver);
    try {
      const stamp = Date.now().toString(36).toUpperCase();
      const created = await api<Created>(buyer.context, "POST", "/suppliers", { supplierCode: `AGR-${stamp}`, legalName: `Agreement Supplier ${stamp}`, displayName: `Agreement Supplier ${stamp}`, currencyCode: "INR" });
      const manager = await openSession(browser, world.manager);
      const submitted = await api<Created>(buyer.context, "POST", `/suppliers/${created.record.id}/submit`, { expectedVersion: created.record.version });
      const qualified = await api<Created>(manager.context, "POST", `/suppliers/${created.record.id}/qualify`, { expectedVersion: submitted.record.version });
      await api<Created>(manager.context, "POST", `/suppliers/${created.record.id}/activate`, { expectedVersion: qualified.record.version });
      await manager.context.close();

      const b = buyer.page;
      await b.goto("/procurement/agreements/new", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "New agreement" })).toBeVisible({ timeout: 180_000 });
      await b.getByLabel("Title").fill(`Blanket ${stamp}`);
      await pick(b, b.getByRole("button", { name: /Select supplier/ }).first(), new RegExp(`Agreement Supplier ${stamp}`));
      await b.getByLabel("Valid from").fill("2026-01-01");
      await b.getByLabel("Valid until").fill("2027-12-31");
      await pick(b, b.getByRole("button", { name: /Select an item/ }).first(), new RegExp(world.itemCode));
      await setNumber(b.getByRole("textbox", { name: "Committed quantity 1" }), "1000");
      await setNumber(b.getByRole("textbox", { name: "Agreed price 1" }), "95");
      await b.getByRole("button", { name: "Save agreement" }).click();
      await expect(b).toHaveURL(/\/procurement\/agreements\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const url = b.url();
      await expect(b.getByText(/INR\s*95,000\.00/).first()).toBeVisible({ timeout: 30_000 });
      await b.getByRole("button", { name: "Submit for approval" }).click();
      await expect(b.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(b.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0); // buyers hold contracts.manage, not .approve

      const a = approver.page;
      await a.goto(url, { waitUntil: "domcontentloaded" });
      await a.getByRole("button", { name: "Approve", exact: true }).click({ timeout: 120_000 });
      await expect(a.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      await b.reload({ waitUntil: "domcontentloaded" });
      await b.getByRole("button", { name: "Activate" }).click({ timeout: 60_000 });
      await expect(b.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // call-off order: created from the agreement with its lines and prices prefilled
      await b.getByRole("button", { name: "Create call-off order" }).click();
      await expect(b.getByRole("heading", { name: "New purchase order" })).toBeVisible({ timeout: 60_000 });
      await expect(b.getByLabel("Title")).toHaveValue(`Call-off: Blanket ${stamp}`);
      await b.getByLabel("Expected delivery").fill("2027-01-15");
      await setNumber(b.getByRole("textbox", { name: "Quantity 1" }), "50");
      await b.getByRole("button", { name: "Save purchase order" }).click();
      await expect(b).toHaveURL(/\/procurement\/orders\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(b.getByText(/INR\s*4,750\.00/).first()).toBeVisible({ timeout: 30_000 }); // 50 x 95

      // and the agreement's Consumption tab shows it
      await b.goto(url, { waitUntil: "domcontentloaded" });
      await selectTab(b, /Consumption/);
      await expect(b.getByRole("row", { name: /PO-.*INR 4,750\.00/ })).toBeVisible({ timeout: 30_000 });
    } finally {
      await buyer.context.close();
      await approver.context.close();
    }
  });
});
