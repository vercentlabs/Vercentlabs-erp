// Customer refunds: what credit a customer has that can be refunded, a new
// draft against one credit source, changing a draft, reading one and listing
// them.
//
// Refundable credit is Finance's, never the sum of credit notes:
//   credit note  what is left of it after what was applied to invoices and
//                what posted refunds already paid back (a credit note is
//                applied to its own invoice when posted, so only what the
//                invoice did not owe is left)
//   receipt      what is left unapplied (an overpayment or an advance) after
//                posted refunds
// A draft refund consumes nothing: several drafts may name the same credit
// (each is warned of the others), and posting decides, under the source's lock.
import {
  asDatabaseDecimal, decimal, getCurrencyPrecision, isoDate, loadOrganization, optionalUuid, roundMoney, text, toBaseAmount, uuid,
} from "../core.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import {
  REFUND_METHODS, REFUND_PERMISSIONS, REFUND_REASONS, REFUND_SENT_CHANNELS, REFUND_SOURCE, REFUND_SOURCE_LABELS, REFUND_STATUS, REFUND_STATUS_LABELS, REFUND_VIEWS, RefundError,
  refundCan, refundMethodLabel, refundReasonLabel, requireRefundPermission,
} from "./constants.js";

const today = () => new Date().toISOString().slice(0, 10);
const num = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const dayOf = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value ?? "").slice(0, 10));
const CREDIT_NOTE_OPEN = ["posted", "partially_paid"];
const RECEIPT_OPEN = ["posted", "partially_applied"];

export async function recordRefundEvent(client, context, refundId, eventType, fromStatus, toStatus, metadata = {}) {
  await client.query(
    `INSERT INTO tenant.accounting_events (organization_id, entity_type, entity_id, event_type, from_status, to_status, metadata, actor_user_id, occurred_at)
     VALUES ($1, 'customer_refund', $2, $3, $4, $5, $6::jsonb, $7, clock_timestamp())`,
    [context.organizationId, refundId, eventType, fromStatus, toStatus, JSON.stringify(metadata), context.userId ?? null]);
}

// One credit source as a refund sees it; locked when asked. { type, id }.
export async function loadRefundSource(client, context, source, { lock = false } = {}) {
  const id = uuid(source.id, "Credit source");
  if (source.type === REFUND_SOURCE.creditNote) {
    const row = (await client.query(
      `SELECT credit.id, credit.invoice_number AS number, credit.invoice_date AS date, credit.party_id, credit.ledger_id, btrim(credit.currency_code) AS currency_code, credit.exchange_rate,
              credit.grand_total AS total, credit.outstanding_amount AS available, credit.status, credit.invoice_type, credit.source_invoice_id
         FROM tenant.accounting_customer_invoices credit WHERE credit.organization_id = $1 AND credit.id = $2${lock ? " FOR UPDATE" : ""}`, [context.organizationId, id])).rows[0];
    if (!row || row.invoice_type !== "credit_note") throw new RefundError(404, "Credit note not found.", "ACCOUNTING_REFUND_SOURCE_NOT_FOUND");
    const open = CREDIT_NOTE_OPEN.includes(row.status);
    return { ...row, type: REFUND_SOURCE.creditNote, total: num(row.total), available: open ? num(row.available) : 0, open,
      why: open ? null : row.status === "paid" ? `Credit note ${row.number} has no credit left: it was applied or refunded in full.`
        : `Credit note ${row.number} is ${["draft", "pending_approval", "approved"].includes(row.status) ? "not posted" : row.status}: only a posted credit note can be refunded.` };
  }
  if (source.type === REFUND_SOURCE.receipt) {
    const row = (await client.query(
      `SELECT receipt.id, receipt.receipt_number AS number, receipt.receipt_date AS date, receipt.party_id, receipt.ledger_id, btrim(receipt.currency_code) AS currency_code,
              receipt.exchange_rate, receipt.amount AS total, receipt.unapplied_amount AS available, receipt.status
         FROM tenant.accounting_customer_receipts receipt WHERE receipt.organization_id = $1 AND receipt.id = $2${lock ? " FOR UPDATE" : ""}`, [context.organizationId, id])).rows[0];
    if (!row) throw new RefundError(404, "Receipt not found.", "ACCOUNTING_REFUND_SOURCE_NOT_FOUND");
    const open = RECEIPT_OPEN.includes(row.status);
    return { ...row, type: REFUND_SOURCE.receipt, total: num(row.total), available: open ? num(row.available) : 0, open,
      why: open ? null : row.status === "applied" ? `Receipt ${row.number} has nothing unapplied left.` : `Receipt ${row.number} is ${row.status}: only a posted receipt can be refunded.` };
  }
  throw new RefundError(400, "Choose the credit note or receipt to refund.", "ACCOUNTING_REFUND_SOURCE_REQUIRED", { field: "sourceType" });
}

// What draft refunds (other than `exceptRefundId`) would take from a source.
async function onDrafts(client, context, source, exceptRefundId = null) {
  const column = source.type === REFUND_SOURCE.creditNote ? "credit_note_id" : "receipt_id";
  const rows = (await client.query(
    `SELECT refund.refund_number, allocation.amount FROM tenant.accounting_customer_refund_allocations allocation
       JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status = 'draft'
      WHERE allocation.organization_id = $1 AND allocation.${column} = $2 AND ($3::uuid IS NULL OR refund.id <> $3)`, [context.organizationId, source.id, exceptRefundId])).rows;
  return { amount: num(rows.reduce((total, row) => total + Number(row.amount), 0)), refunds: rows.map((row) => row.refund_number) };
}

// The customer's credit that can be refunded now, source by source, and what the customer still owes.
export async function getRefundableCustomerCredit(client, context, partyIdValue) {
  requireRefundPermission(context, REFUND_PERMISSIONS.creditView, "You do not have permission to view customer credit.");
  const partyId = uuid(partyIdValue, "Customer");
  const party = (await client.query(`SELECT id, display_name, customer_number, btrim(currency_code) AS currency_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, partyId])).rows[0];
  if (!party) throw new RefundError(404, "Customer not found.", "ACCOUNTING_REFUND_CUSTOMER_NOT_FOUND");
  const refunded = (column) => `COALESCE((SELECT sum(allocation.amount) FROM tenant.accounting_customer_refund_allocations allocation
        JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status = 'posted' WHERE allocation.${column} = source.id), 0)`;
  const drafts = (column) => `COALESCE((SELECT sum(allocation.amount) FROM tenant.accounting_customer_refund_allocations allocation
        JOIN tenant.accounting_customer_refunds refund ON refund.id = allocation.refund_id AND refund.status = 'draft' WHERE allocation.${column} = source.id), 0)`;
  const creditNotes = (await client.query(
    `SELECT source.id, source.invoice_number AS number, source.invoice_date AS date, btrim(source.currency_code) AS currency_code, source.grand_total AS total,
            source.outstanding_amount AS available, ${refunded("credit_note_id")} AS refunded, ${drafts("credit_note_id")} AS on_drafts,
            COALESCE((SELECT sum(allocated_amount) FROM tenant.accounting_customer_credit_allocations WHERE credit_note_id = source.id), 0) AS applied,
            original.invoice_number AS reference, EXISTS (SELECT 1 FROM tenant.sales_credit_notes note WHERE note.customer_invoice_id = source.id) AS from_sales
       FROM tenant.accounting_customer_invoices source LEFT JOIN tenant.accounting_customer_invoices original ON original.id = source.source_invoice_id
      WHERE source.organization_id = $1 AND source.party_id = $2 AND source.invoice_type = 'credit_note' AND source.status = ANY($3::text[]) AND source.outstanding_amount > 0
      ORDER BY source.invoice_date, source.created_at`, [context.organizationId, partyId, CREDIT_NOTE_OPEN])).rows;
  const receipts = (await client.query(
    `SELECT source.id, source.receipt_number AS number, source.receipt_date AS date, btrim(source.currency_code) AS currency_code, source.amount AS total,
            source.unapplied_amount AS available, ${refunded("receipt_id")} AS refunded, ${drafts("receipt_id")} AS on_drafts,
            COALESCE((SELECT sum(receipt_amount) FROM tenant.accounting_customer_receipt_allocations WHERE receipt_id = source.id), 0) AS applied, source.external_reference AS reference
       FROM tenant.accounting_customer_receipts source
      WHERE source.organization_id = $1 AND source.party_id = $2 AND source.status = ANY($3::text[]) AND source.unapplied_amount > 0
      ORDER BY source.receipt_date, source.created_at`, [context.organizationId, partyId, RECEIPT_OPEN])).rows;
  const owed = (await client.query(
    `SELECT btrim(currency_code) AS currency_code, COALESCE(sum(outstanding_amount), 0) AS amount, count(*)::int AS invoices FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND party_id = $2 AND invoice_type <> 'credit_note' AND status IN ('posted', 'partially_paid', 'overdue', 'disputed') AND outstanding_amount > 0
      GROUP BY btrim(currency_code)`, [context.organizationId, partyId])).rows;
  const shape = (type) => (row) => ({
    sourceType: type, sourceId: row.id, number: row.number, label: REFUND_SOURCE_LABELS[type], date: row.date, currencyCode: row.currency_code, total: num(row.total),
    applied: num(row.applied), refunded: num(row.refunded), available: num(row.available), onDraftRefunds: num(row.on_drafts), reference: row.reference ?? null,
    fromSales: Boolean(row.from_sales),
  });
  const sources = [...creditNotes.map(shape(REFUND_SOURCE.creditNote)), ...receipts.map(shape(REFUND_SOURCE.receipt))];
  const byCurrency = new Map();
  for (const source of sources) byCurrency.set(source.currencyCode, num((byCurrency.get(source.currencyCode) ?? 0) + source.available));
  return {
    customer: { id: party.id, name: party.display_name, customerNumber: party.customer_number, currencyCode: party.currency_code },
    available: [...byCurrency].map(([currencyCode, amount]) => ({ currencyCode, amount })),
    // Credit can be applied to what the customer still owes instead of being refunded.
    owed: owed.map((row) => ({ currencyCode: row.currency_code, amount: num(row.amount), invoices: row.invoices })),
    sources,
  };
}

function readReason(input, fallback) {
  const code = text(input.reasonCode, 40) || fallback;
  if (!REFUND_REASONS.some((reason) => reason.code === code)) throw new RefundError(400, "Choose the reason for the refund.", "ACCOUNTING_REFUND_REASON_REQUIRED", { field: "reasonCode" });
  const note = text(input.reasonNote, 1000) || null;
  if (code === "other" && !note) throw new RefundError(400, "Explain the reason for the refund.", "ACCOUNTING_REFUND_REASON_REQUIRED", { field: "reasonNote" });
  return { code, note };
}
const readMethod = (value, fallback = "bank_transfer") => {
  const method = text(value, 40) || fallback;
  if (!REFUND_METHODS.some((entry) => entry.code === method)) throw new RefundError(400, "Choose how the refund is paid.", "ACCOUNTING_REFUND_METHOD_INVALID", { field: "paymentMethod" });
  return method;
};

// The bank or cash account money can leave from for this refund: active, in the refund's ledger and currency.
export async function loadRefundAccount(client, context, bankAccountId, refund) {
  const account = (await client.query(
    `SELECT id, code, bank_name, account_name, masked_account_number, account_type, btrim(currency_code) AS currency_code, status, ledger_id, gl_account_id
       FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND id = $2`, [context.organizationId, uuid(bankAccountId, "Bank or cash account")])).rows[0];
  if (!account || account.ledger_id !== refund.ledger_id) throw new RefundError(404, "Bank or cash account not found.", "ACCOUNTING_REFUND_ACCOUNT_NOT_FOUND", { field: "bankAccountId" });
  if (account.status !== "active") throw new RefundError(409, `${account.account_name} is not active.`, "ACCOUNTING_REFUND_ACCOUNT_INVALID", { field: "bankAccountId" });
  if (account.currency_code !== String(refund.currency_code).trim())
    throw new RefundError(409, `${account.account_name} is a ${account.currency_code} account; the refund is in ${String(refund.currency_code).trim()}.`, "ACCOUNTING_REFUND_CURRENCY_MISMATCH", { field: "bankAccountId" });
  return account;
}

function checkAmount(amount, source, precision) {
  const entered = Number(amount);
  if (!Number.isFinite(entered) || entered <= 0) throw new RefundError(400, "The refund amount must be more than zero.", "ACCOUNTING_REFUND_AMOUNT_INVALID", { field: "amount" });
  const value = roundMoney(decimal(entered.toFixed(6)), precision);
  if (value <= 0n) throw new RefundError(400, "The refund amount must be more than zero.", "ACCOUNTING_REFUND_AMOUNT_INVALID", { field: "amount" });
  if (!source.open) throw new RefundError(409, source.why, "ACCOUNTING_REFUND_SOURCE_INVALID");
  if (value > decimal(source.available.toFixed(2)))
    throw new RefundError(409, `Only ${source.available.toFixed(2)} ${source.currency_code} of ${source.number} can be refunded.`, "ACCOUNTING_REFUND_EXCEEDS_CREDIT", { field: "amount", available: source.available });
  return value;
}

// A new Draft refund of one credit source. The customer, ledger, currency and rate are the source's.
// input: { idempotencyKey, sourceType: 'credit_note'|'receipt', sourceId, amount, refundDate?, reasonCode?, reasonNote?, paymentMethod?, bankAccountId?, externalReference?,
//          customerNotes?, internalNotes? }
export async function createCustomerRefund(client, context, input = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.create, "You do not have permission to create refunds.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new RefundError(400, "A request key is required to create a refund.", "ACCOUNTING_REFUND_VALIDATION");
  const source = await loadRefundSource(client, context, { type: input.sourceType, id: input.sourceId }, { lock: true });
  const existing = (await client.query(
    `SELECT refund.id, refund.refund_number, allocation.credit_note_id, allocation.receipt_id FROM tenant.accounting_customer_refunds refund
       JOIN tenant.accounting_customer_refund_allocations allocation ON allocation.refund_id = refund.id
      WHERE refund.organization_id = $1 AND refund.idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (existing) {
    if ((existing.credit_note_id ?? existing.receipt_id) !== source.id) throw new RefundError(409, "That request key was used for another refund.", "ACCOUNTING_REFUND_VALIDATION");
    return { refundId: existing.id, refundNumber: existing.refund_number, status: REFUND_STATUS.draft, replayed: true, warnings: [] };
  }
  const organization = await loadOrganization(client, context);
  const precision = await getCurrencyPrecision(client, context, source.currency_code);
  const amount = checkAmount(input.amount, source, precision);
  const refundDate = isoDate(input.refundDate || today(), "Refund date");
  if (refundDate < dayOf(source.date)) throw new RefundError(400, `The refund date cannot be before ${source.number} (${dayOf(source.date)}).`, "ACCOUNTING_REFUND_DATE_INVALID", { field: "refundDate" });
  const reason = readReason(input, source.type === REFUND_SOURCE.receipt ? "overpayment" : "customer_credit");
  const method = readMethod(input.paymentMethod);
  const party = (await client.query(`SELECT id, code, display_name, legal_name, customer_number, gstin FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, source.party_id])).rows[0];
  let bankAccountId = null;
  if (input.bankAccountId) {
    requireRefundPermission(context, REFUND_PERMISSIONS.selectAccount, "You do not have permission to choose the bank or cash account.");
    bankAccountId = (await loadRefundAccount(client, context, input.bankAccountId, { ledger_id: source.ledger_id, currency_code: source.currency_code })).id;
  }
  const basePrecision = await getCurrencyPrecision(client, context, organization.base_currency);
  const refundNumber = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "customer_refund" });
  const refund = (await client.query(
    `INSERT INTO tenant.accounting_customer_refunds (organization_id, ledger_id, refund_number, party_id, customer_snapshot, refund_date, accounting_date, currency_code,
        functional_currency_code, exchange_rate, amount, base_amount, reason_code, reason_note, payment_method, bank_account_id, external_reference, customer_notes, internal_notes,
        idempotency_key, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $20) RETURNING id`,
    [context.organizationId, source.ledger_id, refundNumber, source.party_id,
      JSON.stringify({ id: party.id, code: party.code, displayName: party.display_name, legalName: party.legal_name, customerNumber: party.customer_number, gstin: party.gstin }),
      refundDate, source.currency_code, organization.base_currency, source.exchange_rate, asDatabaseDecimal(amount),
      asDatabaseDecimal(toBaseAmount(amount, decimal(source.exchange_rate), basePrecision)), reason.code, reason.note, method, bankAccountId, text(input.externalReference, 200) || null,
      text(input.customerNotes, 4000) || null, text(input.internalNotes, 4000) || null, key, context.userId ?? null])).rows[0];
  await client.query(
    `INSERT INTO tenant.accounting_customer_refund_allocations (organization_id, refund_id, source_type, credit_note_id, receipt_id, amount) VALUES ($1, $2, $3, $4, $5, $6)`,
    [context.organizationId, refund.id, source.type, source.type === REFUND_SOURCE.creditNote ? source.id : null, source.type === REFUND_SOURCE.receipt ? source.id : null,
      asDatabaseDecimal(amount)]);
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.created", null, REFUND_STATUS.draft, {
    refundNumber, source: `${REFUND_SOURCE_LABELS[source.type]} ${source.number}`, amount: asDatabaseDecimal(amount), currencyCode: source.currency_code,
    reason: refundReasonLabel(reason.code), paymentMethod: refundMethodLabel(method), reference: text(input.externalReference, 200) || undefined,
  });
  const drafts = await onDrafts(client, context, source, refund.id);
  const warnings = drafts.amount + Number(asDatabaseDecimal(amount)) > source.available + 0.005
    ? [{ code: "ACCOUNTING_REFUND_DRAFT_CONFLICT", message: `Draft ${drafts.refunds.join(", ")} also refund ${source.number}; together they take more than the ${source.available.toFixed(2)} left, so only the first posted goes through.` }]
    : [];
  return { refundId: refund.id, refundNumber, status: REFUND_STATUS.draft, replayed: false, warnings };
}

// From the unapplied credit of a posted credit note / from the unapplied part of a receipt (an overpayment).
export const createRefundFromCreditNote = (client, context, creditNoteId, input = {}) =>
  createCustomerRefund(client, context, { ...input, sourceType: REFUND_SOURCE.creditNote, sourceId: creditNoteId });
export const createRefundFromOverpayment = (client, context, receiptId, input = {}) =>
  createCustomerRefund(client, context, { ...input, sourceType: REFUND_SOURCE.receipt, sourceId: receiptId });

// The refund with its one allocation; locked when asked.
export async function loadRefund(client, context, refundId, { lock = false } = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.view, "You do not have permission to view refunds.");
  const row = (await client.query(
    `SELECT refund.*, btrim(refund.currency_code) AS currency_code, allocation.id AS allocation_id, allocation.source_type, allocation.credit_note_id, allocation.receipt_id
       FROM tenant.accounting_customer_refunds refund
       JOIN tenant.accounting_customer_refund_allocations allocation ON allocation.organization_id = refund.organization_id AND allocation.refund_id = refund.id
      WHERE refund.organization_id = $1 AND refund.id = $2${lock ? " FOR UPDATE OF refund" : ""}`, [context.organizationId, uuid(refundId, "Refund")])).rows[0];
  if (!row) throw new RefundError(404, "Refund not found.", "ACCOUNTING_REFUND_NOT_FOUND");
  return { ...row, source: { type: row.source_type, id: row.credit_note_id ?? row.receipt_id } };
}

// Changes a draft. The credit source stays: cancel the draft and refund the other source instead.
// input: { expectedVersion?, amount?, refundDate?, reasonCode?, reasonNote?, paymentMethod?, bankAccountId?, externalReference?, customerNotes?, internalNotes? }
export async function updateDraftRefund(client, context, refundId, input = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.edit, "You do not have permission to edit refunds.");
  const seen = await loadRefund(client, context, refundId);
  const source = await loadRefundSource(client, context, seen.source, { lock: true });
  const refund = await loadRefund(client, context, refundId, { lock: true });
  if (refund.status !== REFUND_STATUS.draft)
    throw new RefundError(409, refund.status === REFUND_STATUS.posted ? "A posted refund cannot be changed. Reverse it and record a new one." : `A ${refund.status} refund cannot be changed.`, "ACCOUNTING_REFUND_LOCKED");
  if (input.expectedVersion != null && Number(input.expectedVersion) !== Number(refund.version))
    throw new RefundError(409, "Someone else changed this refund. Reload it and try again.", "ACCOUNTING_REFUND_VERSION_CONFLICT");
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const changes = [];
  const sets = [];
  const values = [context.organizationId, refund.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  if (has("amount")) {
    const precision = await getCurrencyPrecision(client, context, refund.currency_code);
    const amount = checkAmount(input.amount, source, precision);
    if (amount !== decimal(refund.amount)) {
      const organization = await loadOrganization(client, context);
      const basePrecision = await getCurrencyPrecision(client, context, organization.base_currency);
      set("amount", asDatabaseDecimal(amount));
      set("base_amount", asDatabaseDecimal(toBaseAmount(amount, decimal(refund.exchange_rate), basePrecision)));
      await client.query(`UPDATE tenant.accounting_customer_refund_allocations SET amount = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, refund.allocation_id, asDatabaseDecimal(amount)]);
      changes.push({ what: "Amount", from: num(refund.amount).toFixed(2), to: num(asDatabaseDecimal(amount)).toFixed(2) });
    }
  }
  if (has("refundDate")) {
    const refundDate = isoDate(input.refundDate, "Refund date");
    if (refundDate < dayOf(source.date)) throw new RefundError(400, `The refund date cannot be before ${source.number} (${dayOf(source.date)}).`, "ACCOUNTING_REFUND_DATE_INVALID", { field: "refundDate" });
    if (refundDate !== dayOf(refund.refund_date)) { set("refund_date", refundDate); set("accounting_date", refundDate); changes.push({ what: "Refund date", from: dayOf(refund.refund_date), to: refundDate }); }
  }
  if (has("reasonCode") || has("reasonNote")) {
    const reason = readReason({ reasonCode: has("reasonCode") ? input.reasonCode : refund.reason_code, reasonNote: has("reasonNote") ? input.reasonNote : refund.reason_note }, refund.reason_code);
    if (reason.code !== refund.reason_code) { set("reason_code", reason.code); changes.push({ what: "Reason", from: refundReasonLabel(refund.reason_code), to: refundReasonLabel(reason.code) }); }
    if ((reason.note ?? "") !== (refund.reason_note ?? "")) { set("reason_note", reason.note); changes.push({ what: "Reason details", from: refund.reason_note ?? null, to: reason.note }); }
  }
  if (has("paymentMethod")) {
    const method = readMethod(input.paymentMethod, refund.payment_method);
    if (method !== refund.payment_method) { set("payment_method", method); changes.push({ what: "Payment method", from: refundMethodLabel(refund.payment_method), to: refundMethodLabel(method) }); }
  }
  if (has("bankAccountId") && (optionalUuid(input.bankAccountId, "Bank or cash account") ?? null) !== (refund.bank_account_id ?? null)) {
    requireRefundPermission(context, REFUND_PERMISSIONS.selectAccount, "You do not have permission to choose the bank or cash account.");
    const account = input.bankAccountId ? await loadRefundAccount(client, context, input.bankAccountId, refund) : null;
    const before = refund.bank_account_id ? (await client.query(`SELECT account_name FROM tenant.accounting_bank_accounts WHERE id = $1`, [refund.bank_account_id])).rows[0]?.account_name : null;
    set("bank_account_id", account?.id ?? null);
    changes.push({ what: "Bank / cash account", from: before ?? null, to: account?.account_name ?? null });
  }
  for (const [key, column, label, limit] of [["externalReference", "external_reference", "Reference", 200], ["customerNotes", "customer_notes", "Customer notes", 4000], ["internalNotes", "internal_notes", "Internal notes", 4000]]) {
    if (!has(key)) continue;
    const value = text(input[key], limit) || null;
    if ((value ?? "") !== (refund[column] ?? "")) { set(column, value); changes.push({ what: label, from: refund[column] ?? null, to: value }); }
  }
  if (!changes.length) return { refundId: refund.id, version: Number(refund.version), changed: false };
  values.push(context.userId ?? null);
  const version = (await client.query(
    `UPDATE tenant.accounting_customer_refunds SET ${[...sets, "version = version + 1", `updated_by = $${values.length}`, "updated_at = now()"].join(", ")}
      WHERE organization_id = $1 AND id = $2 RETURNING version`, values)).rows[0].version;
  await recordRefundEvent(client, context, refund.id, "accounting.customer_refund.updated", REFUND_STATUS.draft, REFUND_STATUS.draft, { changes });
  return { refundId: refund.id, version: Number(version), changed: true, changes };
}

// The bank and cash accounts a refund can be paid from: names only, never balances; only for those who may choose one.
export async function listRefundAccounts(client, context, currencyCode = null) {
  if (!refundCan(context, REFUND_PERMISSIONS.selectAccount)) return [];
  return (await client.query(
    `SELECT id, code, bank_name, account_name, masked_account_number, account_type, btrim(currency_code) AS currency_code FROM tenant.accounting_bank_accounts
      WHERE organization_id = $1 AND status = 'active' AND ($2::text IS NULL OR btrim(currency_code) = $2) ORDER BY account_name`, [context.organizationId, currencyCode])).rows;
}

function availableActions(context, refund, source) {
  const can = (permission) => refundCan(context, permission);
  const draft = refund.status === REFUND_STATUS.draft;
  const posted = refund.status === REFUND_STATUS.posted;
  return {
    edit: draft && can(REFUND_PERMISSIONS.edit),
    selectAccount: draft && can(REFUND_PERMISSIONS.selectAccount),
    post: draft && can(REFUND_PERMISSIONS.post),
    cancel: draft && can(REFUND_PERMISSIONS.cancel),
    reverse: posted && can(REFUND_PERMISSIONS.reverse),
    print: refund.status !== REFUND_STATUS.cancelled,
    send: posted && can(REFUND_PERMISSIONS.send),
    markSent: posted && can(REFUND_PERMISSIONS.send),
    viewAccounting: Boolean(refund.journal_entry_id) && can(REFUND_PERMISSIONS.accountingView),
    viewCredit: can(REFUND_PERMISSIONS.creditView),
    applyCredit: draft && source.available > 0.005 && can("accounting.receipts.manage"),
  };
}

// Everything the refund page shows.
export async function getCustomerRefund(client, context, refundId) {
  const refund = await loadRefund(client, context, refundId);
  const source = await loadRefundSource(client, context, refund.source);
  const head = (await client.query(
    `SELECT creator.full_name AS created_by_name, poster.full_name AS posted_by_name, reverser.full_name AS reversed_by_name, canceller.full_name AS cancelled_by_name,
            sender.full_name AS sent_by_name, party.display_name AS customer_name, party.customer_number, journal.entry_number AS journal_entry_number,
            reversal.entry_number AS reversal_entry_number, bank.account_name AS bank_account_name, bank.bank_name, bank.masked_account_number, bank.account_type AS bank_account_type,
            contact.email AS customer_email
       FROM tenant.accounting_customer_refunds refund
       JOIN tenant.business_parties party ON party.id = refund.party_id
       LEFT JOIN tenant.accounting_bank_accounts bank ON bank.id = refund.bank_account_id
       LEFT JOIN tenant.accounting_journal_entries journal ON journal.id = refund.journal_entry_id
       LEFT JOIN tenant.accounting_journal_entries reversal ON reversal.id = refund.reversal_journal_entry_id
       LEFT JOIN public.users creator ON creator.id = refund.created_by
       LEFT JOIN public.users poster ON poster.id = refund.posted_by
       LEFT JOIN public.users reverser ON reverser.id = refund.reversed_by
       LEFT JOIN public.users canceller ON canceller.id = refund.cancelled_by
       LEFT JOIN public.users sender ON sender.id = refund.sent_by
       LEFT JOIN LATERAL (SELECT contact.email FROM tenant.crm_contact_account_relationships link JOIN tenant.contacts contact ON contact.id = link.contact_id
                           WHERE link.organization_id = refund.organization_id AND link.party_id = refund.party_id AND link.status = 'active' AND contact.email IS NOT NULL
                           ORDER BY link.is_billing_contact DESC, link.is_primary_contact DESC, link.created_at LIMIT 1) contact ON true
      WHERE refund.organization_id = $1 AND refund.id = $2`, [context.organizationId, refund.id])).rows[0];
  const column = source.type === REFUND_SOURCE.creditNote ? "credit_note_id" : "receipt_id";
  const siblings = (await client.query(
    `SELECT other.id, other.refund_number, other.status, other.refund_date, allocation.amount FROM tenant.accounting_customer_refund_allocations allocation
       JOIN tenant.accounting_customer_refunds other ON other.id = allocation.refund_id
      WHERE allocation.organization_id = $1 AND allocation.${column} = $2 AND other.status <> 'cancelled' ORDER BY other.created_at`, [context.organizationId, source.id])).rows;
  const refundedTotal = num(siblings.filter((row) => row.status === REFUND_STATUS.posted).reduce((total, row) => total + Number(row.amount), 0));
  const applied = source.type === REFUND_SOURCE.creditNote
    ? (await client.query(`SELECT COALESCE(sum(allocated_amount), 0) AS amount FROM tenant.accounting_customer_credit_allocations WHERE organization_id = $1 AND credit_note_id = $2`, [context.organizationId, source.id])).rows[0].amount
    : (await client.query(`SELECT COALESCE(sum(receipt_amount), 0) AS amount FROM tenant.accounting_customer_receipt_allocations WHERE organization_id = $1 AND receipt_id = $2`, [context.organizationId, source.id])).rows[0].amount;
  // Where the credit came from, for the trail: return → credit note → refund.
  const related = source.type === REFUND_SOURCE.creditNote
    ? (await client.query(
      `SELECT note.customer_invoice_id IS NOT NULL AS from_sales, original.id AS invoice_id, original.invoice_number,
              EXISTS (SELECT 1 FROM tenant.sales_invoices sales_invoice WHERE sales_invoice.customer_invoice_id = original.id) AS invoice_from_sales,
              sales_order.id AS sales_order_id, sales_order.sales_order_number, sales_return.id AS sales_return_id, sales_return.return_number
         FROM tenant.accounting_customer_invoices credit
         LEFT JOIN tenant.sales_credit_notes note ON note.customer_invoice_id = credit.id
         LEFT JOIN tenant.accounting_customer_invoices original ON original.id = credit.source_invoice_id
         LEFT JOIN tenant.sales_orders sales_order ON sales_order.id = note.sales_order_id
         LEFT JOIN tenant.sales_returns sales_return ON sales_return.id = note.sales_return_id
        WHERE credit.organization_id = $1 AND credit.id = $2`, [context.organizationId, source.id])).rows[0] ?? {}
    : {};
  const sends = (await client.query(
    `SELECT send.id, send.channel, send.recipients, send.subject, send.note, send.sent_at, sender.full_name AS sent_by_name FROM tenant.accounting_customer_refund_sends send
       LEFT JOIN public.users sender ON sender.id = send.sent_by WHERE send.organization_id = $1 AND send.refund_id = $2 ORDER BY send.sent_at DESC`, [context.organizationId, refund.id])).rows;
  const events = (await client.query(
    `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, actor.full_name AS actor_name
       FROM tenant.accounting_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
      WHERE event.organization_id = $1 AND event.entity_type = 'customer_refund' AND event.entity_id = $2 ORDER BY event.occurred_at DESC, event.id`, [context.organizationId, refund.id])).rows;
  let problems = [];
  let warnings = [];
  if (refund.status === REFUND_STATUS.draft) {
    const { postingProblems } = await import("./lifecycle.js");
    ({ problems, warnings } = await postingProblems(client, context, refund, source));
  }
  const canSeeAccounting = refundCan(context, REFUND_PERMISSIONS.accountingView);
  const canSeeCredit = refundCan(context, REFUND_PERMISSIONS.creditView);
  return {
    refund: {
      ...refund, ...head, statusLabel: REFUND_STATUS_LABELS[refund.status], reasonLabel: refundReasonLabel(refund.reason_code), paymentMethodLabel: refundMethodLabel(refund.payment_method),
      sent: Boolean(refund.sent_at), sentLabel: refund.sent_at ? "Sent" : "Not sent",
      journal_entry_number: canSeeAccounting ? head.journal_entry_number : null, journal_entry_id: canSeeAccounting ? refund.journal_entry_id : null,
      reversal_entry_number: canSeeAccounting ? head.reversal_entry_number : null,
      allocation_id: undefined, credit_note_id: undefined, receipt_id: undefined, source_type: undefined, source: undefined, idempotency_key: undefined,
    },
    source: {
      type: source.type, typeLabel: REFUND_SOURCE_LABELS[source.type], id: source.id, number: source.number, date: source.date, currencyCode: source.currency_code, status: source.status,
      fromSales: Boolean(related.from_sales),
      total: canSeeCredit ? source.total : null, applied: canSeeCredit ? num(applied) : null, refunded: canSeeCredit ? refundedTotal : null, available: canSeeCredit ? source.available : null,
    },
    otherRefunds: siblings.filter((row) => row.id !== refund.id).map((row) => ({ ...row, amount: num(row.amount), statusLabel: REFUND_STATUS_LABELS[row.status] })),
    related: {
      invoice: related.invoice_id ? { id: related.invoice_id, number: related.invoice_number, fromSales: Boolean(related.invoice_from_sales) } : null,
      salesOrder: related.sales_order_id ? { id: related.sales_order_id, number: related.sales_order_number } : null,
      salesReturn: related.sales_return_id ? { id: related.sales_return_id, number: related.return_number } : null,
    },
    sends, events, problems, warnings,
    accounts: refund.status === REFUND_STATUS.draft ? await listRefundAccounts(client, context, refund.currency_code) : [],
    reasons: REFUND_REASONS, methods: REFUND_METHODS, sentChannels: REFUND_SENT_CHANNELS,
    actions: availableActions(context, refund, source),
  };
}

const SORTS = Object.freeze({ number: "refund.refund_number", date: "refund.refund_date", customer: "party.display_name", amount: "refund.amount", created: "refund.created_at" });

// filters: view, search, status, partyId, paymentMethod, bankAccountId, currencyCode, reasonCode, creditNoteId, receiptId, dateFrom, dateTo, sort, direction, limit, offset
export async function listCustomerRefunds(client, context, filters = {}) {
  requireRefundPermission(context, REFUND_PERMISSIONS.view, "You do not have permission to view refunds.");
  const values = [context.organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = "";
  const view = (key) => {
    switch (key) {
      case "draft": return ` AND refund.status = 'draft'`;
      case "posted": return ` AND refund.status = 'posted'`;
      case "reversed": return ` AND refund.status IN ('reversed', 'cancelled')`;
      default: return "";
    }
  };
  where += view(filters.view);
  if (["draft", "posted", "reversed"].includes(filters.status)) where += view(filters.status);
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (refund.refund_number ILIKE ${term} OR party.display_name ILIKE ${term} OR party.customer_number ILIKE ${term} OR refund.external_reference ILIKE ${term}
      OR credit.invoice_number ILIKE ${term} OR receipt.receipt_number ILIKE ${term} OR original.invoice_number ILIKE ${term})`;
  }
  const uuidFilter = (key, sql, label) => { if (filters[key]) where += sql(bind(uuid(filters[key], label))); };
  uuidFilter("partyId", (p) => ` AND refund.party_id = ${p}`, "Customer");
  uuidFilter("bankAccountId", (p) => ` AND refund.bank_account_id = ${p}`, "Bank or cash account");
  uuidFilter("creditNoteId", (p) => ` AND allocation.credit_note_id = ${p}`, "Credit note");
  uuidFilter("receiptId", (p) => ` AND allocation.receipt_id = ${p}`, "Receipt");
  if (REFUND_METHODS.some((entry) => entry.code === filters.paymentMethod)) where += ` AND refund.payment_method = ${bind(filters.paymentMethod)}`;
  if (REFUND_REASONS.some((entry) => entry.code === filters.reasonCode)) where += ` AND refund.reason_code = ${bind(filters.reasonCode)}`;
  if (text(filters.currencyCode, 3)) where += ` AND btrim(refund.currency_code) = ${bind(text(filters.currencyCode, 3).toUpperCase())}`;
  if (filters.dateFrom) where += ` AND refund.refund_date >= ${bind(isoDate(filters.dateFrom, "Refund date from"))}::date`;
  if (filters.dateTo) where += ` AND refund.refund_date <= ${bind(isoDate(filters.dateTo, "Refund date to"))}::date`;
  const sort = SORTS[filters.sort] ?? SORTS.created;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.accounting_customer_refunds refund
       JOIN tenant.accounting_customer_refund_allocations allocation ON allocation.organization_id = refund.organization_id AND allocation.refund_id = refund.id
       JOIN tenant.business_parties party ON party.id = refund.party_id
       LEFT JOIN tenant.accounting_customer_invoices credit ON credit.id = allocation.credit_note_id
       LEFT JOIN tenant.accounting_customer_invoices original ON original.id = credit.source_invoice_id
       LEFT JOIN tenant.accounting_customer_receipts receipt ON receipt.id = allocation.receipt_id
       LEFT JOIN tenant.accounting_bank_accounts bank ON bank.id = refund.bank_account_id
      WHERE refund.organization_id = $1`;
  const countValues = [...values];
  const rows = (await client.query(
    `SELECT refund.id, refund.refund_number, refund.status, refund.refund_date, refund.amount, btrim(refund.currency_code) AS currency_code, refund.party_id,
            party.display_name AS customer_name, party.customer_number, refund.reason_code, refund.payment_method, refund.bank_account_id, bank.account_name AS bank_account_name,
            refund.external_reference, refund.sent_at, allocation.source_type, COALESCE(allocation.credit_note_id, allocation.receipt_id) AS source_id,
            COALESCE(credit.invoice_number, receipt.receipt_number) AS source_number
       ${from}${where}
      ORDER BY ${sort} ${direction} NULLS LAST, refund.refund_number DESC
      LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values)).rows;
  const count = (await client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues)).rows[0].total;
  return {
    rows: rows.map((row) => ({
      ...row, amount: num(row.amount), statusLabel: REFUND_STATUS_LABELS[row.status], reasonLabel: refundReasonLabel(row.reason_code), paymentMethodLabel: refundMethodLabel(row.payment_method),
      sourceLabel: REFUND_SOURCE_LABELS[row.source_type],
    })),
    total: count, limit, offset, views: REFUND_VIEWS, reasons: REFUND_REASONS, methods: REFUND_METHODS,
    accounts: await listRefundAccounts(client, context),
    capabilities: Object.fromEntries(Object.entries(REFUND_PERMISSIONS).map(([name, permission]) => [name, refundCan(context, permission)])),
  };
}
