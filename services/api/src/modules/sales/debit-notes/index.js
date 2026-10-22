// Debit notes to customers (Sales plan, Phase 2): an undercharge, a rate difference or a missed charge billed after a posted invoice.
// It is Finance's customer debit note (accounting/receivables.js, invoice_type 'debit_note', numbered in the GSTIN's debit note series):
// each line adds a taxable amount to one line of the invoice, taxed at that line's own GST components, so place of supply and rates
// follow the original supply. Draft → Posted (the customer owes more: receivable, revenue and output tax entered) or a draft
// Cancelled. Whoever may raise and post credit notes raises and posts debit notes: they are the two halves of correcting an invoice.
import { cancelCustomerInvoiceDraft, createCustomerInvoice, postCustomerInvoice } from "../../accounting/receivables.js";
import { submitSubledgerDocument } from "../../accounting/subledger-approvals.js";
import { dayOf, requireUuid, text } from "../orders/constants.js";
import { companyToday } from "../today.js";
import { creditNoteScopeSql, financeContext, financeError, requireCreditNoteAccess, requireCreditNotePermission } from "../credit-notes/access.js";
import { buildCreditLines, creditableLines } from "../credit-notes/build.js";
import { CREDIT_NOTE_PERMISSIONS, CreditNoteError, FINANCE_DRAFT, FINANCE_POSTED } from "../credit-notes/constants.js";
import { loadSourceInvoice } from "../credit-notes/records.js";

export const DEBIT_REASONS = Object.freeze([
  { code: "rate_difference", label: "Rate difference" },
  { code: "undercharge", label: "Undercharged on the invoice" },
  { code: "additional_charge", label: "Additional charge (freight, packing…)" },
  { code: "tax_correction", label: "Tax correction" },
  { code: "other", label: "Other" },
]);
const reasonLabel = (code) => DEBIT_REASONS.find((entry) => entry.code === code)?.label ?? code;
const statusOf = (financeStatus) => (FINANCE_DRAFT.includes(financeStatus) ? "draft" : FINANCE_POSTED.includes(financeStatus) ? "posted" : financeStatus === "reversed" ? "reversed" : "cancelled");
const money = (value) => Math.round(Number(value) * 100) / 100;

const SELECT = `
  SELECT debit.*, btrim(debit.currency_code) AS currency_code, note.source_invoice_id, note.sales_order_id, note.reason_code, note.reason_note, note.customer_snapshot AS sales_customer_snapshot,
         note.seller_registration_id, note.seller_snapshot, note.place_of_supply_name, note.supply_nature, note.sent_at, note.sent_channel, note.idempotency_key,
         source.invoice_number AS source_invoice_number, source.invoice_date AS source_invoice_date, sales_order.sales_order_number, sales_order.owner_user_id
    FROM tenant.sales_debit_notes note
    JOIN tenant.accounting_customer_invoices debit ON debit.organization_id = note.organization_id AND debit.id = note.customer_invoice_id
    JOIN tenant.accounting_customer_invoices source ON source.organization_id = note.organization_id AND source.id = note.source_invoice_id
    LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = note.organization_id AND sales_order.id = note.sales_order_id`;

export async function loadDebitNote(client, context, debitNoteId, { lock = false } = {}) {
  requireCreditNoteAccess(context);
  const values = [context.organizationId, requireUuid(debitNoteId, "Debit note")];
  const scope = creditNoteScopeSql(context, values, "sales_order");
  const row = (await client.query(`${SELECT} WHERE note.organization_id = $1 AND note.customer_invoice_id = $2${scope}${lock ? " FOR UPDATE OF note, debit" : ""}`, values)).rows[0];
  if (!row) throw new CreditNoteError(404, "Debit note not found.", "SALES_DEBIT_NOTE_NOT_FOUND");
  return row;
}

// The debit note's lines as documents show them (the shape credit note lines have): Finance's values, the product snapshot and the GST
// components it was taxed with.
export async function debitNoteLines(client, organizationId, debitNoteId) {
  const rows = (await client.query(
    `SELECT line.id, line.sequence, line.item_id, line.description, line.hsn_sac_code, line.quantity, line.unit_price, line.discount_amount, line.net_amount, line.tax_amount,
            line.line_total, line.tax_details, note_line.source_invoice_line_id, COALESCE(note_line.item_name_snapshot, line.description) AS item_name_snapshot,
            note_line.hsn_sac_kind, note_line.uom_snapshot
       FROM tenant.accounting_customer_invoice_lines line
       LEFT JOIN tenant.sales_debit_note_lines note_line ON note_line.customer_invoice_line_id = line.id
      WHERE line.organization_id = $1 AND line.customer_invoice_id = $2 ORDER BY line.sequence`, [organizationId, debitNoteId])).rows;
  return rows.map(({ tax_details: details, ...line }) => ({
    ...line, credit_type: "amount", gross_amount: line.net_amount,
    taxes: (Array.isArray(details) ? details : []).map((tax, index) => ({ sequence: index + 1, tax_type: tax.taxType ?? tax.tax_type, label: tax.label, rate: Number(tax.rate ?? 0),
      taxable_amount: Number(tax.taxableAmount ?? tax.taxable_amount ?? 0), tax_amount: Number(tax.taxAmount ?? tax.tax_amount ?? 0) })),
  }));
}

// What a debit note on this invoice can add to: each invoice line with its GST.
export async function getDebitNoteProposal(client, context, invoiceId) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.create, "You do not have permission to raise debit notes.");
  const invoice = await loadSourceInvoice(client, context, invoiceId);
  if (!FINANCE_POSTED.includes(invoice.status)) throw new CreditNoteError(409, "Only a posted invoice can have a debit note.", "SALES_INVOICE_NOT_POSTED");
  const lines = await creditableLines(client, context.organizationId, invoice.id);
  return {
    invoice: { id: invoice.id, number: invoice.invoice_number, date: dayOf(invoice.invoice_date), currencyCode: invoice.currency_code, customer: invoice.sales_customer_snapshot?.displayName ?? null },
    reasons: DEBIT_REASONS,
    lines: lines.map((line) => ({ invoiceLineId: line.id, item: line.item_name_snapshot, hsnSacCode: line.hsn_sac_code, quantity: Number(line.quantity), unit: line.uom_snapshot,
      unitPrice: Number(line.unit_price), taxable: Number(line.net_amount), taxRate: line.taxes.reduce((total, tax) => total + Number(tax.rate ?? 0), 0) })),
  };
}

// input: { idempotencyKey, reasonCode, reasonNote?, debitDate? (not before the invoice, not in the future), customerNotes?,
//          lines: [{ invoiceLineId, amount }] — the taxable amount each line adds }
export async function createDebitNote(client, context, invoiceId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.create, "You do not have permission to raise debit notes.");
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.amount, "You do not have permission to change an invoice's amount. Ask Finance.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new CreditNoteError(400, "A request key is required to raise a debit note.", "SALES_DEBIT_NOTE_VALIDATION");
  const invoice = await loadSourceInvoice(client, context, invoiceId, { lock: true });
  const existing = (await client.query(
    `SELECT note.customer_invoice_id, note.source_invoice_id, debit.invoice_number FROM tenant.sales_debit_notes note
       JOIN tenant.accounting_customer_invoices debit ON debit.id = note.customer_invoice_id WHERE note.organization_id = $1 AND note.idempotency_key = $2`,
    [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.source_invoice_id !== invoice.id) throw new CreditNoteError(409, "That request key was used for another invoice.", "SALES_DEBIT_NOTE_VALIDATION");
    return { debitNoteId: existing.customer_invoice_id, debitNoteNumber: existing.invoice_number, status: "draft", replayed: true };
  }
  if (!FINANCE_POSTED.includes(invoice.status)) throw new CreditNoteError(409, "Only a posted invoice can have a debit note.", "SALES_INVOICE_NOT_POSTED");
  const reasonCode = DEBIT_REASONS.some((entry) => entry.code === input.reasonCode) ? input.reasonCode : null;
  if (!reasonCode) throw new CreditNoteError(400, "Choose why the customer is debited.", "SALES_DEBIT_NOTE_VALIDATION", { field: "reasonCode" });
  const reasonNote = text(input.reasonNote, 1000);
  if (reasonCode === "other" && !reasonNote) throw new CreditNoteError(400, "Explain the reason for the debit note.", "SALES_DEBIT_NOTE_VALIDATION", { field: "reasonNote" });
  const today = await companyToday(client);
  const debitDate = input.debitDate ? String(input.debitDate).slice(0, 10) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(debitDate) || debitDate > today || debitDate < dayOf(invoice.invoice_date))
    throw new CreditNoteError(400, "The debit note date is on or after the invoice date and not in the future.", "SALES_DEBIT_NOTE_VALIDATION", { field: "debitDate" });
  const byId = new Map((await creditableLines(client, context.organizationId, invoice.id)).map((line) => [line.id, line]));
  const chosen = [];
  const seen = new Set();
  for (const entry of Array.isArray(input.lines) ? input.lines : []) {
    const value = money(entry.amount ?? 0);
    if (!(value > 0)) continue;
    const line = byId.get(entry.invoiceLineId);
    if (!line) throw new CreditNoteError(404, "That line is not on the invoice.", "SALES_DEBIT_NOTE_LINE_NOT_FOUND");
    if (seen.has(line.id)) throw new CreditNoteError(400, `${line.item_name_snapshot} is on the debit note twice.`, "SALES_DEBIT_NOTE_VALIDATION");
    seen.add(line.id);
    chosen.push({ line, type: "amount", amount: value, salesReturnLineId: null });
  }
  if (!chosen.length) throw new CreditNoteError(400, "Enter the amount to add on at least one line.", "SALES_DEBIT_NOTE_EMPTY");
  const built = await buildCreditLines(client, context, invoice.currency_code, chosen);
  let created;
  try {
    created = await createCustomerInvoice(client, financeContext(context), {
      ledgerId: invoice.ledger_id, partyId: invoice.party_id, invoiceType: "debit_note", sourceInvoiceId: invoice.id, billingAddressId: invoice.billing_address_id,
      invoiceDate: debitDate, accountingDate: debitDate, currencyCode: invoice.currency_code, exchangeRate: invoice.exchange_rate,
      customerSnapshot: invoice.customer_snapshot, billingAddressSnapshot: invoice.billing_address_snapshot, paymentTermSnapshot: invoice.payment_term_snapshot,
      placeOfSupply: invoice.place_of_supply, supplyType: invoice.supply_type,
      notes: `Debit note against ${invoice.invoice_number}: ${reasonLabel(reasonCode)}${reasonNote ? ` (${reasonNote})` : ""}`,
      lines: built.map((line) => line.finance),
    }, { internal: true, sourceSalesOrderId: invoice.sales_order_id, returnLineIds: true });
  } catch (error) {
    throw financeError(error, "The debit note could not be raised");
  }
  await client.query(
    `INSERT INTO tenant.sales_debit_notes (customer_invoice_id, organization_id, source_invoice_id, sales_order_id, idempotency_key, reason_code, reason_note, customer_snapshot,
        seller_registration_id, seller_snapshot, place_of_supply_name, supply_nature, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13)`,
    [created.id, context.organizationId, invoice.id, invoice.sales_order_id, key, reasonCode, reasonNote, JSON.stringify(invoice.sales_customer_snapshot ?? {}),
      invoice.seller_registration_id ?? null, JSON.stringify(invoice.seller_snapshot ?? {}), invoice.place_of_supply_name ?? null, invoice.supply_nature ?? null, context.userId ?? null]);
  for (let index = 0; index < built.length; index += 1)
    await client.query(
      `INSERT INTO tenant.sales_debit_note_lines (customer_invoice_line_id, organization_id, customer_invoice_id, source_invoice_line_id, item_name_snapshot, hsn_sac_kind, uom_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [created.lineIds[index], context.organizationId, created.id, built[index].sales.source_invoice_line_id, built[index].sales.item_name_snapshot, built[index].sales.hsn_sac_kind,
        built[index].sales.uom_snapshot]);
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'invoice_request', $2, 'sales_invoice.debit_note_created', 'posted', 'posted', $3::jsonb, $4, clock_timestamp())`,
    [context.organizationId, invoice.id, JSON.stringify({ debitNoteId: created.id, debitNoteNumber: created.invoiceNumber, reason: reasonLabel(reasonCode) }), context.userId ?? null]);
  return { debitNoteId: created.id, debitNoteNumber: created.invoiceNumber, status: "draft", replayed: false };
}

// Posts a draft debit note: the customer owes more (it is due like the invoice's terms) and the books and output tax are entered.
export async function postDebitNote(client, context, debitNoteId) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.post, "You do not have permission to post debit notes.");
  const note = await loadDebitNote(client, context, debitNoteId, { lock: true });
  const result = (extra) => ({ debitNoteId: note.id, debitNoteNumber: note.invoice_number, ...extra });
  if (FINANCE_POSTED.includes(note.status)) return result({ status: "posted", replayed: true });
  if (note.status === "pending_approval") return result({ status: "draft", awaitingApproval: true, replayed: true });
  if (!["draft", "approved"].includes(note.status)) throw new CreditNoteError(409, `A ${note.status} debit note cannot be posted.`, "SALES_DEBIT_NOTE_LOCKED");
  const source = (await client.query("SELECT status, invoice_number FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2", [context.organizationId, note.source_invoice_id])).rows[0];
  if (!source || !FINANCE_POSTED.includes(source.status)) throw new CreditNoteError(409, `Invoice ${source?.invoice_number ?? ""} is no longer posted.`.replace("  ", " "), "SALES_INVOICE_NOT_POSTED");
  try {
    if (note.status === "draft") {
      const submitted = await submitSubledgerDocument(client, financeContext(context), "customer_invoice", note.id);
      if (submitted.status === "pending_approval") return result({ status: "draft", awaitingApproval: true, replayed: false });
    }
    await postCustomerInvoice(client, financeContext(context), note.id, { internal: true, fromSales: true });
  } catch (error) {
    throw financeError(error, "The debit note could not be posted");
  }
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'invoice_request', $2, 'sales_invoice.debit_note_posted', 'posted', 'posted', $3::jsonb, $4, clock_timestamp())`,
    [context.organizationId, note.source_invoice_id, JSON.stringify({ debitNoteId: note.id, debitNoteNumber: note.invoice_number, total: note.grand_total }), context.userId ?? null]);
  return result({ status: "posted", replayed: false });
}

export async function cancelDraftDebitNote(client, context, debitNoteId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.edit, "You do not have permission to cancel debit notes.");
  const note = await loadDebitNote(client, context, debitNoteId, { lock: true });
  try {
    const done = await cancelCustomerInvoiceDraft(client, financeContext(context), note.id, { reason: input.reason }, { internal: true });
    return { debitNoteId: note.id, status: "cancelled", changed: done.changed };
  } catch (error) {
    throw financeError(error, "The debit note could not be cancelled");
  }
}

const view = (row) => ({
  id: row.id, number: row.invoice_number, date: dayOf(row.invoice_date), dueDate: row.due_date ? dayOf(row.due_date) : null, status: statusOf(row.status), financeStatus: row.status,
  currencyCode: row.currency_code, subtotal: Number(row.subtotal), taxTotal: Number(row.tax_total), total: Number(row.grand_total), outstanding: Number(row.outstanding_amount),
  reasonCode: row.reason_code, reasonLabel: reasonLabel(row.reason_code), reasonNote: row.reason_note,
  customer: { id: row.party_id, name: row.sales_customer_snapshot?.displayName ?? row.customer_snapshot?.displayName ?? null, gstin: row.sales_customer_snapshot?.gstin ?? row.customer_snapshot?.gstin ?? null },
  sourceInvoice: { id: row.source_invoice_id, number: row.source_invoice_number, date: row.source_invoice_date ? dayOf(row.source_invoice_date) : null },
  salesOrder: row.sales_order_id ? { id: row.sales_order_id, number: row.sales_order_number } : null, sentAt: row.sent_at, sentChannel: row.sent_channel,
  postedAt: row.posted_at, createdAt: row.created_at,
});

export async function getDebitNote(client, context, debitNoteId) {
  const row = await loadDebitNote(client, context, debitNoteId);
  const lines = await debitNoteLines(client, context.organizationId, row.id);
  const can = (permission) => context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission);
  const draft = statusOf(row.status) === "draft";
  return { debitNote: view(row), lines, actions: { post: draft && row.status !== "pending_approval" && can(CREDIT_NOTE_PERMISSIONS.post), cancel: draft && can(CREDIT_NOTE_PERMISSIONS.edit) } };
}

// filters: { search, status: draft | posted | cancelled, sourceInvoiceId, limit, offset }
export async function listDebitNotes(client, context, filters = {}) {
  requireCreditNoteAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = `note.organization_id = $1${creditNoteScopeSql(context, values, "sales_order")}`;
  if (filters.status === "draft") where += " AND debit.status IN ('draft','pending_approval','approved')";
  else if (filters.status === "posted") where += " AND debit.status IN ('posted','partially_paid','paid','overdue','disputed')";
  else if (filters.status === "cancelled") where += " AND debit.status IN ('cancelled','reversed')";
  if (filters.sourceInvoiceId) where += ` AND note.source_invoice_id = ${bind(requireUuid(filters.sourceInvoiceId, "Invoice"))}`;
  const search = text(filters.search, 100)?.toLowerCase();
  if (search) where += ` AND lower(concat_ws(' ', debit.invoice_number, source.invoice_number, note.customer_snapshot->>'displayName')) LIKE ${bind(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const rows = (await client.query(`${SELECT.replace("SELECT debit.*", "SELECT count(*) OVER () AS total_count, debit.*")} WHERE ${where}
      ORDER BY debit.invoice_date DESC, debit.invoice_number DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return { rows: rows.map(view), total: Number(rows[0]?.total_count ?? 0), limit, offset };
}

// For the PDF: the debit note, its lines, the tax by rate and the company.
export async function getDebitNoteDocument(client, context, debitNoteId) {
  const { debitNote, lines } = await getDebitNote(client, context, debitNoteId);
  const row = await loadDebitNote(client, context, debitNoteId);
  const company = (await client.query("SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0] ?? {};
  return { debitNote, row, lines, company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null } };
}
