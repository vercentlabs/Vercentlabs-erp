import { test, expect, type Browser } from "@playwright/test";

// Badges show the stored token in sentence case, so compare the whole text without regard to case.
const wholeText = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb, type PosWorld } from "./pos-fixtures";

// Transactions workspace journeys: a cashier rings a real cash sale, a
// separate pos_manager session finds it in /pos/transactions by receipt
// number, drills into the detail, and every reference on that page (receipt
// link, payment leg, stock movement, accounting status) is checked against
// the real Postgres rows -- not just trusted from the UI. A second test
// proves a user assigned only to a DIFFERENT store is denied that same
// transaction by direct URL, and that the denial is enforced server-side
// (403 from the API), not merely hidden in the UI.

type CompletedSale = { id: string; receiptNumber: string };

let completedSale: Promise<CompletedSale> | null = null;

function ensureCompletedSale(browser: Browser, world: PosWorld): Promise<CompletedSale> {
  if (!completedSale) completedSale = completeCashSale(browser, world);
  return completedSale;
}

async function completeCashSale(browser: Browser, world: PosWorld): Promise<CompletedSale> {
  await resetTerminalCarts(world.terminalId);
  const { context, page } = await openPersonaSession(browser, world.cashier);
  try {
    await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
      page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
    ]);
    await page.getByLabel("Search products").fill(world.itemCode);
    const productButton = page.getByRole("button", { name: new RegExp(world.itemName) });
    await expect(productButton).toBeVisible({ timeout: 30_000 });
    await productButton.click();
    await expect(page.getByText("INR 250.00 each")).toBeVisible({ timeout: 30_000 });

    // react-aria's NumberField only picks up a value through real keystrokes
    // (see pos-returns.spec.ts / pos-checkout.spec.ts).
    const cashTenderedInput = page.getByRole("textbox", { name: "Amount" });
    await cashTenderedInput.click();
    await cashTenderedInput.press("Control+A");
    await cashTenderedInput.pressSequentially("500");
    await cashTenderedInput.blur();

    const [completeResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/complete")),
      page.getByRole("button", { name: /Complete sale/i }).click(),
    ]);
    const sale = (await completeResponse.json()).sale as { id: string; receipt_number: string };
    await expect(page.getByText("Sale complete")).toBeVisible({ timeout: 30_000 });
    return { id: sale.id, receiptNumber: sale.receipt_number };
  } finally {
    await context.close();
  }
}

test.describe("POS transactions workspace", () => {
  test("a manager searches for a completed sale, opens its detail, and every reference matches real Postgres state", async ({ browser }) => {
    test.setTimeout(240_000);
    const world = await getPosWorld();
    const sale = await ensureCompletedSale(browser, world);

    const dbState = await withPosDb(async (client, organizationId) => {
      const saleRow = (
        await client.query(
          `SELECT status, grand_total, currency_code, accounting_posting_status, store_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`,
          [organizationId, sale.id],
        )
      ).rows[0];
      const payments = (
        await client.query(`SELECT payment_method, amount, status FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2`, [organizationId, sale.id])
      ).rows;
      const movements = (
        await client.query(
          `SELECT movement.movement_number, movement.movement_type
             FROM tenant.pos_sale_lines line
             JOIN tenant.stock_movements movement ON movement.organization_id=line.organization_id AND movement.id=line.stock_movement_id
            WHERE line.organization_id=$1 AND line.sale_id=$2`,
          [organizationId, sale.id],
        )
      ).rows;
      return { saleRow, payments, movements };
    });
    expect(dbState.saleRow.store_id).toBe(world.storeId);
    expect(dbState.payments.length).toBeGreaterThan(0);
    expect(dbState.movements.length).toBeGreaterThan(0);

    const { context, page } = await openPersonaSession(browser, world.manager);
    try {
      await page.goto("/pos/transactions", { waitUntil: "domcontentloaded" });

      const searchField = page.getByLabel("Search by receipt number");
      const [listResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes("/api/pos/sales?") && res.url().includes(`search=${encodeURIComponent(sale.receiptNumber)}`)),
        searchField.fill(sale.receiptNumber),
      ]);
      expect(listResponse.status()).toBe(200);
      const listBody = await listResponse.json();
      expect(listBody.rows.map((row: { id: string }) => row.id)).toContain(sale.id);
      expect(listBody.total).toBeGreaterThanOrEqual(1);

      const row = page.getByRole("row", { name: new RegExp(sale.receiptNumber) });
      await expect(row).toBeVisible();
      await expect(row.getByText(world.storeName)).toBeVisible();

      // Store filter narrows to the same sale; filtering to a different
      // store must exclude it (server-side, verified via the API response).
      const otherStoreResponse = await page.request.get(
        `/api/pos/sales?search=${encodeURIComponent(sale.receiptNumber)}&storeId=${world.secondStoreId}`,
      );
      expect(otherStoreResponse.status()).toBe(200);
      expect((await otherStoreResponse.json()).rows).toHaveLength(0);

      await row.click();
      await page.waitForURL(new RegExp(`/pos/transactions/${sale.id}$`));
      await expect(page.getByRole("heading", { name: sale.receiptNumber })).toBeVisible({ timeout: 30_000 });

      // Receipt link.
      await expect(page.getByRole("button", { name: "View receipt" })).toBeVisible();

      // Payment leg matches the persisted pos_payments row.
      const dbPayment = dbState.payments[0];
      const paymentsSection = page.locator("section", { has: page.getByRole("heading", { name: "Payments" }) });
      await expect(paymentsSection.getByText(wholeText(dbPayment.payment_method.replace("_", " ")))).toBeVisible();
      await expect(paymentsSection.getByText(`${dbState.saleRow.currency_code} ${Number(dbPayment.amount).toFixed(2)}`)).toBeVisible();
      await expect(paymentsSection.getByText(wholeText(dbPayment.status))).toBeVisible();

      // Stock movement reference matches the real stock_movements row.
      const stockSection = page.locator("section", { has: page.getByRole("heading", { name: "Stock movement" }) });
      await expect(stockSection.getByText(dbState.movements[0].movement_number)).toBeVisible();

      // Accounting posting status matches the persisted column.
      const accountingSection = page.locator("section", { has: page.getByRole("heading", { name: "Accounting posting" }) });
      await expect(accountingSection.getByText(wholeText(dbState.saleRow.accounting_posting_status.replace("_", " ")))).toBeVisible();

      // Grand total shown is the persisted one, not recomputed.
      await expect(page.getByText(`${dbState.saleRow.currency_code} ${Number(dbState.saleRow.grand_total).toFixed(2)}`).first()).toBeVisible();

      // Audit trail carries the sale-completed event.
      const auditSection = page.locator("section", { has: page.getByRole("heading", { name: "Audit trail" }) });
      const dbSaleCompletedEvents = await withPosDb((client, organizationId) =>
        client
          .query(`SELECT count(*)::int AS count FROM tenant.pos_events WHERE organization_id=$1 AND aggregate_id=$2 AND event_type='pos.sale.completed'`, [organizationId, sale.id])
          .then((r) => r.rows[0].count as number),
      );
      expect(dbSaleCompletedEvents).toBe(1);
      await expect(auditSection.getByText(/sale completed/)).toHaveCount(1);
    } finally {
      await context.close();
    }
  });

  test("a user assigned only to a different store is denied the transaction by direct URL, enforced server-side", async ({ browser }) => {
    test.setTimeout(240_000);
    const world = await getPosWorld();
    const sale = await ensureCompletedSale(browser, world);

    // The supervisor persona is granted access to supervisorStoreId only,
    // never world.storeId where this sale was rung.
    const { context, page } = await openPersonaSession(browser, world.supervisor);
    try {
      await page.goto("/pos", { waitUntil: "domcontentloaded" });

      const apiResponse = await page.request.get(`/api/pos/sales/${sale.id}`);
      const apiBody = await apiResponse.json();
      expect(apiResponse.status(), JSON.stringify(apiBody)).toBe(403);
      expect(apiBody.code).toBe("POS_STORE_ACCESS_DENIED");
      expect(JSON.stringify(apiBody)).not.toContain(sale.receiptNumber);

      // The list is row-filtered too: the sale never appears for this user.
      const listResponse = await page.request.get(`/api/pos/sales?search=${encodeURIComponent(sale.receiptNumber)}`);
      expect(listResponse.status()).toBe(200);
      expect((await listResponse.json()).rows).toHaveLength(0);

      // And the UI reflects the denial rather than an empty/blank page.
      await page.goto(`/pos/transactions/${sale.id}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("You don't have access to this transaction")).toBeVisible();
      await expect(page.getByText(sale.receiptNumber)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
