import { test, expect, type Page } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// Core cashier checkout journey (task journey #2): open shift already
// exists (seeded by pos-fixtures.ts), search a real product, add it to the
// cart, select a real customer through the search-select (never a typed
// UUID), tender cash, complete the sale, and verify BOTH the receipt UI
// AND real Postgres rows (tenant.pos_sales, tenant.stock_balances). Run
// once at a desktop viewport and once at a tablet viewport, since
// PosCheckoutScreen's layout genuinely changes at the `lg:` breakpoint
// (side-by-side cart+summary vs. stacked).
//
// The item price (250.0000) and its single 18% "gst" tax rate are seeded
// deterministically in pos-fixtures.ts, and the store's walk-in tax
// resolution (no customer address on file) always treats it as intra-state
// (seller state === buyer state) -- so for a quantity of 2, the expected
// totals are exact, not just "greater than zero": subtotal 500.00, tax
// 90.00 (2x CGST 9% + SGST 9%), grand total 590.00.

// Real test bug found and fixed (POS Completion Program Prompt 2): Chrome
// itself auto-logs "Failed to load resource: the server responded with a
// status of 404" as a console error for ANY fetch/XHR that gets a 4xx
// response -- regardless of whether application code correctly treats
// that status as an expected, non-error outcome. The receipt screen's
// own invoice-existence check (getPosSaleInvoice, PosReceiptScreen.tsx)
// deliberately probes for an invoice that may not exist yet and treats a
// 404 there as "no invoice generated yet," not a failure -- its own code
// comment says so explicitly. That legitimate 404 was unconditionally
// failing this assertion. The `response` listener below already
// independently catches genuine server errors (>= 500); this filter just
// stops Chrome's own routine 4xx logging noise from masquerading as one.
async function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource: the server responded with a status of 404/.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) errors.push(`${res.status()} on ${res.url()}`);
  });
  return errors;
}

function runCoreCheckoutJourney(label: string, viewport: { width: number; height: number }) {
  test.describe(`POS checkout (${label})`, () => {
    test(`cashier completes a cash sale with a real search-selected customer (${label})`, async ({ browser }) => {
      const world = await getPosWorld();
      await resetTerminalCarts(world.terminalId);

      const { context, page } = await openPersonaSession(browser, world.cashier, { viewport });
      const errors = await collectPageErrors(page);
      try {
        const stockBefore = await withPosDb((client) =>
          client
            .query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, world.itemId, world.warehouseId])
            .then((r) => Number(r.rows[0].quantity)),
        );

        await page.goto("/pos/checkout", { waitUntil: "domcontentloaded" });
        // The screen auto-creates a cart on mount (POST /api/pos/carts) --
        // wait for that real response instead of an arbitrary sleep before
        // interacting with anything cart-shaped.
        await page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST");

        await page.getByLabel("Search products").fill(world.itemCode);
        const productButton = page.getByRole("button", { name: new RegExp(world.itemName) });
        await expect(productButton).toBeVisible();
        await productButton.click();
        // Line lands in the cart with unit price visible -- the real,
        // server-priced line, not an optimistic client guess.
        await expect(page.getByText("INR 250.00 each")).toBeVisible();

        // Bump quantity 1 -> 2 via the line's own +/- control (deterministic
        // regardless of whether re-adding the same item merges lines).
        // Waited for via the resulting subtotal (the server's own repriced
        // total), not a raw network intercept -- the button is momentarily
        // disabled while the PATCH is in flight (isLoading via `loading`
        // state), so polling for the new total is the real signal here.
        await page.getByRole("button", { name: "Increase quantity" }).click();
        await expect(page.getByText("INR 500.00")).toBeVisible({ timeout: 10_000 }); // subtotal reflects qty=2 (2 x 250)

        // Real customer search-select -- never a typed/pasted UUID. Two
        // elements share this accessible name (the combobox input itself
        // and its "show suggestions" toggle button) -- getByRole scopes to
        // the actual textbox.
        const customerInput = page.getByRole("combobox", { name: /Customer \(blank/i });
        await customerInput.fill(world.customerPhone.slice(-6));
        const customerOption = page.getByRole("option", { name: new RegExp(world.customerName) });
        await expect(customerOption).toBeVisible({ timeout: 10_000 });
        await customerOption.click();
        await expect(page.getByText(world.customerName)).toBeVisible();

        // react-aria's NumberField parses its formatted textValue on real
        // keystroke events, not on a raw DOM value assignment -- `.fill()`
        // leaves its internal numeric state at 0 (the button stays
        // disabled below tender-than-total). pressSequentially fires a
        // genuine keydown/input per character, which the field's own
        // Intl.NumberFormat-backed parser picks up.
        const cashTenderedInput = page.getByRole("textbox", { name: "Amount" });
        await cashTenderedInput.click();
        await cashTenderedInput.press("Control+A");
        await cashTenderedInput.pressSequentially("1000");
        await cashTenderedInput.blur();
        const completeButton = page.getByRole("button", { name: /Complete sale/i });
        await expect(completeButton).toBeEnabled();

        const [completeResponse] = await Promise.all([
          page.waitForResponse((res) => res.url().includes("/api/pos/carts/") && res.url().endsWith("/complete")),
          completeButton.click(),
        ]);
        const completeBody = await completeResponse.json();
        expect(completeResponse.status(), JSON.stringify(completeBody)).toBe(201);
        const sale = completeBody.sale as { id: string; receipt_number: string; grand_total: string; change_total: string };
        expect(sale.grand_total).toBe("590.000000");
        expect(sale.change_total).toBe("410.000000");

        await expect(page.getByText("Sale complete")).toBeVisible();
        await expect(page.getByRole("heading", { name: new RegExp(sale.receipt_number) })).toBeVisible();

        await page.getByRole("button", { name: /View \/ print receipt/i }).click();
        await expect(page).toHaveURL(new RegExp(`/pos/receipts/${sale.id}$`));
        await expect(page.getByText(`Receipt ${sale.receipt_number}`)).toBeVisible({ timeout: 10_000 });
        // F289 gap closure: Original/Reprint is now server-derived from
        // tenant.pos_receipt_print_events, not a `?original=1` URL param --
        // before any print action, the badge is neutral ("Not yet
        // printed"). Clicking Print records a real print event and flips
        // the badge to "Printed — original" (verified against real
        // Postgres, not just the UI's own claim).
        await expect(page.getByText("Not yet printed", { exact: true })).toBeVisible();
        await expect(page.getByText(world.itemName)).toBeVisible();

        await page.getByRole("button", { name: /^Print$/i }).click();
        await expect(page.getByText("Printed — original", { exact: true })).toBeVisible({ timeout: 10_000 });
        const printEventRow = await withPosDb((client) =>
          client
            .query(`SELECT print_type, requested_by FROM tenant.pos_receipt_print_events WHERE organization_id=$1 AND company_id=$2 AND sale_id=$3`, [
              world.organizationId,
              world.companyId,
              sale.id,
            ])
            .then((r) => r.rows[0]),
        );
        expect(printEventRow).toBeTruthy();
        expect(printEventRow.print_type).toBe("original");

        // Real Postgres facts, not just UI trust.
        const saleRow = await withPosDb((client) =>
          client
            .query(`SELECT status, grand_total, store_id, terminal_id, customer_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`, [world.organizationId, sale.id])
            .then((r) => r.rows[0]),
        );
        expect(saleRow).toBeTruthy();
        expect(saleRow.status).toBe("completed");
        expect(saleRow.grand_total).toBe("590.000000");
        expect(saleRow.store_id).toBe(world.storeId);
        expect(saleRow.customer_id).toBe(world.customerId);

        const stockAfter = await withPosDb((client) =>
          client
            .query(`SELECT quantity FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [world.organizationId, world.itemId, world.warehouseId])
            .then((r) => Number(r.rows[0].quantity)),
        );
        expect(stockBefore - stockAfter).toBe(2);

        expect(errors, `unexpected console/page errors or 5xx responses: ${errors.join(" | ")}`).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });
}

runCoreCheckoutJourney("desktop", { width: 1440, height: 900 });
runCoreCheckoutJourney("tablet", { width: 820, height: 1180 });
