// What happens to a posted vendor credit: applied to the supplier's open bills, or refunded by the supplier — both through Finance, never more
// than the credit has left. Unapplied / partially applied / fully settled is derived from what Finance recorded.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal } from "../../../core/decimal.js";
import { applyVendorCreditNote, recordVendorCreditRefund, reverseVendorCreditRefund, unapplyVendorCreditNote } from "../../accounting/index.js";
import { recordPoEvent } from "../purchase-orders/persist.js";
import { recordClaimEvent } from "./claims.js";
import { finance, loadCredit } from "./credits.js";
import { POSTED_SQL, POSTED_STATUSES, VC_PERMISSIONS, VendorCreditError, dayOf, dec, fail, readAmount, requireAny, requireCreditView, requireUuid, settlementStatus, settling, text } from "./constants.js";

const requireSettle = (context) => requireAny(context, [VC_PERMISSIONS.payments], "You do not have permission to apply or refund vendor credits.");

// getVendorCreditAvailableBalance: what the credit still has to apply or refund.
export async function getVendorCreditAvailableBalance(client, context, creditId) {
  const credit = await loadCredit(client, context, creditId);
  const posted = POSTED_STATUSES.includes(credit.status);
  return { id: credit.id, creditNumber: credit.bill_number, currencyCode: credit.currency_code.trim(), total: dec(credit.grand_total),
    available: dec(posted ? credit.outstanding_amount : 0n), settlementStatus: settlementStatus(credit) };
}

// allocateVendorCreditToBills: the credit applied to open bills of the same supplier, company and currency — never more than the credit has
// left or a bill still owes. The same idempotency key applies once. input: { allocations: [{ billId, amount }], idempotencyKey? }
export async function allocateVendorCreditToBills(client, context, creditId, input = {}) {
  requireSettle(context);
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.vendor_credit.allocate", key: text(input.idempotencyKey, 200), payload: { creditId, allocations: input.allocations },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const credit = await loadCredit(client, context, creditId, { lock: true });
  if (!POSTED_STATUSES.includes(credit.status)) throw new VendorCreditError(409, "Only a posted vendor credit is applied to bills.", "VENDOR_CREDIT_NOT_POSTED");
  if (!Array.isArray(input.allocations) || !input.allocations.length) fail("Choose the bills to apply the credit to.", "allocations", "VENDOR_CREDIT_NO_ALLOCATIONS");
  let total = 0n;
  const allocations = [];
  const seen = new Set();
  for (const [index, entry] of input.allocations.entries()) {
    const billId = requireUuid(entry.billId, "Supplier bill");
    if (seen.has(billId)) fail("Each bill once per allocation.", `allocations.${index}.billId`);
    seen.add(billId);
    const bill = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [context.organizationId, billId])).rows[0];
    if (!bill || bill.bill_type !== "bill") throw new VendorCreditError(404, "Supplier bill not found.", "SUPPLIER_BILL_NOT_FOUND");
    if (bill.party_id !== credit.party_id) fail(`${bill.bill_number} is another supplier's bill.`, `allocations.${index}.billId`, "VENDOR_CREDIT_SUPPLIER_MISMATCH", 409);
    if (bill.currency_code !== credit.currency_code) fail(`${bill.bill_number} is in ${bill.currency_code.trim()}.`, `allocations.${index}.billId`, "VENDOR_CREDIT_CURRENCY_MISMATCH", 409);
    if (credit.buying_registration_id && bill.buying_registration_id && credit.buying_registration_id !== bill.buying_registration_id)
      fail(`${bill.bill_number} was billed to another company registration (GSTIN).`, `allocations.${index}.billId`, "VENDOR_CREDIT_COMPANY_MISMATCH", 409);
    if (!["posted", "partially_paid", "overdue", "disputed"].includes(bill.status) || decimal(bill.outstanding_amount) <= 0n)
      fail(`${bill.bill_number} has nothing left to pay.`, `allocations.${index}.billId`, "VENDOR_CREDIT_BILL_NOT_OPEN", 409);
    const amount = readAmount(entry.amount, `Amount for ${bill.bill_number}`, `allocations.${index}.amount`);
    if (amount > decimal(bill.outstanding_amount))
      throw new VendorCreditError(409, `${bill.bill_number} owes ${dec(bill.outstanding_amount)}.`, "VENDOR_CREDIT_OVER_ALLOCATION", { field: `allocations.${index}.amount` });
    total = add(total, amount);
    allocations.push({ billId, amount: dec(amount), bill });
  }
  if (total > decimal(credit.outstanding_amount))
    throw new VendorCreditError(409, `Only ${dec(credit.outstanding_amount)} of the credit is left to apply.`, "VENDOR_CREDIT_OVER_ALLOCATION", { field: "allocations" });
  await finance(() => applyVendorCreditNote(client, settling(context), credit.id, { allocations: allocations.map(({ billId, amount }) => ({ billId, amount })) }));
  for (const allocation of allocations)
    if (allocation.bill.source_purchase_order_id)
      await recordPoEvent(client, context, allocation.bill.source_purchase_order_id, "purchase_order.credit_applied", `Vendor credit ${credit.bill_number} applied to ${allocation.bill.bill_number}: ${allocation.amount}`,
        { details: { creditId: credit.id, billId: allocation.billId } });
  if (credit.debit_claim_id) await recordClaimEvent(client, context, credit.debit_claim_id, "claim.credit_applied", `Vendor credit ${credit.bill_number} applied to bills: ${dec(total)}`);
  const after = await loadCredit(client, context, credit.id);
  const response = { id: credit.id, applied: dec(total), available: dec(after.outstanding_amount), settlementStatus: settlementStatus(after), replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "vendor_bill", aggregateId: credit.id });
  return response;
}

// unapplyVendorCredit: the credit taken off a bill (or all bills) it was applied to. input: { billId?, reason }
export async function unapplyVendorCredit(client, context, creditId, input = {}) {
  requireSettle(context);
  const credit = await loadCredit(client, context, creditId, { lock: true });
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) fail("Give the reason.", "reason", "VENDOR_CREDIT_REASON_REQUIRED");
  const result = await finance(() => unapplyVendorCreditNote(client, settling(context), credit.id, { billId: input.billId || undefined, reason }));
  if (decimal(result.unapplied) <= 0n) throw new VendorCreditError(409, "The credit is not applied to that bill.", "VENDOR_CREDIT_NOT_APPLIED");
  return { id: credit.id, unapplied: dec(result.unapplied) };
}

// recordSupplierRefund: money the supplier paid back against the credit (Dr bank, Cr payable). input: { amount, refundDate?, bankAccountId?, reference, idempotencyKey? }
export async function recordSupplierRefund(client, context, creditId, input = {}) {
  requireSettle(context);
  const credit = await loadCredit(client, context, creditId);
  if (!POSTED_STATUSES.includes(credit.status)) throw new VendorCreditError(409, "Only a posted vendor credit is refunded.", "VENDOR_CREDIT_NOT_POSTED");
  const result = await finance(() => recordVendorCreditRefund(client, settling(context), credit.id, input));
  if (credit.debit_claim_id && !result.replayed)
    await recordClaimEvent(client, context, credit.debit_claim_id, "claim.refund_received", `Supplier refund ${result.refund.refund_number} of ${dec(result.refund.amount)} against ${credit.bill_number}`);
  return { id: result.refund.id, refundNumber: result.refund.refund_number, amount: dec(result.refund.amount), replayed: result.replayed };
}

// reverseSupplierRefund. input: { reason }
export async function reverseSupplierRefund(client, context, refundId, input = {}) {
  requireSettle(context);
  const result = await finance(() => reverseVendorCreditRefund(client, settling(context), refundId, input));
  return { id: result.refund.id, status: "reversed", replayed: result.replayed };
}

// getVendorCreditAllocations: the bills the credit was applied to.
export async function getVendorCreditAllocations(client, context, creditId) {
  const credit = await loadCredit(client, context, creditId);
  const { rows } = await client.query(
    `SELECT allocation.vendor_bill_id, allocation.allocated_amount, allocation.allocated_at, bill.bill_number, bill.supplier_invoice_reference, bill.outstanding_amount, bill.status
       FROM tenant.accounting_vendor_credit_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
      WHERE allocation.organization_id = $1 AND allocation.credit_note_id = $2 ORDER BY allocation.allocated_at`, [context.organizationId, credit.id]);
  return rows.map((row) => ({ billId: row.vendor_bill_id, billNumber: row.bill_number, supplierInvoice: row.supplier_invoice_reference, amount: dec(row.allocated_amount),
    billOutstanding: dec(row.outstanding_amount), at: row.allocated_at, href: `/procurement/supplier-bills/${row.vendor_bill_id}` }));
}

// getVendorCreditRefunds: what the supplier paid back against the credit.
export async function getVendorCreditRefunds(client, context, creditId) {
  const credit = await loadCredit(client, context, creditId);
  const { rows } = await client.query(
    `SELECT refund.*, bank.account_name AS bank_name FROM tenant.accounting_vendor_credit_refunds refund
       LEFT JOIN tenant.accounting_bank_accounts bank ON bank.organization_id = refund.organization_id AND bank.id = refund.bank_account_id
      WHERE refund.organization_id = $1 AND refund.credit_note_id = $2 ORDER BY refund.created_at`, [context.organizationId, credit.id]);
  return rows.map((row) => ({ id: row.id, refundNumber: row.refund_number, amount: dec(row.amount), date: dayOf(row.refund_date), bankAccountId: row.bank_account_id, bankName: row.bank_name,
    reference: row.reference, status: row.status, journalEntryId: row.journal_entry_id, reversedAt: row.reversed_at, reversalReason: row.reversal_reason }));
}

// getSupplierCreditBalance: the supplier's posted credits not yet applied or refunded, per currency.
export async function getSupplierCreditBalance(client, context, supplierId) {
  requireCreditView(context);
  const { rows } = await client.query(
    `SELECT currency_code, count(*)::int AS credits, sum(outstanding_amount) AS available FROM tenant.accounting_vendor_bills
      WHERE organization_id = $1 AND supplier_id = $2 AND bill_type = 'credit_note' AND status IN ${POSTED_SQL} AND outstanding_amount > 0 GROUP BY currency_code ORDER BY currency_code`,
    [context.organizationId, requireUuid(supplierId, "Supplier")]);
  return { supplierId, balances: rows.map((row) => ({ currencyCode: row.currency_code.trim(), credits: row.credits, available: dec(row.available) })) };
}
