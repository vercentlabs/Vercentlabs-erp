import { test, expect } from "@playwright/test";

import { getSalesWorld, openSalesSession } from "./sales-fixtures";

// Customer master (F031/F032) and catalogue (F033) through the UI as real
// personas. The catalogue must not expose standard cost to a rep (no margin
// permission) while a manager (who holds it) sees it.
test.describe("Sales customers and products", () => {
  test("create, enrich, edit and archive a customer; catalogue hides cost from reps", async ({ browser }) => {
    test.setTimeout(360_000);
    const world = await getSalesWorld();
    const rep = await openSalesSession(browser, world.rep);
    const manager = await openSalesSession(browser, world.manager);
    try {
      const r = rep.page;
      const stamp = Date.now().toString(36);
      const name = `E2E Customer ${stamp}`;

      await r.goto("/sales/customers", { waitUntil: "domcontentloaded" });
      await expect(r.getByRole("heading", { name: "Customers" })).toBeVisible({ timeout: 120_000 });
      await expect(async () => {
        await r.getByRole("button", { name: "New customer" }).click();
        await expect(r.getByRole("dialog", { name: "New customer" })).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      const create = r.getByRole("dialog", { name: "New customer" });
      await expect(create.getByRole("button", { name: "Create customer" })).toBeDisabled();
      await create.getByLabel("Code").fill(`EC-${stamp}`);
      await create.getByLabel("Display name").fill(name);
      const digits = String(Date.now()).slice(-4);
      await create.getByLabel("GSTIN").fill(`29QWERT${digits}F1Z5`); // unique per run: duplicates are refused server-side
      await create.getByRole("button", { name: "Create customer" }).click();
      await expect(r).toHaveURL(/\/sales\/customers\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      await expect(r.getByRole("heading", { name })).toBeVisible({ timeout: 60_000 });

      // contact
      await r.getByRole("tab", { name: /Contacts/ }).click();
      await r.getByRole("button", { name: "Add contact" }).click();
      const contact = r.getByRole("dialog", { name: "Add contact" });
      await contact.getByLabel("First name").fill("Asha");
      await contact.getByLabel("Last name").fill("Rao");
      await contact.getByLabel("Email").fill("asha@example.com");
      await contact.getByRole("button", { name: "Add contact" }).click();
      await expect(r.getByRole("row", { name: /Asha Rao.*asha@example.com/ })).toBeVisible({ timeout: 30_000 });

      // address
      await r.getByRole("tab", { name: /Addresses/ }).click();
      await r.getByRole("button", { name: "Add address" }).click();
      const address = r.getByRole("dialog", { name: "Add address" });
      await address.getByLabel("Address line 1").fill("1 MG Road");
      await address.getByLabel("City").fill("Bengaluru");
      await address.getByLabel("State").first().fill("Karnataka");
      await address.getByLabel("Postal code").fill("560001");
      await address.getByRole("button", { name: "Add address" }).click();
      await expect(r.getByRole("row", { name: /1 MG Road.*Bengaluru.*560001/ })).toBeVisible({ timeout: 30_000 });

      // edit the customer's legal name
      await r.getByRole("button", { name: "Edit", exact: true }).first().click();
      const edit = r.getByRole("dialog", { name: "Edit customer" });
      await edit.getByLabel("Legal name").fill(`${name} Pvt Ltd`);
      await edit.getByRole("button", { name: "Save changes" }).click();
      await r.getByRole("tab", { name: "Profile" }).click();
      await expect(r.getByText(`${name} Pvt Ltd`)).toBeVisible({ timeout: 30_000 });

      // archive: banner appears, and it leaves the default (active) list
      await r.getByRole("button", { name: "Archive" }).click();
      await expect(r.getByText(/This customer is archived/)).toBeVisible({ timeout: 30_000 });
      await r.goto("/sales/customers", { waitUntil: "domcontentloaded" });
      await r.getByRole("searchbox", { name: "Search customers" }).fill(name);
      await expect(r.getByText("No customers match")).toBeVisible({ timeout: 30_000 });

      // catalogue: rep sees no cost column; manager does
      // The catalogue has grown over many runs and lists only its first page, so find this run's item by its code.
      await r.goto("/sales/products", { waitUntil: "domcontentloaded" });
      await r.getByRole("searchbox", { name: "Search products" }).fill(world.itemCode);
      await expect(r.getByRole("row", { name: new RegExp(world.itemCode) })).toBeVisible({ timeout: 120_000 });
      await expect(r.getByRole("columnheader", { name: /Standard cost/i })).toHaveCount(0);
      const m = manager.page;
      await m.goto("/sales/products", { waitUntil: "domcontentloaded" });
      await m.getByRole("searchbox", { name: "Search products" }).fill(world.itemCode);
      await expect(m.getByRole("row", { name: new RegExp(world.itemCode) })).toBeVisible({ timeout: 120_000 });
      await expect(m.getByRole("columnheader", { name: /Standard cost/i })).toBeVisible();
    } finally {
      await rep.context.close();
      await manager.context.close();
    }
  });
});
