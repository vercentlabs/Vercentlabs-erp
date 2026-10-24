// The cheque register (Sales report Phase 2): post-dated cheques, deposit, clearance and bounce are daily work in Indian collections.
//   Received   entered (a cheque dated today or earlier has its receipt posted; a post-dated one waits, with no receipt)
//   Deposited  paid into the bank
//   Cleared    the bank paid it; a post-dated cheque's receipt is posted now, to the bills chosen then (else oldest first)
//   Bounced    the bank returned it: its receipt is reversed, so the bills are owed again, and a bounce charge can go on a draft debit note
//   Cancelled  a post-dated cheque given back before it was deposited
// Whoever records payments works the register.
import { reverseCustomerReceipt } from "../../accounting/receivables-ar/ar-commands.js";
import { createDebitNote } from "../debit-notes/index.js";
import { invoiceCan } from "../invoices/access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "../invoices/constants.js";
import { companyToday } from "../today.js";
import { recordCustomerPayment } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const CHEQUE_STATUSES = Object.freeze({ received: "In hand", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced", cancelled: "Given back" });
const finance = (context) => ({ organizationId: context.organizationId, userId: context.userId ?? null, roleSlugs: [],
  permissions: ["accounting.view", "accounting.receivables.manage", "accounting.receipts.manage"] });

function requireRecord(context) {
  if (!invoiceCan(context, INVOICE_PERMISSIONS.recordPayment) && !invoiceCan(context, "accounting.receipts.manage"))
    throw new InvoiceError(403, "You do not have permission to work the cheque register.", "PERMISSION_DENIED");
}

const view = (row, today) => ({
  id: row.id, partyId: row.party_id, customerName: row.customer_name, receiptId: row.receipt_id, receiptNumber: row.receipt_number ?? null,
  chequeNumber: row.cheque_number, chequeDate: row.cheque_date, draweeBank: row.drawee_bank, amount: Number(row.amount), currencyCode: String(row.currency_code).trim(),
  status: row.status, statusLabel: CHEQUE_STATUSES[row.status], postDated: !row.receipt_id && row.status !== "cancelled" && row.status !== "bounced",
  dueToDeposit: row.status === "received" && row.cheque_date <= today, depositedOn: row.deposited_on, clearedOn: row.cleared_on, bouncedOn: row.bounced_on,
  bounceReason: row.bounce_reason, bounceCharge: row.bounce_charge == null ? null : Number(row.bounce_charge), bounceDebitNoteId: row.bounce_debit_note_id,
  reference: row.reference, notes: row.notes, createdAt: row.created_at,
});

const SELECT = `
  SELECT cheque.*, cheque.cheque_date::text AS cheque_date, cheque.deposited_on::text AS deposited_on, cheque.cleared_on::text AS cleared_on, cheque.bounced_on::text AS bounced_on,
         party.display_name AS customer_name, receipt.receipt_number
    FROM tenant.sales_cheques cheque
    JOIN tenant.business_parties party ON party.organization_id = cheque.organization_id AND party.id = cheque.party_id
    LEFT JOIN tenant.accounting_customer_receipts receipt ON receipt.organization_id = cheque.organization_id AND receipt.id = cheque.receipt_id`;

// options: { view: "all" | "in_hand" | "post_dated" | "deposited" | "cleared" | "bounced", partyId?, search? }
export async function listCheques(client, context, options = {}) {
  requireRecord(context);
  const today = await companyToday(client);
  const values = [context.organizationId];
  const where = ["cheque.organization_id = $1"];
  const view_ = String(options.view ?? "all");
  if (view_ === "in_hand") where.push("cheque.status = 'received' AND cheque.receipt_id IS NOT NULL");
  else if (view_ === "post_dated") where.push("cheque.status IN ('received', 'deposited') AND cheque.receipt_id IS NULL");
  else if (["deposited", "cleared", "bounced", "cancelled"].includes(view_)) where.push(`cheque.status = '${view_}'`);
  if (UUID.test(String(options.partyId ?? ""))) { values.push(options.partyId); where.push(`cheque.party_id = $${values.length}`); }
  const search = String(options.search ?? "").trim();
  if (search) { values.push(`%${search}%`); where.push(`(cheque.cheque_number ILIKE $${values.length} OR party.display_name ILIKE $${values.length} OR cheque.drawee_bank ILIKE $${values.length})`); }
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY cheque.cheque_date, cheque.created_at LIMIT 500`, values)).rows;
  const totals = (await client.query(
    `SELECT count(*) FILTER (WHERE status = 'received' AND receipt_id IS NOT NULL)::int AS in_hand,
            count(*) FILTER (WHERE status IN ('received', 'deposited') AND receipt_id IS NULL)::int AS post_dated,
            count(*) FILTER (WHERE status = 'deposited')::int AS deposited,
            count(*) FILTER (WHERE status = 'received' AND cheque_date <= $2)::int AS due_to_deposit
       FROM tenant.sales_cheques WHERE organization_id = $1`, [context.organizationId, today])).rows[0];
  return { cheques: rows.map((row) => view(row, today)), counts: { inHand: totals.in_hand, postDated: totals.post_dated, deposited: totals.deposited, dueToDeposit: totals.due_to_deposit } };
}

async function lockCheques(client, context, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => UUID.test(String(id))))];
  if (!list.length) throw new InvoiceError(400, "Choose the cheques.", "SALES_CHEQUE_INVALID");
  if (list.length > 200) throw new InvoiceError(400, "Choose at most 200 cheques at a time.", "SALES_CHEQUE_INVALID");
  const rows = (await client.query(`SELECT *, cheque_date::text AS cheque_day FROM tenant.sales_cheques WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY cheque_date FOR UPDATE`,
    [context.organizationId, list])).rows;
  if (rows.length !== list.length) throw new InvoiceError(404, "A cheque was not found.", "SALES_CHEQUE_NOT_FOUND");
  return rows;
}

async function dateOr(client, value, label) {
  const today = await companyToday(client);
  const day = value ? String(value).slice(0, 10) : today;
  if (!DATE.test(day) || day > today) throw new InvoiceError(400, `Enter the date it was ${label} (not in the future).`, "SALES_CHEQUE_INVALID", { field: "date" });
  return day;
}

// input: { chequeIds, depositedOn? } — paid into the bank. A post-dated cheque cannot be deposited before its date.
export async function depositCheques(client, context, input = {}) {
  requireRecord(context);
  const day = await dateOr(client, input.depositedOn, "deposited");
  const results = [];
  for (const cheque of await lockCheques(client, context, input.chequeIds)) {
    if (cheque.status !== "received") { results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, error: `It is ${CHEQUE_STATUSES[cheque.status].toLowerCase()}.` }); continue; }
    if (cheque.cheque_day > day) { results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, error: `It is dated ${cheque.cheque_day}: deposit it on or after that day.` }); continue; }
    await client.query("UPDATE tenant.sales_cheques SET status = 'deposited', deposited_on = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
      [context.organizationId, cheque.id, day, context.userId ?? null]);
    results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, done: true });
  }
  return { results, done: results.filter((entry) => entry.done).length };
}

// input: { chequeIds, clearedOn? } — the bank paid it. A post-dated cheque's receipt is posted now (dated the clearing day).
export async function clearCheques(client, context, input = {}) {
  requireRecord(context);
  const day = await dateOr(client, input.clearedOn, "cleared");
  const results = [];
  for (const cheque of await lockCheques(client, context, input.chequeIds)) {
    if (!["received", "deposited"].includes(cheque.status)) { results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, error: `It is ${CHEQUE_STATUSES[cheque.status].toLowerCase()}.` }); continue; }
    if (cheque.cheque_day > day) { results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, error: `It is dated ${cheque.cheque_day}: it cannot clear before then.` }); continue; }
    await client.query("SAVEPOINT sales_cheque_clear");
    try {
      let receiptNumber = null;
      if (!cheque.receipt_id) {
        const posted = await recordCustomerPayment(client, context, {
          partyId: cheque.party_id, amount: Number(cheque.amount), receiptDate: day, paymentMethod: "cheque", chequeNumber: cheque.cheque_number, chequeDate: cheque.cheque_day,
          draweeBank: cheque.drawee_bank, currencyCode: String(cheque.currency_code).trim(), reference: cheque.reference, notes: cheque.notes,
          ...(Array.isArray(cheque.allocations) ? { allocations: cheque.allocations } : {}),
        }, { fromCheque: cheque.id });
        receiptNumber = posted.receiptNumber;
      }
      await client.query(
        `UPDATE tenant.sales_cheques SET status = 'cleared', cleared_on = $3, deposited_on = COALESCE(deposited_on, $3), updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, cheque.id, day, context.userId ?? null]);
      await client.query("RELEASE SAVEPOINT sales_cheque_clear");
      results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, done: true, ...(receiptNumber ? { receiptNumber } : {}) });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sales_cheque_clear");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ chequeId: cheque.id, chequeNumber: cheque.cheque_number, error: String(error.message) });
    }
  }
  return { results, done: results.filter((entry) => entry.done).length };
}

// input: { reason, bouncedOn?, charge? } — the bank returned it. Its receipt is reversed (the bills are owed again). A charge goes on a
// draft debit note against the first bill the cheque paid, for billing to check and finalise; without that permission it is only noted.
export async function bounceCheque(client, context, chequeId, input = {}) {
  requireRecord(context);
  const [cheque] = await lockCheques(client, context, [chequeId]);
  if (!["received", "deposited", "cleared"].includes(cheque.status)) throw new InvoiceError(409, `This cheque is ${CHEQUE_STATUSES[cheque.status].toLowerCase()}.`, "SALES_CHEQUE_STATE");
  const reason = String(input.reason ?? "").trim().slice(0, 500);
  if (reason.length < 3) throw new InvoiceError(400, "Say why the bank returned it (for example: funds insufficient).", "SALES_CHEQUE_INVALID", { field: "reason" });
  const day = await dateOr(client, input.bouncedOn, "returned");
  const charge = input.charge === undefined || input.charge === null || input.charge === "" ? null : Math.round(Number(input.charge) * 100) / 100;
  if (charge !== null && !(charge > 0)) throw new InvoiceError(400, "Enter a charge above 0, or leave it empty.", "SALES_CHEQUE_INVALID", { field: "charge" });
  let paid = [];
  if (cheque.receipt_id) {
    paid = (await client.query(
      `SELECT allocation.customer_invoice_id FROM tenant.accounting_customer_receipt_allocations allocation
        WHERE allocation.organization_id = $1 AND allocation.receipt_id = $2
          AND NOT EXISTS (SELECT 1 FROM tenant.accounting_customer_receipt_allocation_reversals undone WHERE undone.organization_id = $1 AND undone.allocation_id = allocation.id)
        ORDER BY allocation.allocated_at`,
      [context.organizationId, cheque.receipt_id])).rows.map((row) => row.customer_invoice_id);
    try {
      await reverseCustomerReceipt(client, finance(context), cheque.receipt_id, { reason: `Cheque ${cheque.cheque_number} bounced: ${reason}`, accountingDate: day });
    } catch (error) {
      if (error?.name !== "AccountingError") throw error;
      throw new InvoiceError(error.status ?? 409, `The receipt could not be cancelled: ${error.message}`, error.code ?? "SALES_CHEQUE_REFUSED");
    }
  }
  let debitNote = null;
  let chargeNote = null;
  if (charge !== null) {
    const invoiceId = paid[0] ?? (await client.query(
      `SELECT id FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND party_id = $2 AND invoice_type = 'invoice' AND posted_at IS NOT NULL
         AND status NOT IN ('reversed', 'cancelled') ORDER BY invoice_date DESC LIMIT 1`, [context.organizationId, cheque.party_id])).rows[0]?.id;
    const line = invoiceId ? (await client.query("SELECT id FROM tenant.accounting_customer_invoice_lines WHERE organization_id = $1 AND customer_invoice_id = $2 ORDER BY sequence LIMIT 1",
      [context.organizationId, invoiceId])).rows[0] : null;
    if (!line) chargeNote = "No final invoice to raise the charge on: add it by hand.";
    else {
      await client.query("SAVEPOINT sales_cheque_charge");
      try {
        debitNote = await createDebitNote(client, context, invoiceId, {
          idempotencyKey: `cheque-bounce:${cheque.id}`, reasonCode: "other", reasonNote: `Cheque ${cheque.cheque_number} bounced (${reason}): bounce charge`, debitDate: day,
          lines: [{ invoiceLineId: line.id, amount: charge }],
        });
        await client.query("RELEASE SAVEPOINT sales_cheque_charge");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT sales_cheque_charge");
        if (!error?.status || error.status >= 500) throw error;
        chargeNote = `The charge was not raised: ${error.message}`;
      }
    }
  }
  await client.query(
    `UPDATE tenant.sales_cheques SET status = 'bounced', bounced_on = $3, bounce_reason = $4, bounce_charge = $5, bounce_debit_note_id = $6, updated_by = $7, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, cheque.id, day, reason, charge, debitNote?.debitNoteId ?? null, context.userId ?? null]);
  return { chequeId: cheque.id, receiptReversed: Boolean(cheque.receipt_id), debitNoteId: debitNote?.debitNoteId ?? null, debitNoteNumber: debitNote?.debitNoteNumber ?? null, chargeNote };
}

// A post-dated cheque given back before it was deposited: nothing was posted, so nothing is undone.
export async function cancelPostDatedCheque(client, context, chequeId, input = {}) {
  requireRecord(context);
  const [cheque] = await lockCheques(client, context, [chequeId]);
  if (cheque.receipt_id || cheque.status !== "received") throw new InvoiceError(409, "Only a post-dated cheque still in hand can be given back.", "SALES_CHEQUE_STATE");
  await client.query("UPDATE tenant.sales_cheques SET status = 'cancelled', notes = concat_ws(E'\\n', notes, $3::text), updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, cheque.id, String(input.reason ?? "").trim().slice(0, 500) || null, context.userId ?? null]);
  return { chequeId: cheque.id, cancelled: true };
}
