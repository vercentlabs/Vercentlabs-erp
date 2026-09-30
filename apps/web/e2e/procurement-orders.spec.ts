import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { getProcurementWorld } from "./procurement-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Purchase orders with real roles: the buyer raises a PO for an active supplier,
// it is approved by a DIFFERENT person, dispatched and amended -- the amendment
// approved by someone other than its requester.
async function api<T>(
  context: BrowserContext,
  method: "GET" | "POST",
  path: string,
  data?: unknown,
): Promise<T> {
  const origin = new URL(BASE_URL).origin;
  const response = await context.request.fetch(
    `${origin}/api/procurement${path}`,
    {
      method,
      data,
      headers: { Origin: origin, "Content-Type": "application/json" },
    },
  );
  const body = await response.json();
  expect(
    response.ok(),
    `${method} ${path}: ${JSON.stringify(body)}`,
  ).toBeTruthy();
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
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}
async function setNumber(box: Locator, value: string) {
  await box.click();
  await box.press("Control+A");
  await box.pressSequentially(value);
  await box.blur();
}

type Created = { record: { id: string; version: number } };

test.describe("Procurement purchase orders", () => {
  test("PO -> approval by another person -> dispatch -> amendment", async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    const world = await getProcurementWorld();
    const buyer = await openSession(browser, world.buyer);
    const manager = await openSession(browser, world.manager);
    const approver = await openSession(browser, world.approver);
    try {
      // an active supplier, seeded through the real API with the real onboarding rules
      const stamp = Date.now().toString(36).toUpperCase();
      const supplierName = `Ordering ${stamp}`;
      const created = await api<Created>(buyer.context, "POST", "/suppliers", {
        supplierCode: `ORD-${stamp}`,
        legalName: `${supplierName} Ltd`,
        displayName: supplierName,
        currencyCode: "INR",
      });
      const submitted = await api<Created>(
        buyer.context,
        "POST",
        `/suppliers/${created.record.id}/submit`,
        { expectedVersion: created.record.version },
      );
      const qualified = await api<Created>(
        manager.context,
        "POST",
        `/suppliers/${created.record.id}/qualify`,
        { expectedVersion: submitted.record.version },
      );
      await api<Created>(
        manager.context,
        "POST",
        `/suppliers/${created.record.id}/activate`,
        { expectedVersion: qualified.record.version },
      );

      // --- buyer raises the PO: 10 x 90
      const b = buyer.page;
      await b.goto("/procurement/orders/new", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        b.getByRole("heading", { name: "New purchase order" }),
      ).toBeVisible({ timeout: 180_000 });
      await pick(
        b,
        b.getByRole("button", { name: /Select supplier/ }),
        new RegExp(supplierName),
      );
      await b.getByLabel("Expected delivery").fill("2027-03-01");
      await pick(
        b,
        b.getByRole("button", { name: /Select an item/ }).first(),
        new RegExp(world.itemCode),
      );
      await b
        .getByRole("textbox", { name: "Description 1" })
        .fill("E2E ordered item");
      await setNumber(b.getByRole("textbox", { name: "Quantity 1" }), "10");
      await setNumber(b.getByRole("textbox", { name: "Unit price 1" }), "90");
      await b.getByRole("button", { name: "Save purchase order" }).click();
      await expect(b).toHaveURL(/\/procurement\/orders\/[0-9a-f-]{36}$/, {
        timeout: 60_000,
      });
      const poUrl = b.url();
      await expect(b.getByText("Draft", { exact: true }).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(b.getByText(/INR\s*900\.00/).first()).toBeVisible();

      // --- PO approval by a different person
      await b.getByRole("button", { name: "Submit for approval" }).click();
      await expect(
        b.getByText("Submitted", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      const a = approver.page;
      await a.goto(poUrl, { waitUntil: "domcontentloaded" });
      await a
        .getByRole("button", { name: "Approve", exact: true })
        .click({ timeout: 120_000 });
      await expect(
        a.getByText("Approved", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // --- buyer dispatches and acknowledges
      await b.reload({ waitUntil: "domcontentloaded" });
      await b
        .getByRole("button", { name: "Dispatch to supplier" })
        .click({ timeout: 120_000 });
      await expect(
        b.getByText("Dispatched", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await b.getByRole("button", { name: "Mark acknowledged" }).click();
      await expect(
        b.getByText("Acknowledged", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      // --- buyer amends (quantity 10 -> 8); a reason is required; someone else approves
      await b.getByRole("button", { name: "Amend" }).click();
      await expect(
        b.getByRole("heading", { name: "Amend purchase order" }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        b.getByRole("button", { name: "Submit amendment" }),
      ).toBeDisabled();
      await setNumber(b.getByRole("textbox", { name: "Quantity 1" }), "8");
      await b.getByLabel("Reason").fill("Reduced requirement");
      await b.getByRole("button", { name: "Submit amendment" }).click();
      await expect(b).toHaveURL(poUrl, { timeout: 60_000 });
      await expect(
        b.getByText("Pending amendment approval", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        b.getByRole("button", { name: "Approve amendment" }),
      ).toHaveCount(0); // buyer holds no po.approve

      await a.reload({ waitUntil: "domcontentloaded" });
      await a
        .getByRole("button", { name: "Approve amendment" })
        .click({ timeout: 120_000 });
      const decision = a.getByRole("dialog", { name: "Approve amendment" });
      await decision.getByRole("button", { name: "Approve amendment" }).click();
      await expect(
        a.getByText("Acknowledged", { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(a.getByText(/INR\s*720\.00/).first()).toBeVisible(); // 8 x 90
      await selectTab(a, /Amendments/);
      await expect(
        a.getByRole("row", { name: /Reduced requirement.*Approved/ }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await buyer.context.close();
      await manager.context.close();
      await approver.context.close();
    }
  });
});
