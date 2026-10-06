// The financial side of a return: a credit note for what came back after it
// was invoiced. Goods returned before they were invoiced need no credit note
// (they are simply not invoiced: a delivery-based invoice bills only what the
// customer kept). For each order line:
//   invoiced but returned = min(returned, invoiced − (delivered − returned))
// That quantity belongs to the returns received last (goods that came back
// after they were invoiced), most recent first; a return line's credit due is
// its share of it less what has already been credited for it.
// The credit note is made against the original invoice, at its prices,
// discounts and tax (never today's price list), as a draft: receiving a
// return never posts one. A credit note for a price concession is made from
// the invoice instead, and never counts as a return.
import { lockOrder } from "../orders/versions.js";
import { loadOrderLineProgress } from "../orders/progress.js";
import { requireUuid, text } from "../orders/constants.js";
import { createCreditNote } from "../credit-notes/records.js";
import { creditableLines } from "../credit-notes/build.js";
import { loadReturn, recordReturnEvent, requireReturnPermission } from "./access.js";
import { RETURN_PERMISSIONS, RETURN_STATUS, ReturnError, reasonLabel } from "./constants.js";

const EPSILON = 1e-6;
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

// What has been credited for each return line, and for each order line by all returns.
async function credited(client, organizationId, salesReturn) {
  return (await client.query(
    `SELECT credit.sales_return_line_id, line.sales_order_line_id, credit.sales_return_id, credit.quantity
       FROM tenant.sales_return_credits credit
       JOIN tenant.sales_return_lines line ON line.id = credit.sales_return_line_id
       JOIN tenant.accounting_customer_invoices credit_note ON credit_note.id = credit.credit_note_id AND credit_note.status NOT IN ('cancelled', 'reversed')
       JOIN tenant.sales_returns sales_return ON sales_return.id = credit.sales_return_id
      WHERE credit.organization_id = $1 AND sales_return.sales_order_id = $2`, [organizationId, salesReturn.sales_order_id])).rows;
}

// The return's credit position: per line, what is credited and what can still be credited.
export async function creditPosition(client, organizationId, salesReturn, lines) {
  if (salesReturn.status !== RETURN_STATUS.received)
    return { status: "not_applicable", label: "—", creditable: 0, lines: [] };
  const progress = new Map((await loadOrderLineProgress(client, organizationId, salesReturn.current_version_id)).map((line) => [line.lineId, line]));
  const credits = await credited(client, organizationId, salesReturn);
  // Every received return line of the order, most recently received first, takes its share of what was invoiced but returned.
  const received = (await client.query(
    `SELECT line.id, line.sales_order_line_id, line.quantity FROM tenant.sales_return_lines line
       JOIN tenant.sales_returns sales_return ON sales_return.id = line.sales_return_id AND sales_return.status = 'received'
      WHERE line.organization_id = $1 AND sales_return.sales_order_id = $2 ORDER BY sales_return.received_at DESC, line.id`, [organizationId, salesReturn.sales_order_id])).rows;
  const left = new Map([...progress].map(([lineId, state]) => [lineId, Math.max(0, Math.min(state.returned, state.invoiced - (state.delivered - state.returned)))]));
  const share = new Map();
  for (const line of received) {
    const take = round(Math.min(Number(line.quantity), left.get(line.sales_order_line_id) ?? 0));
    share.set(line.id, take);
    left.set(line.sales_order_line_id, round((left.get(line.sales_order_line_id) ?? 0) - take));
  }
  const result = lines.map((line) => {
    const done = round(credits.filter((credit) => credit.sales_return_line_id === line.id).reduce((total, credit) => total + Number(credit.quantity), 0));
    const creditable = round(Math.max(0, (share.get(line.id) ?? 0) - done));
    return { returnLineId: line.id, item: line.item_name_snapshot, quantity: line.quantity, invoiced: share.get(line.id) ?? 0, credited: done, creditable };
  });
  const creditable = round(result.reduce((total, line) => total + line.creditable, 0));
  const anyCredited = result.some((line) => line.credited > EPSILON);
  const status = creditable > EPSILON ? "awaiting" : anyCredited ? "credited" : "not_required";
  const label = { awaiting: "Awaiting credit note", credited: "Credit note created", not_required: "No credit needed (not invoiced)" }[status];
  return { status, label, creditable, lines: result };
}

// input: { idempotencyKey, reason?, lines?: [{ returnLineId, quantity }] } — without lines, everything that can be credited.
export async function createCreditNoteFromReturn(client, context, returnId, input = {}) {
  requireReturnPermission(context, RETURN_PERMISSIONS.creditNote, "You do not have permission to create credit notes from returns.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new ReturnError(400, "A request key is required to create a credit note.", "SALES_RETURN_VALIDATION");
  const seen = await loadReturn(client, context, returnId);
  await lockOrder(client, context, seen.sales_order_id);
  const salesReturn = await loadReturn(client, context, returnId, { lock: true });
  const previous = (await client.query(
    `SELECT metadata FROM tenant.sales_return_events WHERE organization_id = $1 AND sales_return_id = $2 AND event_type = 'sales_return.credit_note_created' AND metadata->>'idempotencyKey' = $3`,
    [context.organizationId, salesReturn.id, key])).rows[0];
  if (previous) return { creditNotes: previous.metadata.creditNotes ?? [], replayed: true };
  if (salesReturn.status !== RETURN_STATUS.received) throw new ReturnError(409, "Receive the return before crediting it.", "SALES_RETURN_NOT_RECEIVED");
  const lines = (await client.query(`SELECT * FROM tenant.sales_return_lines WHERE organization_id = $1 AND sales_return_id = $2 ORDER BY sequence`, [context.organizationId, salesReturn.id]))
    .rows.map((line) => ({ ...line, quantity: Number(line.quantity) }));
  const position = await creditPosition(client, context.organizationId, salesReturn, lines);
  const byId = new Map(position.lines.map((line) => [line.returnLineId, line]));
  const requested = Array.isArray(input.lines) && input.lines.length
    ? input.lines.map((entry) => ({ line: byId.get(requireUuid(entry.returnLineId, "Return line")), quantity: Number(entry.quantity) })).filter((entry) => entry.quantity !== 0)
    : position.lines.filter((line) => line.creditable > EPSILON).map((line) => ({ line, quantity: line.creditable }));
  if (!requested.length)
    throw new ReturnError(409, "Nothing on this return needs a credit note: what came back was not invoiced, or is already credited.", "SALES_RETURN_NOTHING_TO_CREDIT");
  for (const { line, quantity } of requested) {
    if (!line) throw new ReturnError(404, "That line is not on this return.", "SALES_RETURN_LINE_NOT_FOUND");
    if (!Number.isFinite(quantity) || quantity <= 0) throw new ReturnError(400, `${line.item}: enter the quantity to credit.`, "SALES_RETURN_VALIDATION");
    if (quantity > line.creditable + EPSILON)
      throw new ReturnError(409, `${line.item}: only ${line.creditable} of what came back was invoiced and is not yet credited.`, "SALES_RETURN_CREDIT_EXCEEDS");
  }
  // Each quantity is credited against the posted invoices that billed it: the one billing this delivery first, then the others, oldest first.
  const allocations = new Map();
  for (const { line, quantity } of requested) {
    const source = lines.find((entry) => entry.id === line.returnLineId);
    const candidates = (await client.query(
      `SELECT DISTINCT invoice.id, invoice.invoice_date, invoice.created_at, invoice.invoice_number, bool_or(invoiced.source_sales_delivery_line_id = $3) OVER (PARTITION BY invoice.id) AS same_delivery
         FROM tenant.accounting_customer_invoice_lines invoiced
         JOIN tenant.accounting_customer_invoices invoice ON invoice.id = invoiced.customer_invoice_id AND invoice.invoice_type = 'invoice'
              AND invoice.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')
        WHERE invoiced.organization_id = $1 AND invoiced.source_sales_order_line_id = $2
        ORDER BY same_delivery DESC, invoice.invoice_date, invoice.created_at, invoice.invoice_number`, [context.organizationId, source.sales_order_line_id, source.delivery_line_id])).rows;
    let left = quantity;
    for (const candidate of candidates) {
      if (left <= EPSILON) break;
      const invoiceLine = (await creditableLines(client, context.organizationId, candidate.id)).find((entry) => entry.source_sales_order_line_id === source.sales_order_line_id);
      const already = (allocations.get(candidate.id) ?? []).filter((entry) => entry.invoiceLineId === invoiceLine?.id).reduce((total, entry) => total + entry.quantity, 0);
      const take = round(Math.min(left, Math.max(0, (invoiceLine?.quantityLeft ?? 0) - (invoiceLine?.draftQuantity ?? 0) - already)));
      if (take <= EPSILON) continue;
      allocations.set(candidate.id, [...(allocations.get(candidate.id) ?? []), { invoiceLineId: invoiceLine.id, quantity: take, returnLineId: source.id }]);
      left = round(left - take);
    }
    if (left > EPSILON) throw new ReturnError(409, `${line.item}: the invoices that billed it have only ${round(quantity - left)} left to credit.`, "SALES_RETURN_CREDIT_EXCEEDS");
  }
  const reason = text(input.reason, 800) ?? reasonLabel(salesReturn.reason_code);
  // The credit-notes module checks the invoice side; the permission to credit from a return authorises it.
  const creditContext = { ...context, permissions: [...new Set([...(context.permissions ?? []), "sales.credit_note.create", "sales.credit_note.view_all"])] };
  const creditNotes = [];
  for (const [invoiceId, entries] of allocations) {
    const created = await createCreditNote(client, creditContext, invoiceId, {
      idempotencyKey: `${key}:${invoiceId}`, reasonCode: "sales_return", reasonNote: `Return ${salesReturn.return_number}: ${reason}`, internalNotes: text(input.internalNotes, 4000),
      lines: entries.map((entry) => ({ invoiceLineId: entry.invoiceLineId, creditType: "quantity", quantity: entry.quantity, salesReturnLineId: entry.returnLineId })),
    }, { salesReturn: { id: salesReturn.id, number: salesReturn.return_number } });
    for (const entry of entries)
      await client.query(
        `INSERT INTO tenant.sales_return_credits (organization_id, sales_return_id, sales_return_line_id, source_invoice_id, credit_note_id, quantity, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`, [context.organizationId, salesReturn.id, entry.returnLineId, invoiceId, created.creditNoteId, entry.quantity, context.userId ?? null]);
    creditNotes.push({ creditNoteId: created.creditNoteId, creditNoteNumber: created.creditNoteNumber, invoiceId });
  }
  await recordReturnEvent(client, context, salesReturn.id, "sales_return.credit_note_created", RETURN_STATUS.received, RETURN_STATUS.received, {
    idempotencyKey: key, creditNotes, lines: requested.map(({ line, quantity }) => ({ item: line.item, quantity })),
  });
  return { creditNotes, replayed: false };
}
