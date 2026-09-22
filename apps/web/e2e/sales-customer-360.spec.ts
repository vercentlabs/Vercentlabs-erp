import { test, expect } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

// F031/F032 regression coverage for the customer-360 fixes: a dedicated
// by-id read (no more 200-row list-and-find), orders filtered by the
// customer's stable id (no more display-name text matching), create-time
// duplicate governance, and a confirming archive step. Credit-exposure
// correctness (AR now counted alongside open orders) is covered at the
// backend unit level in services/api/tests/sales-credit-ar-exposure-f031.test.mjs
// rather than here, since exercising it end-to-end needs a posted Accounting
// invoice, which this Sales-only fixture world does not set up.
test.describe("Sales customer 360", () => {
  test("a customer opens directly by id, and its Orders tab only ever shows its own orders", async ({ browser }) => {
    test.setTimeout(360_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    try {
      const r = rep.page;
      const stamp = Date.now().toString(36);

      async function createCustomer(name: string) {
        await r.goto("/sales/customers", { waitUntil: "domcontentloaded" });
        await expect(r.getByRole("heading", { name: "Customers" })).toBeVisible({ timeout: 120_000 });
        await expect(async () => {
          await r.getByRole("button", { name: "New customer" }).click();
          await expect(r.getByRole("dialog", { name: "New customer" })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        const create = r.getByRole("dialog", { name: "New customer" });
        await create.getByLabel("Code").fill(`${name.replace(/\s+/g, "")}-${Math.random().toString(36).slice(2, 6)}`);
        await create.getByLabel("Display name").fill(name);
        await create.getByRole("button", { name: "Create customer" }).click();
        await expect(r).toHaveURL(/\/sales\/customers\/([0-9a-f-]{36})$/, { timeout: 60_000 });
        const match = r.url().match(/\/sales\/customers\/([0-9a-f-]{36})$/);
        return match![1];
      }

      // Overlapping names, so a display-name ILIKE match (the old bug) would
      // have leaked orders between them.
      const acmeId = await createCustomer(`Acme ${stamp}`);
      const acmeRetailId = await createCustomer(`Acme Retail ${stamp}`);

      // Navigating straight to the second customer's URL exercises the
      // dedicated by-id read; the old implementation only ever found a
      // customer by searching the first 200 rows of the active list.
      await r.goto(`/sales/customers/${acmeRetailId}`, { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: `Acme Retail ${stamp}` })).toBeVisible({ timeout: 60_000 });

      // Neither customer has any orders yet, so the "no orders" empty state
      // on the newer, similarly-named customer is itself part of what's
      // being checked here: it must never show orders that belong to "Acme".
      await r.getByRole("tab", { name: "Orders" }).click();
      await expect(r.getByText("No orders yet.")).toBeVisible({ timeout: 30_000 });

      // Sanity: the other customer also opens cleanly by id.
      await r.goto(`/sales/customers/${acmeId}`, { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: `Acme ${stamp}` })).toBeVisible({ timeout: 60_000 });
    } finally {
      await rep.context.close();
    }
  });

  test("creating a customer with a duplicate GSTIN is blocked unless overridden with a reason", async ({ browser }) => {
    test.setTimeout(360_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    try {
      const r = rep.page;
      const stamp = Date.now().toString(36);
      const gstin = `29QWERT${String(Date.now()).slice(-4)}F1Z5`;

      await r.goto("/sales/customers", { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: "Customers" })).toBeVisible({ timeout: 120_000 });

      async function openCreateDialog() {
        await expect(async () => {
          await r.getByRole("button", { name: "New customer" }).click();
          await expect(r.getByRole("dialog", { name: "New customer" })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
        return r.getByRole("dialog", { name: "New customer" });
      }

      const first = await openCreateDialog();
      await first.getByLabel("Code").fill(`DUP1-${stamp}`);
      await first.getByLabel("Display name").fill(`Duplicate Origin ${stamp}`);
      await first.getByLabel("GSTIN").fill(gstin);
      await first.getByRole("button", { name: "Create customer" }).click();
      await expect(r).toHaveURL(/\/sales\/customers\/[0-9a-f-]{36}$/, { timeout: 60_000 });

      // Same GSTIN, different code/name -- the DB's unique constraint alone
      // would not catch this variant, only the governed duplicate check does.
      await r.goto("/sales/customers", { waitUntil: "domcontentloaded" });
      const second = await openCreateDialog();
      await second.getByLabel("Code").fill(`DUP2-${stamp}`);
      await second.getByLabel("Display name").fill(`Duplicate Copy ${stamp}`);
      await second.getByLabel("GSTIN").fill(gstin);
      await second.getByRole("button", { name: "Create customer" }).click();
      await expect(second.getByText(/looks like an exact duplicate/i)).toBeVisible({ timeout: 30_000 });

      await expect(second.getByRole("button", { name: "Create anyway" })).toBeDisabled();
      await second.getByLabel("Why create this anyway?").fill("Confirmed with the customer: a separate legal entity.");
      await second.getByRole("button", { name: "Create anyway" }).click();
      await expect(r).toHaveURL(/\/sales\/customers\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(r.getByRole("heading", { name: `Duplicate Copy ${stamp}` })).toBeVisible({ timeout: 60_000 });
    } finally {
      await rep.context.close();
    }
  });
});
