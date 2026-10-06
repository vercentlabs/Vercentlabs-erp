// Credit notes: what an invoice can still be credited for, a new draft from
// an invoice or from a received return, changing a draft, reading one and
// listing them.
//
// The credit note is Finance's customer credit note (number, dates, lines,
// amounts, what it was applied to); Sales keeps beside it the source invoice
// and return, the reason, the customer, contact and seller as credited (the
// invoice's, never today's), each line's source invoice line, type and
// product details, the tax components and the notes.
import { createCustomerInvoice, replaceCustomerInvoiceDraft } from "../../accounting/receivables.js";
import { dayOf, requireUuid, text } from "../orders/constants.js";
import { readDate } from "../orders/versions.js";
import {
  creditNoteCan, creditNoteScopeSql, financeContext, financeError, loadCreditNote, recordCreditNoteEvent, requireCreditNoteAccess, requireCreditNotePermission,
} from "./access.js";
import { buildCreditLines, creditNoteLines, creditableLines, draftWarnings, settleCreditLines, taxSummaryOf, writeCreditLines } from "./build.js";
import {
  APPLICATION_LABELS, CREDIT_NOTE_PERMISSIONS, CREDIT_NOTE_STATUS, CREDIT_NOTE_VIEWS, CREDIT_REASONS, CREDIT_TYPES, CreditNoteError, FINANCE_POSTED, SENT_CHANNELS,
  applicationStatusOf, creditNoteStatusLabel, creditNoteStatusOf, reasonLabel,
} from "./constants.js";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value) => Math.round(Number(value) * 100) / 100;

// The posted sales invoice a credit note is made against, with its Sales record; locked when asked.
export async function loadSourceInvoice(client, context, invoiceId, { lock = false } = {}) {
  requireCreditNoteAccess(context);
  const values = [context.organizationId, requireUuid(invoiceId, "Invoice")];
  const scope = creditNoteScopeSql(context, values, "sales_order");
  const { rows } = await client.query(
    `SELECT invoice.*, btrim(invoice.currency_code) AS currency_code, sales_invoice.sales_order_id, sales_invoice.customer_snapshot AS sales_customer_snapshot,
            sales_invoice.contact_snapshot, sales_invoice.seller_registration_id, sales_invoice.seller_snapshot, sales_invoice.place_of_supply_name, sales_invoice.supply_nature,
            sales_invoice.customer_po_number, sales_order.sales_order_number
       FROM tenant.sales_invoices sales_invoice
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = sales_invoice.organization_id AND invoice.id = sales_invoice.customer_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = sales_invoice.organization_id AND sales_order.id = sales_invoice.sales_order_id
      WHERE sales_invoice.organization_id = $1 AND sales_invoice.customer_invoice_id = $2${scope}${lock ? " FOR UPDATE OF invoice" : ""}`, values);
  if (!rows[0]) throw new CreditNoteError(404, "Invoice not found.", "SALES_INVOICE_NOT_FOUND");
  return rows[0];
}

// What the invoice can still be credited for, line by line, and how much of it is still owed.
export async function getCreditNoteProposal(client, context, invoiceId) {
  const invoice = await loadSourceInvoice(client, context, invoiceId);
  const lines = await creditableLines(client, context.organizationId, invoice.id);
  const credited = await creditedTotals(client, context.organizationId, invoice.id);
  return {
    invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, invoiceDate: dayOf(invoice.invoice_date), currencyCode: invoice.currency_code,
    customerName: invoice.sales_customer_snapshot?.displayName ?? null, grandTotal: Number(invoice.grand_total), outstanding: Number(invoice.outstanding_amount),
    creditedTotal: credited.posted, canCredit: FINANCE_POSTED.includes(invoice.status),
    canCreditAmount: creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.amount),
    reasons: CREDIT_REASONS.filter((reason) => reason.code !== "sales_return"),
    lines: lines.map((line) => ({
      invoiceLineId: line.id, itemName: line.item_name_snapshot, itemCode: line.item_code_snapshot, hsnSacCode: line.hsn_sac_code, unit: line.uom_snapshot,
      invoicedQuantity: line.invoicedQuantity, unitPrice: Number(line.unit_price), taxableAmount: Number(line.net_amount), taxAmount: Number(line.tax_amount),
      taxes: line.taxes.map((tax) => ({ taxType: tax.tax_type, label: tax.label, rate: Number(tax.rate) })),
      creditedQuantity: line.creditedQuantity, creditedValue: line.creditedValue, quantityLeft: line.quantityLeft, valueLeft: line.valueLeft,
      draftQuantity: line.draftQuantity, draftCreditNotes: line.draftCreditNotes,
    })),
  };
}

// Posted credit notes' total against the invoice, and drafts'.
export async function creditedTotals(client, organizationId, invoiceId) {
  const row = (await client.query(
    `SELECT COALESCE(sum(grand_total) FILTER (WHERE status = ANY($3::text[])), 0) AS posted,
            COALESCE(sum(grand_total) FILTER (WHERE status IN ('draft', 'pending_approval', 'approved')), 0) AS drafts
       FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND source_invoice_id = $2 AND invoice_type = 'credit_note'`,
    [organizationId, invoiceId, FINANCE_POSTED])).rows[0];
  return { posted: Number(row.posted), drafts: Number(row.drafts) };
}

function readReason(input, { fromReturn }) {
  const code = text(input.reasonCode, 40) ?? (fromReturn ? "sales_return" : null);
  if (!code || !CREDIT_REASONS.some((reason) => reason.code === code))
    throw new CreditNoteError(400, "Choose the reason for the credit note.", "SALES_CREDIT_NOTE_REASON_REQUIRED", { field: "reasonCode" });
  if (code === "sales_return" && !fromReturn)
    throw new CreditNoteError(400, "A credit note for returned goods is made from the received return.", "SALES_CREDIT_NOTE_REASON_INVALID", { field: "reasonCode" });
  const note = text(input.reasonNote, 1000);
  if (code === "other" && !note) throw new CreditNoteError(400, "Explain the reason for the credit note.", "SALES_CREDIT_NOTE_REASON_REQUIRED", { field: "reasonNote" });
  return { code, note };
}

function readCreditDate(input, invoice, fallback = today()) {
  const creditDate = readDate(input.creditDate, "Credit note date") ?? fallback;
  if (creditDate < dayOf(invoice.invoice_date))
    throw new CreditNoteError(400, `The credit note date cannot be before the invoice date (${dayOf(invoice.invoice_date)}).`, "SALES_CREDIT_NOTE_DATE_INVALID", { field: "creditDate" });
  return creditDate;
}

// A new Draft credit note against a posted invoice.
// input: { idempotencyKey, reasonCode, reasonNote?, creditDate?, customerNotes?, internalNotes?,
//          lines: [{ invoiceLineId, creditType: 'quantity'|'amount', quantity?, amount? }] }
// options.salesReturn (from the return's createCreditNoteFromReturn): { id, number }; its lines carry salesReturnLineId.
export async function createCreditNote(client, context, invoiceId, input = {}, options = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.create, "You do not have permission to create credit notes.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new CreditNoteError(400, "A request key is required to create a credit note.", "SALES_CREDIT_NOTE_VALIDATION");
  const invoice = await loadSourceInvoice(client, context, invoiceId, { lock: true });
  const existing = (await client.query(
    `SELECT note.customer_invoice_id, note.source_invoice_id, credit.invoice_number FROM tenant.sales_credit_notes note
       JOIN tenant.accounting_customer_invoices credit ON credit.id = note.customer_invoice_id WHERE note.organization_id = $1 AND note.idempotency_key = $2`,
    [context.organizationId, key])).rows[0];
  if (existing) {
    if (existing.source_invoice_id !== invoice.id) throw new CreditNoteError(409, "That request key was used for another invoice.", "SALES_CREDIT_NOTE_VALIDATION");
    return { creditNoteId: existing.customer_invoice_id, creditNoteNumber: existing.invoice_number, status: CREDIT_NOTE_STATUS.draft, replayed: true, warnings: [] };
  }
  if (!FINANCE_POSTED.includes(invoice.status))
    throw new CreditNoteError(409, invoice.status === "reversed" ? "A reversed invoice cannot be credited." : "Only a posted invoice can be credited.", "SALES_INVOICE_NOT_POSTED");
  const reason = readReason(input, { fromReturn: Boolean(options.salesReturn) });
  const creditDate = readCreditDate(input, invoice);
  const lines = await creditableLines(client, context.organizationId, invoice.id);
  const chosen = settleCreditLines(lines, (input.lines ?? []).map((entry) => ({ ...entry, invoiceLineId: requireUuid(entry.invoiceLineId, "Invoice line"), salesReturnLineId: options.salesReturn ? entry.salesReturnLineId ?? null : null })));
  if (chosen.some((entry) => entry.type === CREDIT_TYPES.amount)) {
    requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.amount, "You do not have permission to credit an amount. Credit a quantity, or ask Finance.");
    if (options.salesReturn) throw new CreditNoteError(400, "Returned goods are credited by quantity.", "SALES_CREDIT_NOTE_VALIDATION");
  }
  const built = await buildCreditLines(client, context, invoice.currency_code, chosen);
  assertWithinValue(chosen, built);
  let created;
  try {
    created = await createCustomerInvoice(client, financeContext(context), {
      ledgerId: invoice.ledger_id, partyId: invoice.party_id, invoiceType: "credit_note", sourceInvoiceId: invoice.id, billingAddressId: invoice.billing_address_id,
      invoiceDate: creditDate, accountingDate: creditDate, dueDate: creditDate, currencyCode: invoice.currency_code, exchangeRate: invoice.exchange_rate,
      customerSnapshot: invoice.customer_snapshot, billingAddressSnapshot: invoice.billing_address_snapshot, paymentTermSnapshot: invoice.payment_term_snapshot,
      placeOfSupply: invoice.place_of_supply, supplyType: invoice.supply_type,
      notes: `Credit note against ${invoice.invoice_number}: ${reasonLabel(reason.code)}${reason.note ? ` (${reason.note})` : ""}`,
      lines: built.map((line) => line.finance),
    }, { internal: true, sourceSalesOrderId: invoice.sales_order_id, returnLineIds: true });
  } catch (error) {
    throw financeError(error, "The credit note could not be created");
  }
  await client.query(
    `INSERT INTO tenant.sales_credit_notes (customer_invoice_id, organization_id, source_invoice_id, sales_order_id, sales_return_id, idempotency_key, reason_code, reason_note,
        customer_snapshot, contact_snapshot, seller_registration_id, seller_snapshot, place_of_supply_name, supply_nature, customer_po_number, customer_notes, internal_notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13, $14, $15, $16, $17, $18)`,
    [created.id, context.organizationId, invoice.id, invoice.sales_order_id, options.salesReturn?.id ?? null, key, reason.code, reason.note,
      JSON.stringify(invoice.sales_customer_snapshot ?? {}), JSON.stringify(invoice.contact_snapshot ?? {}), invoice.seller_registration_id ?? null,
      JSON.stringify(invoice.seller_snapshot ?? {}), invoice.place_of_supply_name ?? null, invoice.supply_nature ?? null, invoice.customer_po_number ?? null,
      text(input.customerNotes, 4000), text(input.internalNotes, 4000), context.userId ?? null]);
  await writeCreditLines(client, context, created.id, created.lineIds, built);
  const summary = chosen.map((entry) => ({ item: entry.line.item_name_snapshot, type: entry.type, quantity: entry.quantity, amount: entry.amount, unit: entry.line.uom_snapshot }));
  await recordCreditNoteEvent(client, context, created.id, "sales_credit_note.created", null, CREDIT_NOTE_STATUS.draft, {
    creditNoteNumber: created.invoiceNumber, invoiceNumber: invoice.invoice_number, returnNumber: options.salesReturn?.number, reason: reasonLabel(reason.code), lines: summary,
  });
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'invoice_request', $2, 'sales_invoice.credit_note_created', 'posted', 'posted', $3::jsonb, $4, clock_timestamp())`,
    [context.organizationId, invoice.id, JSON.stringify({ creditNoteId: created.id, creditNoteNumber: created.invoiceNumber, reason: reasonLabel(reason.code), lines: summary }), context.userId ?? null]);
  return { creditNoteId: created.id, creditNoteNumber: created.invoiceNumber, status: CREDIT_NOTE_STATUS.draft, replayed: false, warnings: draftWarnings(chosen) };
}

// A quantity credit never takes more of a line's value than is left of it (after amount credits).
function assertWithinValue(chosen, built) {
  chosen.forEach((entry, index) => {
    if (entry.type !== CREDIT_TYPES.quantity) return;
    const net = Number(built[index].finance.unitPrice) * Number(built[index].finance.quantity) - Number(built[index].finance.discountAmount);
    if (net > entry.line.valueLeft + 0.005)
      throw new CreditNoteError(409, `${entry.line.item_name_snapshot}: crediting ${entry.quantity} would credit ${net.toFixed(2)}, but only ${entry.line.valueLeft.toFixed(2)} of its value is left to credit.`,
        "SALES_CREDIT_NOTE_EXCEEDS_VALUE");
  });
}

// The draft's lines worked out again over what is credited now (posted credit notes), with the quantities or amounts asked for
// (or the ones it has). Used when a draft changes and when it is posted. Returns { chosen, warnings }.
export async function rewriteDraft(client, context, creditNote, { requested = null, creditDate }) {
  const current = await creditNoteLines(client, context.organizationId, creditNote.id);
  const returnLineOf = new Map(current.map((line) => [line.source_invoice_line_id, line.sales_return_line_id]));
  const asked = requested ?? current.map((line) => ({
    invoiceLineId: line.source_invoice_line_id, creditType: line.credit_type,
    quantity: line.credit_type === CREDIT_TYPES.quantity ? Number(line.quantity) : undefined,
    amount: line.credit_type === CREDIT_TYPES.amount ? Number(line.net_amount) : undefined,
  }));
  const lines = await creditableLines(client, context.organizationId, creditNote.source_invoice_id, { exceptCreditNoteId: creditNote.id });
  const chosen = settleCreditLines(lines, asked.map((entry) => ({ ...entry, invoiceLineId: requireUuid(entry.invoiceLineId, "Invoice line"), salesReturnLineId: returnLineOf.get(entry.invoiceLineId) ?? null })));
  const built = await buildCreditLines(client, context, creditNote.currency_code, chosen);
  assertWithinValue(chosen, built);
  let replaced;
  try {
    replaced = await replaceCustomerInvoiceDraft(client, financeContext(context), creditNote.id, {
      invoiceDate: creditDate, accountingDate: creditDate, dueDate: creditDate, lines: built.map((line) => line.finance),
    }, { internal: true });
  } catch (error) {
    throw financeError(error, "The credit note could not be changed");
  }
  await writeCreditLines(client, context, creditNote.id, replaced.lineIds, built);
  return { chosen, warnings: draftWarnings(chosen) };
}

// Changes a draft. input: { expectedVersion?, lines? (the full set; as createCreditNote), reasonCode?, reasonNote?, creditDate?, customerNotes?, internalNotes? }
export async function updateDraftCreditNote(client, context, creditNoteId, input = {}) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.edit, "You do not have permission to edit credit notes.");
  const seen = await loadCreditNote(client, context, creditNoteId);
  await loadSourceInvoice(client, context, seen.source_invoice_id, { lock: true });
  const creditNote = await loadCreditNote(client, context, creditNoteId, { lock: true });
  if (creditNote.status !== "draft")
    throw new CreditNoteError(409, creditNote.status === "pending_approval" || creditNote.status === "approved" ? "The credit note is with Finance for approval and cannot be changed."
      : "A posted credit note cannot be changed. Reverse it and make a new one.", "SALES_CREDIT_NOTE_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(creditNote.version))
    throw new CreditNoteError(409, "Someone else changed this credit note. Reload it and try again.", "SALES_CREDIT_NOTE_VERSION_CONFLICT");
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const changes = [];
  const invoice = { invoice_date: creditNote.source_invoice_date };
  const creditDate = has("creditDate") ? readCreditDate(input, invoice, dayOf(creditNote.invoice_date)) : dayOf(creditNote.invoice_date);
  if (creditDate !== dayOf(creditNote.invoice_date)) changes.push({ what: "Credit note date", from: dayOf(creditNote.invoice_date), to: creditDate });
  let warnings = [];
  if (Array.isArray(input.lines)) {
    if (creditNote.sales_return_id) throw new CreditNoteError(409, "The lines of a credit note made from a return follow the return. Cancel it and credit the return again.", "SALES_CREDIT_NOTE_FROM_RETURN");
    if (input.lines.some((entry) => entry.creditType === CREDIT_TYPES.amount && Number(entry.amount) > 0))
      requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.amount, "You do not have permission to credit an amount.");
  }
  if (Array.isArray(input.lines) || changes.length) {
    const before = await creditNoteLines(client, context.organizationId, creditNote.id);
    const rewritten = await rewriteDraft(client, context, creditNote, { requested: Array.isArray(input.lines) ? input.lines : null, creditDate });
    warnings = rewritten.warnings;
    if (Array.isArray(input.lines)) {
      const describe = (lines) => lines.map((line) => `${line.item_name_snapshot ?? line.line.item_name_snapshot}: ${(line.credit_type ?? line.type) === CREDIT_TYPES.amount
        ? `amount ${Number(line.net_amount ?? line.amount).toFixed(2)}` : `${Number(line.quantity)}`}`).join("; ");
      const from = describe(before);
      const to = describe(rewritten.chosen);
      if (from !== to) changes.push({ what: "Lines", from, to });
    }
  }
  const sets = [];
  const values = [context.organizationId, creditNote.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (has("reasonCode") || has("reasonNote")) {
    const reason = readReason({ reasonCode: has("reasonCode") ? input.reasonCode : creditNote.reason_code, reasonNote: has("reasonNote") ? input.reasonNote : creditNote.reason_note },
      { fromReturn: Boolean(creditNote.sales_return_id) });
    if (creditNote.sales_return_id && reason.code !== "sales_return") throw new CreditNoteError(400, "A credit note made from a return is for the return.", "SALES_CREDIT_NOTE_REASON_INVALID");
    if (reason.code !== creditNote.reason_code) { set("reason_code", reason.code); changes.push({ what: "Reason", from: reasonLabel(creditNote.reason_code), to: reasonLabel(reason.code) }); }
    if ((reason.note ?? "") !== (creditNote.reason_note ?? "")) { set("reason_note", reason.note); changes.push({ what: "Reason details", from: creditNote.reason_note ?? null, to: reason.note }); }
  }
  for (const [key, column, label] of [["customerNotes", "customer_notes", "Customer notes"], ["internalNotes", "internal_notes", "Internal notes"]]) {
    if (!has(key)) continue;
    const value = text(input[key], 4000);
    if ((value ?? "") !== (creditNote[column] ?? "")) { set(column, value); changes.push({ what: label, from: creditNote[column] ?? null, to: value }); }
  }
  if (!changes.length) return { creditNoteId: creditNote.id, version: Number(creditNote.version), changed: false, warnings };
  const version = (await client.query(
    `UPDATE tenant.sales_credit_notes SET ${[...sets, "version = version + 1", "updated_at = now()"].join(", ")} WHERE organization_id = $1 AND customer_invoice_id = $2 RETURNING version`,
    values)).rows[0].version;
  await recordCreditNoteEvent(client, context, creditNote.id, "sales_credit_note.updated", CREDIT_NOTE_STATUS.draft, CREDIT_NOTE_STATUS.draft, { changes });
  return { creditNoteId: creditNote.id, version: Number(version), changed: true, changes, warnings };
}

// What the caller can do with the credit note now; the server checks again on each action.
function availableActions(context, creditNote, unapplied, refunded) {
  const can = (permission) => creditNoteCan(context, permission);
  const status = creditNoteStatusOf(creditNote.status);
  const posted = status === CREDIT_NOTE_STATUS.posted;
  return {
    edit: creditNote.status === "draft" && can(CREDIT_NOTE_PERMISSIONS.edit),
    editLines: creditNote.status === "draft" && !creditNote.sales_return_id && can(CREDIT_NOTE_PERMISSIONS.edit),
    post: ["draft", "approved"].includes(creditNote.status) && can(CREDIT_NOTE_PERMISSIONS.post),
    cancel: ["draft", "approved"].includes(creditNote.status) && can(CREDIT_NOTE_PERMISSIONS.edit),
    print: status !== CREDIT_NOTE_STATUS.cancelled && can(CREDIT_NOTE_PERMISSIONS.print),
    send: posted && can(CREDIT_NOTE_PERMISSIONS.send),
    markSent: posted && can(CREDIT_NOTE_PERMISSIONS.send),
    // A refunded credit note is reversed only after its refunds are.
    reverse: posted && refunded <= 0.005 && can(CREDIT_NOTE_PERMISSIONS.reverse),
    creditAmount: can(CREDIT_NOTE_PERMISSIONS.amount),
    viewApplication: can(CREDIT_NOTE_PERMISSIONS.applicationView),
    viewAccounting: Boolean(creditNote.journal_entry_id) && can(CREDIT_NOTE_PERMISSIONS.accountingView),
    applyCredit: posted && unapplied > 0.005 && can("accounting.receipts.manage"),
    // What the invoice did not owe is the customer's credit: Finance applies it to another invoice, or refunds it.
    refund: posted && unapplied > 0.005 && can("accounting.refund.create"),
  };
}

// Everything the credit note page shows.
export async function getCreditNote(client, context, creditNoteId) {
  const creditNote = await loadCreditNote(client, context, creditNoteId);
  const head = (await client.query(
    `SELECT creator.full_name AS created_by_name, poster.full_name AS posted_by_name, reverser.full_name AS reversed_by_name, sender.full_name AS sent_by_name,
            party.customer_number, journal.entry_number AS journal_entry_number, reversal.entry_number AS reversal_entry_number, sales_order.lifecycle_status AS order_status
       FROM tenant.sales_credit_notes note
       JOIN tenant.accounting_customer_invoices credit ON credit.id = note.customer_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.id = note.sales_order_id
       LEFT JOIN tenant.business_parties party ON party.id = credit.party_id
       LEFT JOIN tenant.accounting_journal_entries journal ON journal.id = credit.journal_entry_id
       LEFT JOIN tenant.accounting_journal_entries reversal ON reversal.id = note.reversal_journal_entry_id
       LEFT JOIN public.users creator ON creator.id = note.created_by
       LEFT JOIN public.users poster ON poster.id = credit.posted_by
       LEFT JOIN public.users reverser ON reverser.id = note.reversed_by
       LEFT JOIN public.users sender ON sender.id = note.sent_by
      WHERE note.organization_id = $1 AND note.customer_invoice_id = $2`, [context.organizationId, creditNote.id])).rows[0];
  const lines = await creditNoteLines(client, context.organizationId, creditNote.id);
  const status = creditNoteStatusOf(creditNote.status);
  const total = Number(creditNote.grand_total);
  const canSeeApplication = creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.applicationView);
  const allocations = (await client.query(
    `SELECT allocation.id, allocation.customer_invoice_id, allocation.allocated_amount, allocation.allocated_at, target.invoice_number, target.invoice_date,
            EXISTS (SELECT 1 FROM tenant.sales_invoices sales_invoice WHERE sales_invoice.customer_invoice_id = target.id) AS is_sales_invoice
       FROM tenant.accounting_customer_credit_allocations allocation JOIN tenant.accounting_customer_invoices target ON target.id = allocation.customer_invoice_id
      WHERE allocation.organization_id = $1 AND allocation.credit_note_id = $2 ORDER BY allocation.allocated_at`, [context.organizationId, creditNote.id])).rows;
  const applied = money(allocations.reduce((sum, allocation) => sum + Number(allocation.allocated_amount), 0));
  const unapplied = status === CREDIT_NOTE_STATUS.posted ? money(Number(creditNote.outstanding_amount)) : 0;
  // Refunds are Finance's payments out of this credit; drafts consume nothing yet.
  const refunds = (await client.query(
    `SELECT refund.id, refund.refund_number, refund.status, refund.refund_date, allocation.amount, refund.payment_method, refund.external_reference
       FROM tenant.accounting_customer_refund_allocations allocation JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id
      WHERE allocation.organization_id = $1 AND allocation.credit_note_id = $2 AND refund.status <> 'cancelled' ORDER BY refund.created_at`, [context.organizationId, creditNote.id])).rows;
  const refunded = money(refunds.filter((refund) => refund.status === "posted").reduce((sum, refund) => sum + Number(refund.amount), 0));
  const applicationStatus = applicationStatusOf({ status: creditNote.status, total, unapplied, refunded });
  const [sends, events, financeEvents, deliveries] = [
    (await client.query(
      `SELECT send.id, send.channel, send.recipients, send.subject, send.note, send.sent_at, sender.full_name AS sent_by_name FROM tenant.sales_credit_note_sends send
         LEFT JOIN public.users sender ON sender.id = send.sent_by WHERE send.organization_id = $1 AND send.customer_invoice_id = $2 ORDER BY send.sent_at DESC`,
      [context.organizationId, creditNote.id])).rows,
    (await client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
         FROM tenant.sales_credit_note_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.customer_invoice_id = $2`, [context.organizationId, creditNote.id])).rows,
    // Applications and unapplications are Finance's: part of the credit note's history.
    (await client.query(
      `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
         FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.entity_type = 'customer_invoice' AND event.entity_id = $2
          AND event.event_type IN ('accounting.customer_credit.allocated', 'accounting.customer_credit_note.reversed', 'accounting.customer_credit.refunded',
                                   'accounting.customer_credit.refund_reversed', 'accounting.customer_invoice.submitted_for_approval',
                                   'accounting.customer_invoice.approved', 'accounting.customer_invoice.rejected')`,
      [context.organizationId, creditNote.id])).rows,
    (await client.query(
      `SELECT DISTINCT delivery.id, delivery.request_number AS delivery_number
         FROM tenant.sales_credit_note_lines note_line
         JOIN tenant.accounting_customer_invoice_lines source_line ON source_line.id = note_line.source_invoice_line_id
         JOIN tenant.sales_delivery_lines delivery_line ON delivery_line.id = source_line.source_sales_delivery_line_id
         JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = delivery_line.delivery_id
        WHERE note_line.organization_id = $1 AND note_line.customer_invoice_id = $2`, [context.organizationId, creditNote.id])).rows,
  ];
  let problems = [];
  let warnings = [];
  if (["draft", "approved"].includes(creditNote.status)) {
    const { postingProblems } = await import("./lifecycle.js");
    ({ problems, warnings } = await postingProblems(client, context, creditNote));
  }
  const credited = await creditedTotals(client, context.organizationId, creditNote.source_invoice_id);
  const canSeeAccounting = creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.accountingView);
  return {
    creditNote: {
      ...creditNote, ...head, status, financeStatus: creditNote.status, statusLabel: creditNoteStatusLabel(creditNote.status), reasonLabel: reasonLabel(creditNote.reason_code),
      sent: Boolean(creditNote.sent_at), sentLabel: creditNote.sent_at ? "Sent" : "Not sent",
      applicationStatus, applicationStatusLabel: APPLICATION_LABELS[applicationStatus],
      applied: canSeeApplication ? applied : null, unapplied: canSeeApplication ? unapplied : null, refunded: canSeeApplication ? refunded : null,
      sourceInvoice: { id: creditNote.source_invoice_id, invoiceNumber: creditNote.source_invoice_number, invoiceDate: creditNote.source_invoice_date,
        grandTotal: Number(creditNote.source_grand_total), outstanding: canSeeApplication ? Number(creditNote.source_outstanding) : null, creditedTotal: credited.posted },
      journal_entry_number: canSeeAccounting ? head.journal_entry_number : null, journal_entry_id: canSeeAccounting ? creditNote.journal_entry_id : null,
      reversal_entry_number: canSeeAccounting ? head.reversal_entry_number : null,
    },
    lines,
    taxSummary: taxSummaryOf(lines),
    allocations: canSeeApplication ? allocations : [],
    refunds: canSeeApplication ? refunds.map((refund) => ({ ...refund, amount: money(refund.amount) })) : [],
    deliveries, sends,
    events: [...events, ...financeEvents].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)),
    problems, warnings,
    reasons: CREDIT_REASONS,
    sentChannels: SENT_CHANNELS,
    actions: availableActions(context, creditNote, unapplied, refunded),
  };
}

const SORTS = Object.freeze({ number: "credit.invoice_number", date: "credit.invoice_date", customer: "customer_name", total: "credit.grand_total", created: "credit.created_at" });
const POSTED_SQL = `credit.status IN ('${FINANCE_POSTED.join("','")}')`;

// filters: view, search, status, partyId, reasonCode, salesOrderId, invoiceId, returnId, fromReturn ('yes'|'no'), unapplied ('true'), dateFrom, dateTo, sort, direction, limit, offset
export async function listCreditNotes(client, context, filters = {}) {
  requireCreditNoteAccess(context);
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = creditNoteScopeSql(context, values, "sales_order");
  const view = (key) => {
    switch (key) {
      case "draft": return ` AND credit.status IN ('draft','pending_approval','approved')`;
      case "posted": return ` AND ${POSTED_SQL}`;
      case "reversed": return ` AND credit.status IN ('reversed','cancelled')`;
      case "from_returns": return ` AND note.sales_return_id IS NOT NULL`;
      case "price_adjustments": return ` AND note.reason_code IN ('price_adjustment','post_sale_discount')`;
      case "unapplied": return ` AND ${POSTED_SQL} AND credit.outstanding_amount > 0.005`;
      default: return "";
    }
  };
  where += view(filters.view);
  if (["draft", "posted", "reversed"].includes(filters.status)) where += view(filters.status);
  if (filters.unapplied === "true") where += view("unapplied");
  if (filters.fromReturn === "yes") where += view("from_returns");
  if (filters.fromReturn === "no") where += ` AND note.sales_return_id IS NULL`;
  const reason = text(filters.reasonCode, 40);
  if (reason && CREDIT_REASONS.some((entry) => entry.code === reason)) where += ` AND note.reason_code = ${bind(reason)}`;
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (credit.invoice_number ILIKE ${term} OR source.invoice_number ILIKE ${term} OR sales_order.sales_order_number ILIKE ${term}
      OR note.customer_snapshot->>'displayName' ILIKE ${term} OR party.customer_number ILIKE ${term} OR note.customer_po_number ILIKE ${term} OR sales_return.return_number ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.sales_credit_note_lines line WHERE line.customer_invoice_id = credit.id AND (line.item_name_snapshot ILIKE ${term} OR line.item_code_snapshot ILIKE ${term})))`;
  }
  const uuidFilter = (key, sql, label) => { if (filters[key]) where += sql(bind(requireUuid(filters[key], label))); };
  uuidFilter("partyId", (p) => ` AND credit.party_id = ${p}`, "Customer");
  uuidFilter("salesOrderId", (p) => ` AND note.sales_order_id = ${p}`, "Sales order");
  uuidFilter("invoiceId", (p) => ` AND note.source_invoice_id = ${p}`, "Invoice");
  uuidFilter("returnId", (p) => ` AND note.sales_return_id = ${p}`, "Return");
  const dateFilter = (key, sql, label) => { const day = readDate(filters[key], label); if (day) where += sql(bind(day)); };
  dateFilter("dateFrom", (p) => ` AND credit.invoice_date >= ${p}::date`, "Credit note date from");
  dateFilter("dateTo", (p) => ` AND credit.invoice_date <= ${p}::date`, "Credit note date to");
  const sort = SORTS[filters.sort] ?? SORTS.created;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.sales_credit_notes note
       JOIN tenant.accounting_customer_invoices credit ON credit.organization_id = note.organization_id AND credit.id = note.customer_invoice_id
       JOIN tenant.accounting_customer_invoices source ON source.organization_id = note.organization_id AND source.id = note.source_invoice_id
       JOIN tenant.sales_orders sales_order ON sales_order.organization_id = note.organization_id AND sales_order.id = note.sales_order_id
       LEFT JOIN tenant.sales_returns sales_return ON sales_return.id = note.sales_return_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = credit.organization_id AND party.id = credit.party_id
      WHERE note.organization_id = $1`;
  const countValues = [...values];
  const canSeeApplication = creditNoteCan(context, CREDIT_NOTE_PERMISSIONS.applicationView);
  const rows = (await client.query(
    `SELECT credit.id, credit.invoice_number, credit.status AS finance_status, credit.invoice_date, credit.grand_total, credit.tax_total, credit.outstanding_amount,
            btrim(credit.currency_code) AS currency_code, credit.party_id, note.customer_snapshot->>'displayName' AS customer_name, party.customer_number, note.reason_code,
            note.source_invoice_id, source.invoice_number AS source_invoice_number, note.sales_order_id, sales_order.sales_order_number, note.sales_return_id,
            sales_return.return_number, note.sent_at, COALESCE((SELECT sum(allocation.amount) FROM tenant.accounting_customer_refund_allocations allocation
              JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status = 'posted' WHERE allocation.credit_note_id = credit.id), 0) AS refunded,
            (SELECT string_agg(DISTINCT line.credit_type, ',') FROM tenant.sales_credit_note_lines line WHERE line.customer_invoice_id = credit.id) AS credit_types
       ${from}${where}
      ORDER BY ${sort} ${direction} NULLS LAST, credit.invoice_number DESC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const count = (await client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues)).rows[0].total;
  return {
    rows: rows.map((row) => {
      const total = Number(row.grand_total);
      const status = creditNoteStatusOf(row.finance_status);
      const unapplied = status === CREDIT_NOTE_STATUS.posted ? money(Number(row.outstanding_amount)) : 0;
      const refunded = money(Number(row.refunded));
      const applicationStatus = applicationStatusOf({ status: row.finance_status, total, unapplied, refunded });
      return {
        ...row, status, statusLabel: creditNoteStatusLabel(row.finance_status), reasonLabel: reasonLabel(row.reason_code),
        creditTypes: String(row.credit_types ?? "").split(",").filter(Boolean),
        applied: canSeeApplication && status === CREDIT_NOTE_STATUS.posted ? money(total - unapplied - refunded) : null, unapplied: canSeeApplication ? unapplied : null,
        refunded: canSeeApplication ? refunded : null,
        applicationStatus, applicationStatusLabel: APPLICATION_LABELS[applicationStatus], outstanding_amount: undefined, credit_types: undefined,
      };
    }),
    total: count, limit, offset, views: CREDIT_NOTE_VIEWS, reasons: CREDIT_REASONS,
    capabilities: Object.fromEntries(Object.entries(CREDIT_NOTE_PERMISSIONS).map(([name, permission]) => [name, creditNoteCan(context, permission)])),
  };
}
