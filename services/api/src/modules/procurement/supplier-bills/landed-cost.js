// Landed cost (Procurement plan Phase 3): freight, loading or insurance a supplier (or a transporter) billed is shared over the goods it
// brought — goods receipt lines, by value or by quantity — and the part still in stock raises its value through the Stock bridge (a valuation
// restatement and a journal from the charge's account to Inventory). Only a posted bill's charge lines (lines not on an order, with no item)
// are allocated, each at most once for its amount; without Stock there is no stock value to raise.
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { appOn } from "../../../core/access/apps.js";
import { restateReceiptCost } from "../../stock/landed-cost.js";
import { poCan, requirePoPermission } from "../purchase-orders/access.js";
import { loadBill } from "./bills.js";
import { BILL_PERMISSIONS, dayOf, fail, isUuid } from "./constants.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const POSTED = ["posted", "partially_paid", "paid", "overdue", "disputed"];

async function chargeLines(client, organizationId, billId) {
  return (await client.query(
    `SELECT line.id, line.description, line.net_amount, line.expense_account_id,
            (SELECT COALESCE(sum(cost.amount), 0) FROM tenant.procurement_bill_landed_costs cost WHERE cost.organization_id = line.organization_id AND cost.vendor_bill_line_id = line.id) AS allocated
       FROM tenant.accounting_vendor_bill_lines line
      WHERE line.organization_id = $1 AND line.vendor_bill_id = $2 AND line.purchase_order_line_id IS NULL AND line.item_id IS NULL AND line.net_amount > 0
        AND COALESCE(line.product_snapshot->>'tcs', 'false') <> 'true' ORDER BY line.sequence`, [organizationId, billId])).rows;
}

// The goods a cost may be shared over: posted, not reversed receipts of the bill's order (else the supplier's in the last 90 days).
async function receiptLines(client, organizationId, bill) {
  return (await client.query(
    `SELECT line.id, line.goods_receipt_id, receipt.receipt_number, receipt.receipt_date, line.product_id, line.product_snapshot->>'name' AS product_name, line.accepted_quantity,
            line.held_quantity, line.base_quantity, order_line.unit_price, po.purchase_order_number,
            (line.accepted_quantity + line.held_quantity) * COALESCE(order_line.unit_price, 0) AS value
       FROM tenant.goods_receipt_lines line
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
       JOIN tenant.purchase_orders po ON po.organization_id = receipt.organization_id AND po.id = receipt.purchase_order_id
       LEFT JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.purchase_order_line_id
      WHERE line.organization_id = $1 AND receipt.status = 'posted' AND receipt.reversed_at IS NULL AND line.product_type = 'stock' AND (line.accepted_quantity + line.held_quantity) > 0
        AND (($2::uuid IS NOT NULL AND receipt.purchase_order_id = $2) OR ($2::uuid IS NULL AND receipt.supplier_id = $3 AND receipt.receipt_date >= $4::date - 90))
      ORDER BY receipt.receipt_date DESC, receipt.receipt_number, line.line_number LIMIT 200`,
    [organizationId, bill.source_purchase_order_id, bill.supplier_id, dayOf(bill.bill_date)])).rows;
}

// What can be allocated on a bill, and what was.
export async function getBillLandedCosts(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const stockOn = await appOn(client, context, "stock");
  const charges = await chargeLines(client, context.organizationId, bill.id);
  const receipts = stockOn && POSTED.includes(bill.status) ? await receiptLines(client, context.organizationId, bill) : [];
  const done = (await client.query(
    `SELECT cost.id, cost.vendor_bill_line_id, cost.basis, cost.amount, cost.stock_amount, cost.created_at, json_agg(json_build_object('receiptNumber', receipt.receipt_number,
            'product', line.product_snapshot->>'name', 'amount', allocation.amount, 'stockAmount', allocation.stock_amount) ORDER BY receipt.receipt_number) AS allocations
       FROM tenant.procurement_bill_landed_costs cost
       JOIN tenant.procurement_bill_landed_cost_allocations allocation ON allocation.organization_id = cost.organization_id AND allocation.landed_cost_id = cost.id
       JOIN tenant.goods_receipt_lines line ON line.organization_id = allocation.organization_id AND line.id = allocation.goods_receipt_line_id
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = line.organization_id AND receipt.id = line.goods_receipt_id
      WHERE cost.organization_id = $1 AND cost.vendor_bill_id = $2 GROUP BY cost.id ORDER BY cost.created_at`, [context.organizationId, bill.id])).rows;
  const can = stockOn && POSTED.includes(bill.status) && (poCan(context, BILL_PERMISSIONS.manage) || poCan(context, "stock.valuation.view"));
  return {
    available: can && receipts.length > 0 && charges.some((line) => decimal(line.net_amount) > decimal(line.allocated)),
    stockOn,
    charges: charges.map((line) => ({ id: line.id, description: line.description, amount: dec(line.net_amount), allocated: dec(line.allocated), left: dec(sub(decimal(line.net_amount), decimal(line.allocated))) })),
    receipts: receipts.map((line) => ({ id: line.id, goodsReceiptId: line.goods_receipt_id, receiptNumber: line.receipt_number, receiptDate: dayOf(line.receipt_date), productId: line.product_id,
      productName: line.product_name, quantity: dec(add(decimal(line.accepted_quantity), decimal(line.held_quantity))), value: dec(roundMoney(decimal(line.value), 2)),
      purchaseOrderNumber: line.purchase_order_number })),
    allocated: done.map((row) => ({ id: row.id, billLineId: row.vendor_bill_line_id, basis: row.basis, amount: dec(row.amount), stockAmount: dec(row.stock_amount), createdAt: row.created_at,
      allocations: row.allocations })),
  };
}

// allocateLandedCost. input: { billLineId, receiptLineIds: [...], basis: "value" | "quantity", amount? (default: what is left of the line) }
export async function allocateLandedCost(client, context, billId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.manage, "You do not have permission to allocate landed costs.");
  const bill = await loadBill(client, context, billId, { lock: true });
  if (!POSTED.includes(bill.status)) fail("Post the bill before sharing its charges over the goods.", "billId", "LANDED_COST_BILL_NOT_POSTED", 409);
  if (!(await appOn(client, context, "stock"))) fail("Landed cost raises stock value: it needs the Stock app.", "billId", "LANDED_COST_STOCK_OFF", 409);
  const charge = (await chargeLines(client, context.organizationId, bill.id)).find((line) => line.id === input.billLineId);
  if (!charge) fail("Choose a charge line of this bill (freight, loading, insurance).", "billLineId", "LANDED_COST_LINE_INVALID", 409);
  const left = sub(decimal(charge.net_amount), decimal(charge.allocated));
  if (left <= 0n) fail("This charge is already shared over the goods.", "billLineId", "LANDED_COST_ALREADY_ALLOCATED", 409);
  const amount = input.amount ? decimal(String(input.amount).trim()) : left;
  if (amount <= 0n || amount > left) fail(`Allocate at most ${dec(roundMoney(left, 2))} of this charge.`, "amount", "LANDED_COST_AMOUNT_INVALID", 409);
  const basis = input.basis === "quantity" ? "quantity" : "value";
  const wanted = Array.isArray(input.receiptLineIds) ? input.receiptLineIds.filter(isUuid) : [];
  const lines = (await receiptLines(client, context.organizationId, bill)).filter((line) => wanted.includes(line.id));
  if (!lines.length) fail("Choose the goods receipt lines the charge was for.", "receiptLineIds", "LANDED_COST_RECEIPTS_REQUIRED");
  const weightOf = (line) => (basis === "quantity" ? decimal(line.base_quantity ?? add(decimal(line.accepted_quantity), decimal(line.held_quantity))) : decimal(line.value));
  const weights = lines.map(weightOf);
  const total = weights.reduce((sum, weight) => add(sum, weight), 0n);
  if (total <= 0n) fail(basis === "value" ? "The chosen lines have no value: share the cost by quantity." : "The chosen lines have no quantity.", "basis", "LANDED_COST_BASIS_INVALID");
  const cost = (await client.query(
    `INSERT INTO tenant.procurement_bill_landed_costs (organization_id, vendor_bill_id, vendor_bill_line_id, basis, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [context.organizationId, bill.id, charge.id, basis, dec(roundMoney(amount, 2)), context.userId ?? null])).rows[0];
  let given = 0n;
  let stockTotal = 0n;
  let journalEntryId = null;
  for (const [index, line] of lines.entries()) {
    const part = index === lines.length - 1 ? sub(amount, given) : roundMoney(div(mul(amount, weights[index]), total), 2);
    given = add(given, part);
    const result = await restateReceiptCost(client, context, line.id, { amount: dec(part), creditAccountId: charge.expense_account_id,
      description: `Landed cost from ${bill.bill_number} on ${line.receipt_number}`, reference: bill.bill_number });
    stockTotal = add(stockTotal, decimal(result.stockAmount));
    journalEntryId ??= result.journalEntryId;
    await client.query(`INSERT INTO tenant.procurement_bill_landed_cost_allocations (organization_id, landed_cost_id, goods_receipt_line_id, amount, stock_amount) VALUES ($1, $2, $3, $4, $5)`,
      [context.organizationId, cost.id, line.id, dec(part), result.stockAmount]);
  }
  await client.query(`UPDATE tenant.procurement_bill_landed_costs SET stock_amount = $3, journal_entry_id = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, cost.id, dec(stockTotal), journalEntryId]);
  return { id: cost.id, amount: dec(roundMoney(amount, 2)), stockAmount: dec(stockTotal), issuedAmount: dec(sub(roundMoney(amount, 2), stockTotal)) };
}

