import { test, expect } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// Task journey #6: an action a plain cashier-permission session isn't
// allowed to do must be refused with a clear error, AND must produce no
// unauthorized database mutation -- checked directly against Postgres, not
// just trusted from the UI's own error message.

test.describe("POS authorization boundaries", () => {
  test("a plain cashier (no pos.discount.apply) cannot apply a line discount, in the UI or via a direct API call", async ({ browser }) => {
    const world = await getPosWorld();
    await resetTerminalCarts(world.terminalId);

    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      const [createResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
        page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
      ]);
      const cart = (await createResponse.json()).cart as { id: string; version: number };

      // Defense in depth, layer 1 -- the UI never even renders the
      // discount controls for a cashier without pos.discount.apply.
      await expect(page.getByText("Cart discount (%)")).toHaveCount(0);

      await page.getByLabel("Search products").fill(world.itemCode);
      const productButton = page.getByRole("button", { name: new RegExp(world.itemName) });
      await expect(productButton).toBeVisible();
      const [addLineResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/lines") && res.request().method() === "POST"),
        productButton.click(),
      ]);
      const pricedCart = (await addLineResponse.json()).cart as { id: string; version: number; lines: Array<{ id: string }> };
      const lineId = pricedCart.lines[0].id;

      // Defense in depth, layer 2 -- even a direct, hand-crafted API call
      // (bypassing the UI entirely, as a malicious or buggy client might)
      // is refused server-side.
      const origin = new URL(page.url()).origin;
      const discountResponse = await page.request.post(`/api/pos/carts/${cart.id}/lines/${lineId}/discount`, {
        headers: { origin },
        data: { type: "percent", value: 5, reason: "unauthorized attempt", expectedVersion: pricedCart.version },
      });
      const discountBody = await discountResponse.json();
      expect(discountResponse.status(), JSON.stringify(discountBody)).toBe(403);
      expect(discountBody.code).toBe("PERMISSION_DENIED");

      // No unauthorized mutation: the line's discount is still zero, and no
      // approval request was ever created for it.
      const lineRow = await withPosDb((client) =>
        client.query(`SELECT manual_discount_amount FROM tenant.pos_cart_lines WHERE organization_id=$1 AND id=$2`, [world.organizationId, lineId]).then((r) => r.rows[0]),
      );
      expect(lineRow.manual_discount_amount).toBe("0.000000");
      const approvalRows = await withPosDb((client) =>
        client.query(`SELECT id FROM tenant.pos_cart_discount_approvals WHERE organization_id=$1 AND cart_id=$2`, [world.organizationId, cart.id]).then((r) => r.rows),
      );
      expect(approvalRows.length).toBe(0);
    } finally {
      await context.close();
    }
  });

  test("a cashier assigned to only one store is denied on a store they were never granted access to, with no shift ever created for it", async ({ browser }) => {
    const world = await getPosWorld();
    const { context, page } = await openPersonaSession(browser, world.cashier);
    try {
      await page.goto("/pos", { waitUntil: "domcontentloaded" });
      const origin = new URL(page.url()).origin;

      const shiftAttempt = await page.request.post("/api/pos/shifts", {
        headers: { origin },
        data: { storeId: world.secondStoreId, terminalId: world.secondTerminalId, openingCash: 0 },
      });
      const shiftBody = await shiftAttempt.json();
      expect(shiftAttempt.status(), JSON.stringify(shiftBody)).toBe(403);
      expect(shiftBody.code).toBe("POS_STORE_ACCESS_DENIED");

      const cartAttempt = await page.request.post("/api/pos/carts", {
        headers: { origin },
        data: { storeId: world.secondStoreId, terminalId: world.secondTerminalId, shiftId: world.shiftId },
      });
      expect(cartAttempt.status()).toBe(403);
      expect((await cartAttempt.json()).code).toBe("POS_STORE_ACCESS_DENIED");

      // No unauthorized row was created on the store they were denied.
      const shiftRows = await withPosDb((client) =>
        client
          .query(`SELECT id FROM tenant.pos_shifts WHERE organization_id=$1 AND store_id=$2 AND cashier_user_id=$3`, [world.organizationId, world.secondStoreId, world.cashier.userId])
          .then((r) => r.rows),
      );
      expect(shiftRows.length).toBe(0);

      // And their own assigned store still works normally -- the denial is
      // scoped to the specific store, not a broken session.
      const ownStoreCheck = await page.request.get("/api/pos/shifts", { headers: { origin } });
      expect(ownStoreCheck.status()).toBe(200);
      const ownStoreRows = (await ownStoreCheck.json()).rows as Array<{ store_id: string }>;
      expect(ownStoreRows.some((row) => row.store_id === world.storeId)).toBe(true);
      expect(ownStoreRows.some((row) => row.store_id === world.secondStoreId)).toBe(false);
    } finally {
      await context.close();
    }
  });
});
