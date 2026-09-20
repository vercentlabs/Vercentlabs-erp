import { test, expect, type Page } from "@playwright/test";

import { getProcurementWorld } from "./procurement-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Request-to-approval journeys with real Procurement roles. A requester raises a
// requisition (cannot submit it: that needs requisition.manage); a buyer submits;
// an approver decides from the Approval queue. A supplier is onboarded by a buyer
// and QUALIFIED by a different person (segregation of duties).
async function selectTab(page: Page, name: string | RegExp) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}
async function pick(page: Page, trigger: ReturnType<Page["getByRole"]>, option: RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe("Procurement requests and supplier onboarding", () => {
  test("requisition: requester creates, buyer submits, approver rejects then approves from the queue", async ({ browser }) => {
    test.setTimeout(420_000);
    const world = await getProcurementWorld();
    const requester = await openSession(browser, world.requester);
    const buyer = await openSession(browser, world.buyer);
    const approver = await openSession(browser, world.approver);
    try {
      const title = `E2E requisition ${Date.now().toString(36)}`;
      const r = requester.page;
      await r.goto("/procurement/requisitions/new", { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: "New requisition" })).toBeVisible({ timeout: 120_000 });
      await r.getByLabel("Title").fill(title);
      await r.getByLabel("Need by").fill("2027-01-31");
      await pick(r, r.getByRole("button", { name: /Select an item/ }).first(), new RegExp(world.itemCode));
      const quantity = r.getByRole("textbox", { name: "Quantity 1" });
      await quantity.click();
      await quantity.press("Control+A");
      await quantity.pressSequentially("10");
      await quantity.blur();
      const price = r.getByRole("textbox", { name: "Estimated price 1" });
      await price.click();
      await price.press("Control+A");
      await price.pressSequentially("100");
      await price.blur();
      await r.getByRole("button", { name: "Save requisition" }).click();
      await expect(r).toHaveURL(/\/procurement\/requisitions\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const url = r.url();
      await expect(r.getByText("Draft", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(r.getByText(/INR\s*1,000\.00/).first()).toBeVisible(); // server-computed total
      // the requester holds no submit permission: the control is not offered
      await expect(r.getByRole("button", { name: "Submit for approval" })).toHaveCount(0);

      // buyer submits
      const b = buyer.page;
      await b.goto(url, { waitUntil: "domcontentloaded" });
      await b.getByRole("button", { name: "Submit for approval" }).click({ timeout: 120_000 });
      await expect(b.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // approver: reject with a reason from the queue
      const a = approver.page;
      await a.goto("/procurement/approval-queue", { waitUntil: "domcontentloaded" });
      await expect(a.getByRole("heading", { name: "Approval queue" })).toBeVisible({ timeout: 120_000 });
      await a.goto(url, { waitUntil: "domcontentloaded" });
      await expect(a.getByRole("button", { name: "Reject" })).toBeVisible({ timeout: 120_000 });
      await a.getByRole("button", { name: "Reject" }).click();
      const dialog = a.getByRole("dialog", { name: "Reject" });
      await expect(dialog.getByRole("button", { name: "Reject" })).toBeDisabled();
      await dialog.getByLabel("Reason").fill("Quantity too high");
      await dialog.getByRole("button", { name: "Reject" }).click();
      await expect(a.getByText("Rejected", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // buyer edits (rejected is editable) and resubmits; approver approves from the QUEUE
      await b.reload({ waitUntil: "domcontentloaded" });
      await b.getByRole("button", { name: "Edit" }).click({ timeout: 60_000 });
      await expect(b.getByRole("heading", { name: "Edit requisition" })).toBeVisible({ timeout: 60_000 });
      const editedQuantity = b.getByRole("textbox", { name: "Quantity 1" });
      await editedQuantity.click();
      await editedQuantity.press("Control+A");
      await editedQuantity.pressSequentially("5");
      await editedQuantity.blur();
      await b.getByRole("button", { name: "Save changes" }).click();
      await expect(b).toHaveURL(url, { timeout: 60_000 });
      await expect(b.getByText(/INR\s*500\.00/).first()).toBeVisible({ timeout: 30_000 });
      await b.getByRole("button", { name: "Submit for approval" }).click();
      await expect(b.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      await a.goto("/procurement/approval-queue", { waitUntil: "domcontentloaded" });
      const queued = a.getByRole("row", { name: new RegExp(`Requisition`) }).filter({ hasText: "INR 500.00" }).first();
      await expect(queued).toBeVisible({ timeout: 60_000 });
      await queued.getByRole("button", { name: "Approve" }).click();
      await expect(a.getByText("Approved.")).toBeVisible({ timeout: 30_000 });
      await a.goto(url, { waitUntil: "domcontentloaded" });
      await expect(a.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(a.getByRole("button", { name: "Create purchase order" })).toHaveCount(0); // approver holds no po.create
    } finally {
      await requester.context.close();
      await buyer.context.close();
      await approver.context.close();
    }
  });

  test("supplier: buyer onboards, adds a site, a DIFFERENT person qualifies, then it is activated", async ({ browser }) => {
    test.setTimeout(420_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const manager = await openSession(browser, world.manager);
    try {
      const stamp = Date.now().toString(36).toUpperCase();
      const b = buyer.page;
      await b.goto("/procurement/suppliers/new", { waitUntil: "domcontentloaded" });
      await expect(b.getByRole("heading", { name: "New supplier" })).toBeVisible({ timeout: 120_000 });
      await b.getByLabel("Supplier code").fill(`E2E-${stamp}`);
      await b.getByLabel("Legal name").fill(`E2E Supplier ${stamp} Pvt Ltd`);
      await b.getByLabel("Payment terms").fill("Net 30");
      await b.getByRole("button", { name: "Save supplier" }).click();
      await expect(b).toHaveURL(/\/procurement\/suppliers\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const url = b.url();
      await expect(b.getByText("Draft", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(b.getByText(`E2E-${stamp}`).first()).toBeVisible();

      await b.getByRole("button", { name: "Submit for qualification" }).click();
      await expect(b.getByText("Submitted", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      // the buyer created it, so the server refuses their own qualification
      await b.getByRole("button", { name: "Qualify", exact: true }).click();
      await expect(b.getByText(/cannot approve the same document/i)).toBeVisible({ timeout: 30_000 });

      await selectTab(b, /Sites/);
      await b.getByRole("button", { name: "Add site" }).click();
      const site = b.getByRole("dialog", { name: "Add site" });
      await site.getByLabel("Site name").fill("Pune Plant");
      await site.getByLabel("Contact name").fill("Ravi Kumar");
      await site.getByRole("button", { name: "Add site" }).click();
      await expect(b.getByRole("row", { name: /Pune Plant.*Ravi Kumar/ })).toBeVisible({ timeout: 30_000 });

      // a different person (purchase manager) qualifies, then activates
      const m = manager.page;
      await m.goto(url, { waitUntil: "domcontentloaded" });
      await m.getByRole("button", { name: "Qualify", exact: true }).click({ timeout: 120_000 });
      await expect(m.getByText("Qualified", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await m.getByRole("button", { name: "Activate" }).click();
      await expect(m.getByText("Active", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      // suspending needs a reason
      await m.getByRole("button", { name: "Suspend" }).click();
      const suspend = m.getByRole("dialog", { name: "Suspend" });
      await expect(suspend.getByRole("button", { name: "Suspend" })).toBeDisabled();
      await suspend.getByLabel("Reason").fill("Under review");
      await suspend.getByRole("button", { name: "Suspend" }).click();
      await expect(m.getByText("Suspended", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await buyer.context.close();
      await manager.context.close();
    }
  });
});
