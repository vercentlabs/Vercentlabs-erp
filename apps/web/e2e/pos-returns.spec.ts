import { test, expect } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// Task journey #7: find a completed sale by receipt number, request a
// return, have a genuinely separate, higher-permission session approve and
// complete the refund, and verify stock is restored and the sale/return
// status updated -- checked directly in Postgres, not just trusted from
// the UI.
//
// pos_cashier holds pos.return.create but not pos.return.approve;
// pos_manager holds pos.return.approve. The backend also enforces
// requester !== approver independent of permissions (F268/F291 test
// suites), so this needs two real sessions regardless.

test("cashier finds a completed sale, requests a return, and a separate manager approves and completes the refund", async ({ browser }) => {
  const world = await getPosWorld();
  test.setTimeout(60_000);
  await resetTerminalCarts(world.terminalId);

  const cashierSession = await openPersonaSession(browser, world.cashier);
  let receiptNumber = "";
  let saleId = "";
  let returnId = "";
  let stockBefore = 0;
  try {
    await Promise.all([
      cashierSession.page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
      cashierSession.page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
    ]);

    await cashierSession.page.getByLabel("Search products").fill(world.itemCode);
    const productButton = cashierSession.page.getByRole("button", { name: new RegExp(world.itemName) });
    await expect(productButton).toBeVisible();
    await productButton.click();
    await expect(cashierSession.page.getByText("INR 250.00 each")).toBeVisible();

    const cashTenderedInput = cashierSession.page.getByRole("textbox", { name: "Cash tendered" });
    await cashTenderedInput.click();
    await cashTenderedInput.press("Control+A");
    await cashTenderedInput.pressSequentially("500");
    await cashTenderedInput.blur();

    const [completeResponse] = await Promise.all([
      cashierSession.page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/complete")),
      cashierSession.page.getByRole("button", { name: /Complete cash sale/i }).click(),
    ]);
    const sale = (await completeResponse.json()).sale as { id: string; receipt_number: string };
    receiptNumber = sale.receipt_number;
    saleId = sale.id;
    await expect(cashierSession.page.getByText("Sale complete")).toBeVisible();

    stockBefore = await withPosDb((client) =>
      client
        .query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, world.itemId, world.warehouseId])
        .then((r) => Number(r.rows[0].quantity)),
    );

    // Real UI journey: find the sale by receipt number and request a
    // return with restock.
    await cashierSession.page.goto("/pos/returns", { waitUntil: "domcontentloaded" });
    await cashierSession.page.getByRole("button", { name: "New return" }).click();
    await cashierSession.page.getByLabel("Receipt number").fill(receiptNumber);
    const [findResponse] = await Promise.all([
      cashierSession.page.waitForResponse((res) => res.url().includes("/api/pos/returns/find")),
      cashierSession.page.getByRole("button", { name: "Find sale" }).click(),
    ]);
    expect(findResponse.status()).toBe(200);
    await expect(cashierSession.page.getByText(`Receipt ${receiptNumber}`)).toBeVisible();

    // react-aria's NumberField renders role="textbox" (not "spinbutton")
    // and only picks up a value through real keystroke events -- see
    // pos-checkout.spec.ts's identical note for "Cash tendered".
    const quantityInput = cashierSession.page.getByRole("textbox", { name: /Quantity to return for/i });
    await quantityInput.click();
    await quantityInput.press("Control+A");
    await quantityInput.pressSequentially("1");
    await quantityInput.blur();
    // react-aria's Checkbox renders a visually-hidden native <input> under
    // a styled overlay -- .check()/.click() on the checkbox role itself
    // fails Playwright's visibility actionability check and hangs until
    // the test timeout. Clicking the visible label text triggers the
    // native label-for-input toggle instead.
    await cashierSession.page.getByText("Restock", { exact: true }).click();
    await expect(cashierSession.page.getByRole("checkbox", { name: "Restock" })).toBeChecked();
    await cashierSession.page.getByLabel("Reason").fill("E2E return journey -- customer changed their mind");

    const [createReturnResponse] = await Promise.all([
      cashierSession.page.waitForResponse((res) => res.url().endsWith("/api/pos/returns") && res.request().method() === "POST"),
      cashierSession.page.getByRole("button", { name: "Request return" }).click(),
    ]);
    const createdReturn = (await createReturnResponse.json()).posReturn as { id: string; status: string; refund_total: string };
    returnId = createdReturn.id;
    expect(createdReturn.status).toBe("pending_approval");
    expect(createdReturn.refund_total).toBe("295.000000"); // full line: 250 + 18% GST

    await expect(cashierSession.page.getByText("pending approval")).toBeVisible();
  } finally {
    await cashierSession.context.close();
  }

  // A genuinely separate, higher-permission session (pos_manager) approves
  // and completes the refund.
  const managerSession = await openPersonaSession(browser, world.manager);
  try {
    await managerSession.page.goto("/pos/returns", { waitUntil: "domcontentloaded" });
    await expect(managerSession.page.getByText("pending approval")).toBeVisible();

    const [approveResponse] = await Promise.all([
      managerSession.page.waitForResponse((res) => res.url().includes(`/api/pos/returns/${returnId}/approve`)),
      managerSession.page.getByRole("button", { name: "Approve" }).click(),
    ]);
    const approveBody = await approveResponse.json();
    expect(approveResponse.status(), JSON.stringify(approveBody)).toBe(200);
    expect(approveBody.posReturn.status).toBe("approved");
    await expect(managerSession.page.getByText("approved", { exact: true })).toBeVisible();

    const [completeReturnResponse] = await Promise.all([
      managerSession.page.waitForResponse((res) => res.url().includes(`/api/pos/returns/${returnId}/complete`)),
      managerSession.page.getByRole("button", { name: "Complete refund" }).click(),
    ]);
    const completeBody = await completeReturnResponse.json();
    expect(completeReturnResponse.status(), JSON.stringify(completeBody)).toBe(200);
    expect(completeBody.posReturn.status).toBe("completed");
    await expect(managerSession.page.getByText("completed", { exact: true })).toBeVisible();

    // Real Postgres facts: return completed, stock restored, sale status
    // reflects the return.
    const returnRow = await withPosDb((client) =>
      client.query(`SELECT status, refund_total FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2`, [world.organizationId, returnId]).then((r) => r.rows[0]),
    );
    expect(returnRow.status).toBe("completed");

    const stockAfter = await withPosDb((client) =>
      client
        .query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, world.itemId, world.warehouseId])
        .then((r) => Number(r.rows[0].quantity)),
    );
    expect(stockAfter - stockBefore, "the returned unit must be restocked (return was created with restock=true)").toBe(1);
    expect(completeBody.posReturn.saleStatus).toBeTruthy();

    const saleRow = await withPosDb((client) =>
      client.query(`SELECT status FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [world.organizationId, saleId]).then((r) => r.rows[0]),
    );
    expect(saleRow.status).toBe(completeBody.posReturn.saleStatus);
  } finally {
    await managerSession.context.close();
  }
});
