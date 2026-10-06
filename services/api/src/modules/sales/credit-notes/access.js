// Who may see and act on credit notes. A credit note is seen by whoever can
// see its sales order (own / team / all), or by anyone allowed to see every
// credit note (Finance). How it was applied, and its journal, are shown only
// to those allowed to see them.
import { orderCan, orderScopeSql } from "../orders/access.js";
import { requireUuid } from "../orders/constants.js";
import { CREDIT_NOTE_PERMISSIONS, CreditNoteError } from "./constants.js";

export const creditNoteCan = orderCan;

export function requireCreditNotePermission(context, permission, message = "You do not have permission to do this.") {
  if (!creditNoteCan(context, permission)) throw new CreditNoteError(403, message, "PERMISSION_DENIED");
}

export function requireCreditNoteAccess(context) {
  if (!creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.view) && !creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.viewAll))
    throw new CreditNoteError(403, "You do not have permission to view credit notes.", "PERMISSION_DENIED");
}

// " AND (…)" limiting `alias` (a sales_orders alias) to what the caller may see; "" with view-all.
export function creditNoteScopeSql(context, values, alias = "sales_order") {
  if (creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.viewAll)) return "";
  return orderScopeSql(context, values, alias);
}

// The credit note (Finance's row with its Sales record and the source invoice), after checking the caller may see it; locked for a change when asked.
export async function loadCreditNote(client, context, creditNoteId, { lock = false } = {}) {
  requireCreditNoteAccess(context);
  const values = [context.organizationId, requireUuid(creditNoteId, "Credit note")];
  const scope = creditNoteScopeSql(context, values, "sales_order");
  const { rows } = await client.query(
    `SELECT credit.*, btrim(credit.currency_code) AS currency_code, note.source_invoice_id, note.sales_order_id, note.sales_return_id, note.reason_code, note.reason_note,
            note.customer_snapshot AS sales_customer_snapshot, note.contact_snapshot, note.seller_registration_id, note.seller_snapshot, note.place_of_supply_name, note.supply_nature,
            note.customer_po_number, note.customer_notes, note.internal_notes, note.version, note.sent_at, note.sent_by, note.sent_to, note.sent_channel, note.reversed_at,
            note.reversed_by, note.reversal_reason, note.reversal_journal_entry_id, note.idempotency_key, note.created_by AS sales_created_by,
            source.invoice_number AS source_invoice_number, source.invoice_date AS source_invoice_date, source.status AS source_status, source.grand_total AS source_grand_total,
            source.outstanding_amount AS source_outstanding, sales_order.sales_order_number, sales_order.owner_user_id, sales_return.return_number
       FROM tenant.sales_credit_notes note
       JOIN tenant.accounting_customer_invoices credit ON credit.organization_id = note.organization_id AND credit.id = note.customer_invoice_id
       JOIN tenant.accounting_customer_invoices source ON source.organization_id = note.organization_id AND source.id = note.source_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = note.organization_id AND sales_order.id = note.sales_order_id
       LEFT JOIN tenant.sales_returns sales_return ON sales_return.id = note.sales_return_id
      WHERE note.organization_id = $1 AND note.customer_invoice_id = $2${scope}${lock ? " FOR UPDATE OF note, credit" : ""}`, values);
  if (!rows[0]) throw new CreditNoteError(404, "Credit note not found.", "SALES_CREDIT_NOTE_NOT_FOUND");
  return rows[0];
}

export async function recordCreditNoteEvent(client, context, creditNoteId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.sales_credit_note_events (organization_id, customer_invoice_id, event_type, from_status, to_status, metadata, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [context.organizationId, creditNoteId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}

// Finance acts on Sales' behalf: the Sales permission checked here authorises it.
export const financeContext = (context) => ({
  organizationId: context.organizationId, userId: context.userId ?? null,
  permissions: ["accounting.view", "accounting.receivables.manage", "accounting.receipts.manage"], roleSlugs: [],
});
export function financeError(error, fallback) {
  if (error?.name !== "AccountingError") return error;
  return new CreditNoteError(error.status ?? 409, `${fallback}: ${error.message}`, error.code ?? "SALES_CREDIT_NOTE_FINANCE_REFUSED");
}
