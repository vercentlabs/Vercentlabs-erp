import { test, expect } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// Task journey #5: hold a cart with items, verify it disappears from the
// active checkout slot and appears in "Held sales", resume it, verify the
// cart contents/total are intact (repriced from server data, not a client
// cache), and complete it.

test("cashier holds a cart, sees it in Held sales, resumes it with contents intact, and completes it", async ({ browser }) => {
  test.setTimeout(60_000);
  const world = await getPosWorld();
  await resetTerminalCarts(world.terminalId);

  const { context, page } = await openPersonaSession(browser, world.cashier);
  try {
    await page.goto("/pos/checkout", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST");

    await page.getByLabel("Search products").fill(world.itemCode);
    const productButton = page.getByRole("button", { name: new RegExp(world.itemName) });
    await expect(productButton).toBeVisible();
    await productButton.click();
    await expect(page.getByText("INR 250.00 each")).toBeVisible();
    await page.getByLabel("Search products").fill(""); // clear so later name assertions are unambiguous

    const [holdResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/hold")),
      page.getByRole("button", { name: /Hold sale/i }).click(),
    ]);
    const heldCartId = (await holdResponse.json()).cart.id as string;

    // F287: holding clears the active checkout slot -- a brand new, empty
    // cart is created immediately so the cashier can keep ringing up the
    // next customer.
    await expect(page.getByText("Cart is empty")).toBeVisible();

    const heldRow = await withPosDb((client) =>
      client.query(`SELECT status FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [world.organizationId, heldCartId]).then((r) => r.rows[0]),
    );
    expect(heldRow.status).toBe("held");

    // F288: resuming while a DIFFERENT cart is already active on this
    // terminal is rejected server-side (POS_TERMINAL_CART_CONFLICT) --
    // exactly the fresh empty cart the hold above just created. Cancel it
    // first, the same real step a cashier would take before pulling the
    // held sale back up on this same terminal.
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/cancel")),
      page.getByRole("button", { name: /Cancel sale/i }).click(),
    ]);

    await page.getByRole("button", { name: /Held sales/i }).click();
    const heldSalesDialog = page.getByRole("dialog", { name: /Held sales/i });
    await expect(heldSalesDialog).toBeVisible();
    await expect(heldSalesDialog.getByText(/Walk-in.*1 item/)).toBeVisible();
    await expect(heldSalesDialog.getByText(world.storeName)).toBeVisible();

    const [resumeResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/resume")),
      heldSalesDialog.getByRole("button", { name: "Resume" }).click(),
    ]);
    const resumedCart = (await resumeResponse.json()).cart as { id: string; grand_total: string; lines: Array<{ description: string }> };
    expect(resumedCart.id).toBe(heldCartId);
    expect(resumedCart.grand_total).toBe("295.000000"); // repriced by the server, not restored from a client cache
    expect(resumedCart.lines).toHaveLength(1);
    expect(resumedCart.lines[0].description).toContain(world.itemName);

    // The dialog closes and the resumed cart's real contents render.
    await expect(heldSalesDialog).toBeHidden();
    await expect(page.getByText(world.itemName)).toBeVisible();
    await expect(page.getByText("INR 295.00").first()).toBeVisible();

    const cashTenderedInput = page.getByRole("textbox", { name: "Cash tendered" });
    await cashTenderedInput.click();
    await cashTenderedInput.press("Control+A");
    await cashTenderedInput.pressSequentially("500");
    await cashTenderedInput.blur();

    const [completeResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/complete")),
      page.getByRole("button", { name: /Complete cash sale/i }).click(),
    ]);
    expect(completeResponse.status()).toBe(201);
    const sale = (await completeResponse.json()).sale as { id: string; grand_total: string };
    expect(sale.grand_total).toBe("295.000000");
    await expect(page.getByText("Sale complete")).toBeVisible();

    const finalCartRow = await withPosDb((client) =>
      client.query(`SELECT status, completed_sale_id FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [world.organizationId, heldCartId]).then((r) => r.rows[0]),
    );
    expect(finalCartRow.status).toBe("completed");
    expect(finalCartRow.completed_sale_id).toBe(sale.id);
  } finally {
    await context.close();
  }
});
