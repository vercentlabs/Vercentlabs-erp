// Refunds (migration 0100): returning money for an authorized source — once, and never reported as done before it is. Approving a refund,
// sending it and the money reaching the customer are different events, each recorded:
//
//  - A refund is an obligation with a source (a posted return; a payment captured for a checkout that never completed; a verified duplicate
//    or excess payment) — never an amount typed by a cashier. Its authorized amount can never pass what the source still allows, counting
//    every other refund of the source that is not failed or cancelled.
//  - It is split into components across the original tenders (the company's allocation policy, in whole paise, never beyond what each
//    tender has left — counting what is reserved and still unresolved). A component is refunded by its own route: cash from an open cash
//    session when the cashier confirms handing it over; card / UPI through the original provider (each call an attempt, idempotent);
//    payments the provider cannot refund (standalone machine, static QR) are refunded outside and recorded with their reference.
//  - Outcomes are tracked: processing stays processing, unknown stays reserved and goes to the reconciliation queue — it is never sent
//    again blindly; only a definitive failure releases its amount for a retry. The refund's own state follows its components: partially
//    refunded while anything is outstanding, refunded only when everything is paid.
//  - REFUND_INITIATE within the cashier's limit authorizes it; above, a supervisor holding APPROVE_REFUND_EXCEPTION (never the requester)
//    approves exactly this version.
import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { add, sub, decimal, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { authorizePosAction } from "../permissions/index.js";
import { event } from "../shared/audit.js";
import { resolvePaymentAdapter } from "./adapter.js";
import { refundPosCardPayment, getPosCardRefund, settlePosCardRefund } from "./card-payments.js";
import { allocateReturnRefund } from "./split-payments.js";

export const POS_REFUND_MESSAGES = Object.freeze({
  POS_REFUND_SOURCE_REQUIRED: "Select an eligible return or payment correction.",
  POS_REFUND_SOURCE_INVALID: "This transaction is not eligible for a refund.",
  POS_REFUND_PERMISSION_DENIED: "You cannot initiate this refund.",
  POS_REFUND_AMOUNT_INVALID: "Refund amount is invalid.",
  POS_REFUND_EXCEEDS_SOURCE: "Refund exceeds the authorized amount.",
  POS_REFUND_EXCEEDS_PAYMENT: "Refund exceeds the original refundable payment.",
  POS_REFUND_ALREADY_COMPLETED: "This refund has already been completed.",
  POS_REFUND_APPROVAL_REQUIRED: "Supervisor approval is required.",
  POS_REFUND_APPROVAL_INVALID: "Approval no longer matches this refund.",
  POS_REFUND_SELF_APPROVAL: "You cannot approve a refund you requested.",
  POS_REFUND_METHOD_UNAVAILABLE: "The selected refund method is unavailable.",
  POS_REFUND_ORIGINAL_PAYMENT_NOT_FOUND: "Original payment could not be verified.",
  POS_REFUND_CASH_SESSION_REQUIRED: "Open an authorized cash session to pay cash.",
  POS_REFUND_CASH_PAYOUT_UNCONFIRMED: "Confirm the physical cash payout.",
  POS_REFUND_PROVIDER_PENDING: "Refund is processing. Check its status.",
  POS_REFUND_PROVIDER_FAILED: "Provider could not process the refund.",
  POS_REFUND_OUTCOME_UNKNOWN: "Refund status is being checked. Do not refund again.",
  POS_REFUND_PARTIALLY_COMPLETED: "Some refund payments are still outstanding.",
  POS_REFUND_CANCELLATION_NOT_ALLOWED: "This refund cannot be cancelled.",
  POS_REFUND_RECONCILIATION_REQUIRED: "Refund needs verification before continuing.",
  POS_REFUND_VERSION_CONFLICT: "Refund changed. Refresh and try again.",
  POS_REFUND_IDEMPOTENCY_CONFLICT: "This action conflicts with an earlier refund request.",
  POS_REFUND_NOT_FOUND: "Refund not found.",
  POS_REFUND_REFERENCE_REQUIRED: "Enter the reference of the refund made outside the provider.",
});
const refundError = (status, code, detail = null) => posError(status, detail ? `${POS_REFUND_MESSAGES[code]} ${detail}` : POS_REFUND_MESSAGES[code], code);
const money = (value) => (value === null || value === undefined ? null : formatDecimal(decimal(String(value)), 2));
const dec = (value) => decimal(String(value ?? 0));
const administrator = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage");
const reconciler = (context) => administrator(context) || context.permissions?.includes("pos.reconciliation.manage");
const MANUAL_PROVIDERS = ["standalone", "static_qr"];
const OPEN_COMPONENT = ["pending", "submitted", "processing", "unknown", "cancel_pending"];
const ACTIVE_REFUND = ["draft", "awaiting_approval", "authorized", "processing", "partially_refunded", "failed_action_required", "reconciliation_required", "refunded"];

// ------------------------------------------------------------------ sources and capacity

// What a source allows: its authorized value, what other refunds of it already hold, the tenders it may be refunded to.
async function sourceOf(client, context, sourceType, sourceId, { lock = false } = {}) {
  const forUpdate = lock ? " FOR UPDATE" : "";
  if (sourceType === "pos_return") {
    const ret = (await client.query(`SELECT * FROM tenant.pos_returns WHERE organization_id=$1 AND id=$2${forUpdate}`, [context.organizationId, sourceId])).rows[0];
    if (!ret) throw refundError(404, "POS_REFUND_SOURCE_INVALID", "Return not found.");
    if (ret.lifecycle_status !== "posted") throw refundError(409, "POS_REFUND_SOURCE_INVALID", "Only a posted return is refunded.");
    const payments = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 AND status IN ('captured','partially_refunded','refunded') ORDER BY captured_at NULLS LAST, initiated_at, id${forUpdate}`,
      [context.organizationId, ret.sale_id])).rows;
    return { type: "pos_return", id: ret.id, value: dec(ret.refund_total), storeId: ret.store_id, saleId: ret.sale_id, currency: ret.currency_code ?? "INR", reason: "return_refund",
      reference: ret.return_number, payments, fallbackShiftId: ret.shift_id, record: ret };
  }
  if (sourceType === "checkout_failure") {
    const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2${forUpdate}`, [context.organizationId, sourceId])).rows[0];
    if (!payment) throw refundError(404, "POS_REFUND_ORIGINAL_PAYMENT_NOT_FOUND");
    const cart = payment.cart_id ? (await client.query(`SELECT status, completed_sale_id FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, payment.cart_id])).rows[0] : null;
    if (payment.sale_id || cart?.status === "completed" || !["captured", "partially_refunded", "refunded"].includes(payment.status) || payment.payment_method === "cash")
      throw refundError(409, "POS_REFUND_SOURCE_INVALID", "Only an electronic payment captured for a checkout that never completed is refunded this way.");
    return { type: "checkout_failure", id: payment.id, value: dec(payment.amount), storeId: payment.store_id, saleId: null, currency: payment.currency_code ?? "INR", reason: "checkout_failure",
      reference: payment.provider_reference ?? payment.id, payments: [payment], fallbackShiftId: payment.shift_id, record: payment };
  }
  if (sourceType === "payment_exception") {
    const exception = (await client.query(`SELECT * FROM tenant.pos_payment_exceptions WHERE organization_id=$1 AND id=$2${forUpdate}`, [context.organizationId, sourceId])).rows[0];
    if (!exception) throw refundError(404, "POS_REFUND_SOURCE_INVALID", "Payment exception not found.");
    if (!["excess", "duplicate", "late", "conflicting", "unmatched", "short"].includes(exception.exception_type) || exception.amount === null || ["refunded", "resolved"].includes(exception.status))
      throw refundError(409, "POS_REFUND_SOURCE_INVALID", "Only an open excess, duplicate or late payment is refunded this way.");
    if (!exception.provider_reference && !exception.payment_id) throw refundError(409, "POS_REFUND_ORIGINAL_PAYMENT_NOT_FOUND");
    return { type: "payment_exception", id: exception.id, value: dec(exception.amount), storeId: exception.store_id, saleId: null, currency: exception.currency_code ?? "INR",
      reason: exception.exception_type === "duplicate" ? "duplicate_payment" : "excess_payment", reference: exception.provider_transaction_reference ?? exception.provider_reference, payments: [],
      exception, fallbackShiftId: null, record: exception };
  }
  throw refundError(400, "POS_REFUND_SOURCE_REQUIRED");
}

async function heldBySource(client, context, sourceType, sourceId, excludeRefundId = null) {
  return dec((await client.query(
    `SELECT COALESCE(sum(CASE WHEN refund.status = 'refunded' THEN refund.authorized_amount ELSE
              (SELECT COALESCE(sum(component.allocated_amount), 0) FROM tenant.payment_refund_components component
                WHERE component.organization_id = refund.organization_id AND component.refund_id = refund.id AND component.status NOT IN ('failed', 'cancelled')) END), 0)::text AS held,
            COALESCE(sum(CASE WHEN refund.status IN ('draft', 'awaiting_approval') THEN refund.authorized_amount ELSE 0 END), 0)::text AS unapproved
       FROM tenant.payment_refunds refund WHERE refund.organization_id=$1 AND refund.source_type=$2 AND refund.source_id=$3 AND refund.status <> 'cancelled' AND ($4::uuid IS NULL OR refund.id <> $4)`,
    [context.organizationId, sourceType, sourceId, excludeRefundId])).rows[0].held) + 0n;
}
async function paidBySource(client, context, sourceType, sourceId) {
  return dec((await client.query(
    `SELECT COALESCE(sum(component.successful_amount), 0)::text AS paid FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE refund.organization_id=$1 AND refund.source_type=$2 AND refund.source_id=$3`, [context.organizationId, sourceType, sourceId])).rows[0].paid);
}
// Every component of every refund that is not failed / cancelled reserves the tender; the remainder is what may still be refunded to it.
async function tenderCapacity(client, context, payment) {
  const reserved = dec((await client.query(`SELECT COALESCE(sum(allocated_amount), 0)::text AS s FROM tenant.payment_refund_components WHERE organization_id=$1 AND payment_id=$2 AND status NOT IN ('failed', 'cancelled')`,
    [context.organizationId, payment.id])).rows[0].s);
  // Refunds made before this ledger existed (on the payment itself, with no component) count too.
  const legacy = dec((await client.query(`SELECT COALESCE(sum(refund_amount), 0)::text AS s FROM tenant.pos_return_payment_refunds WHERE organization_id=$1 AND payment_id=$2 AND refund_component_id IS NULL AND status <> 'failed'`,
    [context.organizationId, payment.id])).rows[0].s);
  const left = sub(sub(dec(payment.amount), reserved), legacy);
  return left > 0n ? left : 0n;
}
const executionOf = (payment) => (payment.payment_method === "cash" ? "cash" : MANUAL_PROVIDERS.includes(payment.provider_key) ? "manual" : "provider");

// The split of an amount across the source's tenders, by the company's policy, never beyond each tender's remaining capacity.
async function allocate(client, context, source, amount) {
  if (source.type === "payment_exception") {
    const exception = source.exception;
    const payment = exception.payment_id ? (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [context.organizationId, exception.payment_id])).rows[0] : null;
    const providerKey = exception.provider_key ?? payment?.provider_key ?? null;
    return [{ payment: null, method: payment?.payment_method ?? "upi", amount, execution: MANUAL_PROVIDERS.includes(providerKey) ? "manual" : "provider", providerKey,
      providerReference: exception.provider_reference ?? payment?.provider_reference ?? null }];
  }
  const legs = [];
  for (const payment of source.payments) legs.push({ ...payment, refunded_amount: asDatabaseDecimal(sub(dec(payment.amount), await tenderCapacity(client, context, payment))) });
  const { shares } = await allocateReturnRefund(client, context, legs, amount);
  const total = shares.reduce((sum, share) => add(sum, share), 0n);
  if (total !== amount) throw refundError(409, "POS_REFUND_EXCEEDS_PAYMENT", `Only ${money(asDatabaseDecimal(total))} is left on the original payments.`);
  return source.payments.map((payment, index) => ({ payment, method: payment.payment_method, amount: shares[index], execution: executionOf(payment), providerKey: payment.provider_key,
    providerReference: payment.provider_reference })).filter((entry) => entry.amount > 0n);
}

// ------------------------------------------------------------------ eligibility and preview

async function eligibilityOf(client, context, source) {
  const held = await heldBySource(client, context, source.type, source.id);
  const paid = await paidBySource(client, context, source.type, source.id);
  const remaining = sub(source.value, held);
  const tenders = [];
  for (const payment of source.payments) {
    const capacity = await tenderCapacity(client, context, payment);
    tenders.push({ paymentId: payment.id, method: payment.payment_method, taken: money(payment.amount), refundable: money(asDatabaseDecimal(capacity)), route: executionOf(payment),
      card: payment.card_last_four ? `•••• ${payment.card_last_four}` : null, reference: payment.provider_transaction_reference ? `UTR …${String(payment.provider_transaction_reference).slice(-4)}` : null });
  }
  const policy = (await client.query(`SELECT refund_allocation_policy FROM tenant.pos_settings WHERE organization_id=$1`, [context.organizationId])).rows[0]?.refund_allocation_policy ?? "proportional";
  return { sourceType: source.type, sourceId: source.id, reference: source.reference, currency: source.currency, authorizedValue: money(asDatabaseDecimal(source.value)),
    alreadyHeld: money(asDatabaseDecimal(held)), alreadyRefunded: money(asDatabaseDecimal(paid)), remaining: money(asDatabaseDecimal(remaining > 0n ? remaining : 0n)),
    refundEligible: remaining > 0n, allocationPolicy: policy === "electronic_first" ? "ELECTRONIC_FIRST" : "ORIGINAL_TENDER_PROPORTIONAL", tenders };
}

export async function getPosRefundEligibility(client, context, sourceType, sourceId) {
  requirePermission(context, "pos.view");
  const source = await sourceOf(client, context, sourceType, sourceId);
  if (source.storeId) await assertPosStoreAccess(client, context, source.storeId);
  return eligibilityOf(client, context, source);
}

// The split a refund of `amount` (default: everything still refundable) would take — nothing is reserved, paid or approved.
export async function previewPosRefund(client, context, sourceType, sourceId, input = {}) {
  requirePermission(context, "pos.view");
  const source = await sourceOf(client, context, sourceType, sourceId);
  if (source.storeId) await assertPosStoreAccess(client, context, source.storeId);
  const eligibility = await eligibilityOf(client, context, source);
  const amount = input.amount ? dec(input.amount) : dec(eligibility.remaining);
  if (amount <= 0n) return { ...eligibility, amount: money("0"), components: [], approvalRequired: false };
  if (amount > dec(eligibility.remaining)) throw refundError(409, "POS_REFUND_EXCEEDS_SOURCE", `${eligibility.remaining} is still refundable.`);
  const components = await allocate(client, context, source, amount);
  const within = await withinLimit(client, context, source.storeId, amount);
  return { ...eligibility, amount: money(asDatabaseDecimal(amount)), components: components.map((entry) => ({ method: entry.method.toUpperCase(), amount: money(asDatabaseDecimal(entry.amount)), route: entry.execution })),
    approvalRequired: !within };
}

async function withinLimit(client, context, storeId, amount) {
  if (administrator(context)) return true;
  const decision = await authorizePosAction(client, context, { permission: "REFUND_INITIATE", outletId: storeId ?? undefined, amount: asDatabaseDecimal(amount) });
  if (decision.decision === "ALLOW") return true;
  if (decision.decision === "REQUIRES_APPROVAL") return false;
  throw refundError(403, "POS_REFUND_PERMISSION_DENIED", decision.message ?? "");
}

// ------------------------------------------------------------------ creating and authorizing

// Create a refund for a source. input: amount (default everything still refundable), reasonCode, reasonNote, idempotencyKey,
// preApproved (internal: the source's own approval already covered this refund, e.g. a return approved for its refund limit).
export async function createPosRefund(client, context, sourceType, sourceId, input = {}) {
  requirePermission(context, "pos.view");
  const key = String(input.idempotencyKey ?? "").trim();
  if (key.length < 8) throw posError(400, "An idempotency key is required.", "IDEMPOTENCY_KEY_REQUIRED");
  const fingerprint = createHash("sha256").update(JSON.stringify([sourceType, sourceId, input.amount ?? null, input.reasonCode ?? null])).digest("hex").slice(0, 16);
  const replay = (await client.query(`SELECT * FROM tenant.payment_refunds WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, key])).rows[0];
  if (replay) {
    // The same key is the same request: another source, amount or reason under it is refused.
    if (replay.source_type !== sourceType || replay.source_id !== sourceId || String(replay.approval_note ?? "").split("|")[0] !== `fp:${fingerprint}`)
      throw refundError(409, "POS_REFUND_IDEMPOTENCY_CONFLICT");
    return { ...(await getPosRefund(client, context, replay.id)), replayed: true };
  }
  const source = await sourceOf(client, context, sourceType, sourceId, { lock: true });
  if (source.storeId) await assertPosStoreAccess(client, context, source.storeId);
  const held = await heldBySource(client, context, source.type, source.id);
  const remaining = sub(source.value, held);
  if (input.amount === undefined && remaining <= 0n) throw refundError(409, "POS_REFUND_EXCEEDS_SOURCE", "Nothing is left to refund on this source.");
  const amountText = input.amount ?? asDatabaseDecimal(remaining);
  if (!/^\d+(\.\d{1,6})?$/.test(String(amountText)) || dec(amountText) <= 0n) throw refundError(400, "POS_REFUND_AMOUNT_INVALID");
  const amount = dec(amountText);
  if (amount > remaining) throw refundError(409, "POS_REFUND_EXCEEDS_SOURCE", `${money(asDatabaseDecimal(remaining > 0n ? remaining : 0n))} is still refundable.`);
  const reason = String(input.reasonCode ?? source.reason).toLowerCase();
  if (!["return_refund", "duplicate_payment", "excess_payment", "checkout_failure", "payment_reversal", "other"].includes(reason)) throw refundError(400, "POS_REFUND_SOURCE_INVALID", "Unknown refund reason.");
  const note = input.reasonNote ? String(input.reasonNote).trim().slice(0, 300) || null : null;
  if (reason === "other" && !note) throw posError(400, "Explain the refund.", "POS_REFUND_REASON_REQUIRED");
  const approvalRequired = input.preApproved ? false : !(await withinLimit(client, context, source.storeId, amount));
  const components = await allocate(client, context, source, amount);
  const number = await nextDocumentNumber(client, context, { documentType: "pos_refund", prefix: "RF" });
  const refund = (await client.query(
    `INSERT INTO tenant.payment_refunds (organization_id, store_id, refund_number, source_type, source_id, sale_id, original_payment_id, authorized_amount, currency_code, status, reason_code,
       reason_note, approval_required, approval_note, idempotency_key, created_by, authorized_by, authorized_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CASE WHEN $10='authorized' THEN $16::uuid END,CASE WHEN $10='authorized' THEN now() END) RETURNING *`,
    [context.organizationId, source.storeId, number, source.type, source.id, source.saleId, source.type === "checkout_failure" ? source.id : null, asDatabaseDecimal(amount), source.currency,
      approvalRequired ? "awaiting_approval" : "authorized", reason, note, approvalRequired, `fp:${fingerprint}`, key, context.userId])).rows[0];
  let index = 0;
  for (const entry of components) {
    index += 1;
    try {
      await client.query(
        `INSERT INTO tenant.payment_refund_components (organization_id, refund_id, payment_id, refund_method, allocated_amount, execution, provider_key, provider_reference, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [context.organizationId, refund.id, entry.payment?.id ?? null, entry.method, asDatabaseDecimal(entry.amount), entry.execution, entry.providerKey ?? null, entry.providerReference ?? null,
          `${refund.id}:component:${index}`]);
    } catch (error) {
      if (error.constraint === "payment_refund_component_capacity") throw refundError(409, "POS_REFUND_EXCEEDS_PAYMENT");
      throw error;
    }
  }
  if (source.type === "payment_exception") await client.query(`UPDATE tenant.pos_payment_exceptions SET refund_id=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, source.id, refund.id]);
  await event(client, context, "refund", refund.id, "pos.refund.created", { sourceType, sourceId, amount: asDatabaseDecimal(amount), approvalRequired });
  return getPosRefund(client, context, refund.id);
}

async function lockRefund(client, context, refundId) {
  const refund = (await client.query(`SELECT * FROM tenant.payment_refunds WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, refundId])).rows[0];
  if (!refund) throw refundError(404, "POS_REFUND_NOT_FOUND");
  if (refund.store_id) await assertPosStoreAccess(client, context, refund.store_id);
  return refund;
}
const checkVersion = (refund, expected) => { if (expected !== undefined && expected !== null && Number(expected) !== Number(refund.version)) throw refundError(409, "POS_REFUND_VERSION_CONFLICT"); };

// A supervisor approves exactly this version of the refund: not the requester; holding APPROVE_REFUND_EXCEPTION with a limit covering it.
export async function approvePosRefund(client, context, refundId, input = {}) {
  requirePermission(context, "pos.view");
  const refund = await lockRefund(client, context, refundId);
  checkVersion(refund, input.expectedVersion);
  if (refund.status !== "awaiting_approval") throw refundError(409, "POS_REFUND_APPROVAL_INVALID", `This refund is ${refund.status.replace(/_/g, " ")}.`);
  if (refund.created_by === context.userId) throw refundError(403, "POS_REFUND_SELF_APPROVAL");
  if (!administrator(context)) {
    const decision = await authorizePosAction(client, context, { permission: "APPROVE_REFUND_EXCEPTION", outletId: refund.store_id ?? undefined, amount: refund.authorized_amount });
    if (decision.decision !== "ALLOW") throw refundError(403, "POS_REFUND_PERMISSION_DENIED", "Approving needs APPROVE_REFUND_EXCEPTION covering this amount.");
  }
  await client.query(`UPDATE tenant.payment_refunds SET status='authorized', authorized_by=$3, authorized_at=now(), approved_version=version+1, version=version+1, updated_at=now(),
      approval_note=concat_ws('|', split_part(COALESCE(approval_note, ''), '|', 1), $4::text) WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, refund.id, context.userId, input.note ? String(input.note).slice(0, 300) : null]);
  await event(client, context, "refund", refund.id, "pos.refund.approved", { note: input.note ?? null });
  return getPosRefund(client, context, refund.id);
}

// ------------------------------------------------------------------ executing

// The drawer a cash refund comes from: the payer's open session at the outlet, else the source's session if it is still open.
async function cashSessionFor(client, context, storeId, fallbackShiftId) {
  const own = (await client.query(`SELECT id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND store_id=$2 AND cashier_user_id=$3 AND status='open' AND lifecycle_status='OPEN'
      AND EXISTS (SELECT 1 FROM tenant.pos_cash_sessions cash WHERE cash.organization_id = pos_shifts.organization_id AND cash.id = pos_shifts.cash_session_id AND cash.status = 'open')
      ORDER BY opened_at DESC LIMIT 1`,
    [context.organizationId, storeId, context.userId])).rows[0];
  if (own) return own;
  if (!fallbackShiftId) return null;
  return (await client.query(`SELECT id, terminal_id FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2 AND store_id=$3 AND status='open' AND lifecycle_status='OPEN'
      AND EXISTS (SELECT 1 FROM tenant.pos_cash_sessions cash WHERE cash.organization_id = pos_shifts.organization_id AND cash.id = pos_shifts.cash_session_id AND cash.status = 'open')`, [context.organizationId, fallbackShiftId, storeId])).rows[0] ?? null;
}

async function nextAttempt(client, context, component, execution, extra = {}) {
  const number = Number((await client.query(`SELECT COALESCE(max(attempt_number), 0)::int AS n FROM tenant.payment_refund_attempts WHERE organization_id=$1 AND component_id=$2`,
    [context.organizationId, component.id])).rows[0].n) + 1;
  return (await client.query(
    `INSERT INTO tenant.payment_refund_attempts (organization_id, component_id, attempt_number, amount, currency_code, execution, provider_key, idempotency_key, status, requested_by,
       cash_movement_id, provider_refund_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [context.organizationId, component.id, number, component.allocated_amount, extra.currency ?? "INR", execution, component.provider_key ?? null, `${component.idempotency_key}:attempt:${number}`,
      extra.status ?? "submitted", context.userId, extra.cashMovementId ?? null, extra.providerRefundId ?? null])).rows[0];
}

// The component's new state, mirrored on the return's refund ledger (read by accounting and the return receipt) and on the payment.
async function setComponent(client, context, component, status, extra = {}) {
  const succeeded = status === "succeeded";
  const saved = (await client.query(
    `UPDATE tenant.payment_refund_components SET status=$3, successful_amount=CASE WHEN $3='succeeded' THEN allocated_amount ELSE successful_amount END,
            provider_refund_id=COALESCE($4, provider_refund_id), card_refund_id=COALESCE($5, card_refund_id), cash_session_id=COALESCE($6, cash_session_id), cash_movement_id=COALESCE($7, cash_movement_id),
            last_error_code=$8, last_error_message=$9, confirmed_by=COALESCE($10, confirmed_by), resolved_at=CASE WHEN $3 IN ('succeeded','failed','cancelled') THEN now() ELSE NULL END,
            version=version+1, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, component.id, status, extra.providerRefundId ?? null, extra.cardRefundId ?? null, extra.cashSessionId ?? null, extra.cashMovementId ?? null,
      extra.errorCode ?? null, extra.errorMessage ? String(extra.errorMessage).slice(0, 300) : null, extra.confirmedBy ?? null])).rows[0];
  if (saved.return_payment_refund_id) {
    const ledger = succeeded ? "completed" : status === "failed" ? "failed" : status === "cancelled" ? null : "pending";
    if (ledger) await client.query(`UPDATE tenant.pos_return_payment_refunds SET status=$3, provider_reference=COALESCE($4, provider_reference), cash_movement_id=COALESCE($5, cash_movement_id),
        confirmed_by=COALESCE($6, confirmed_by), confirmed_at=CASE WHEN $3='completed' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END, updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND status <> 'completed'`, [context.organizationId, saved.return_payment_refund_id, ledger, saved.provider_refund_id, saved.cash_movement_id, extra.confirmedBy ?? null]);
  }
  // Exceptions follow the outcome: unknown opens one, a definitive outcome closes it.
  if (status === "unknown") await openException(client, context, saved, "unknown_outcome", "The provider's answer did not arrive; the refund may or may not have been made.");
  if (status === "failed") await openException(client, context, saved, "provider_failed", extra.errorMessage ?? "The refund failed.");
  if (["succeeded", "cancelled"].includes(status) || (status === "failed" && extra.resolvesUnknown)) {
    await client.query(`UPDATE tenant.refund_reconciliation_exceptions SET status='resolved', resolution=COALESCE(resolution, $3), resolved_at=now(), updated_at=now()
        WHERE organization_id=$1 AND component_id=$2 AND status <> 'resolved' AND exception_type IN ('unknown_outcome', 'manual_refund_required'${status === "succeeded" ? ", 'provider_failed'" : ""})`,
      [context.organizationId, saved.id, `Resolved: refund ${status}.`]);
  }
  return saved;
}

async function openException(client, context, component, type, detail) {
  await client.query(`INSERT INTO tenant.refund_reconciliation_exceptions (organization_id, refund_id, component_id, exception_type, detail) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT DO NOTHING`, [context.organizationId, component.refund_id, component.id, type, String(detail ?? "").slice(0, 300)]);
}

async function payCash(client, context, refund, component, shift) {
  if (!shift) throw refundError(409, "POS_REFUND_CASH_SESSION_REQUIRED");
  const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, component.payment_id])).rows[0];
  const number = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
  // One movement per component, whatever the retries: the idempotency key is the component's.
  const inserted = (await client.query(
    `INSERT INTO tenant.pos_cash_movements (organization_id, shift_id, movement_number, movement_type, amount, reason, reference_type, reference_id, created_by, cash_event, payment_id,
       terminal_id, store_id, currency_code, idempotency_key)
     VALUES ($1,$2,$3,'refund',$4,$5,$6,$7,$8,'cash_refund_paid',$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING id`,
    [context.organizationId, shift.id, number, asDatabaseDecimal(sub(0n, dec(component.allocated_amount))), `Refund ${refund.refund_number}`,
      refund.source_type === "pos_return" ? "pos_return" : "payment_refund", refund.source_type === "pos_return" ? refund.source_id : refund.id, context.userId, payment.id,
      shift.terminal_id ?? null, refund.store_id, refund.currency_code, `refund:${component.id}:cash`])).rows[0];
  const movementId = inserted?.id ?? (await client.query(`SELECT id FROM tenant.pos_cash_movements WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, `refund:${component.id}:cash`])).rows[0]?.id;
  if (inserted) {
    const refunded = add(dec(payment.refunded_amount), dec(component.allocated_amount));
    await client.query(`UPDATE tenant.pos_payments SET refunded_amount=$3, status=$4, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, payment.id, asDatabaseDecimal(refunded), refunded >= dec(payment.amount) ? "refunded" : "partially_refunded"]);
  }
  await nextAttempt(client, context, component, "cash", { status: "succeeded", cashMovementId: movementId, currency: refund.currency_code });
  await setComponent(client, context, component, "succeeded", { cashSessionId: shift.id, cashMovementId: movementId, confirmedBy: context.userId });
  await event(client, context, "refund", refund.id, "pos.refund.cash_paid", { componentId: component.id, amount: money(component.allocated_amount), sessionId: shift.id });
}

// One provider attempt for a component, inside a savepoint: a refusal or a lost answer is recorded on the attempt and the component; the
// refund itself is never undone.
async function submitProvider(client, context, refund, component, outcome) {
  const attempt = await nextAttempt(client, context, component, "provider", { currency: refund.currency_code });
  await client.query("SAVEPOINT pos_refund_provider");
  let result = null;
  let failure = null;
  try {
    if (component.payment_id) {
      result = await refundPosCardPayment(client, context, component.payment_id, { amount: component.allocated_amount, reason: refund.reason_note ?? `Refund ${refund.refund_number}`,
        returnId: refund.source_type === "pos_return" ? refund.source_id : null, idempotencyKey: attempt.idempotency_key, outcome, authorizedByReturn: true });
    } else {
      const answer = await resolvePaymentAdapter(component.provider_key).refund(context, { providerReference: component.provider_reference, amount: component.allocated_amount,
        currency: refund.currency_code, outcome });
      result = { refund: { id: null, status: ["refunded", "succeeded"].includes(answer.status) ? "REFUND_SUCCEEDED" : answer.status === "failed" ? "REFUND_FAILED" : "REFUND_PROCESSING",
        providerRefundReference: answer.providerRefundReference ?? null } };
    }
    await client.query("RELEASE SAVEPOINT pos_refund_provider");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT pos_refund_provider");
    failure = error;
  }
  if (result) {
    const status = { REFUND_SUCCEEDED: "succeeded", REFUND_FAILED: "failed", REFUND_UNKNOWN: "unknown", REFUND_RECONCILIATION_REQUIRED: "unknown" }[result.refund.status] ?? "processing";
    const providerRefundId = result.refund.providerRefundReference ?? null;
    await client.query(`UPDATE tenant.payment_refund_attempts SET status=$3, provider_refund_id=$4, card_refund_id=$5, responded_at=now(), error_message=$6 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, attempt.id, status, providerRefundId, result.refund.id ?? null, result.refund.failureMessage ?? null]);
    if (result.refund.id) await client.query(`UPDATE tenant.pos_card_refunds SET refund_component_id=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, result.refund.id, component.id]);
    await setComponent(client, context, component, status === "submitted" ? "processing" : status, { providerRefundId, cardRefundId: result.refund.id ?? null,
      errorCode: status === "failed" ? "POS_REFUND_PROVIDER_FAILED" : null, errorMessage: result.refund.failureMessage ?? null });
    return status;
  }
  // A refusal before anything was sent (refunds disabled, standalone, …) fails the attempt; a lost answer leaves it unknown.
  const unknown = Boolean(failure.timeout);
  await client.query(`UPDATE tenant.payment_refund_attempts SET status=$3, error_code=$4, error_message=$5, responded_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, attempt.id, unknown ? "unknown" : "failed", failure.code ?? null, String(failure.message ?? "").slice(0, 300)]);
  await setComponent(client, context, component, unknown ? "unknown" : "failed", { errorCode: failure.code ?? "POS_REFUND_PROVIDER_FAILED", errorMessage: failure.message });
  return unknown ? "unknown" : "failed";
}

// Execute an authorized refund: each pending component by its route. input: cashPayoutConfirmed (the cash is handed over now — else the
// cash component waits for that confirmation), expectedVersion, idempotencyKey, outcome (sandbox scripting only), fallbackShiftId (internal).
export async function executePosRefund(client, context, refundId, input = {}) {
  requirePermission(context, "pos.view");
  const refund = await lockRefund(client, context, refundId);
  checkVersion(refund, input.expectedVersion);
  if (["refunded"].includes(refund.status)) throw refundError(409, "POS_REFUND_ALREADY_COMPLETED");
  if (refund.status === "awaiting_approval") throw refundError(409, "POS_REFUND_APPROVAL_REQUIRED");
  if (refund.status === "cancelled" || refund.status === "draft") throw refundError(409, "POS_REFUND_SOURCE_INVALID", `This refund is ${refund.status}.`);
  if (!(await allowedToPay(client, context, refund))) throw refundError(403, "POS_REFUND_PERMISSION_DENIED");
  const components = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 AND status='pending' ORDER BY created_at, id FOR UPDATE`,
    [context.organizationId, refund.id])).rows;
  const source = await sourceOf(client, context, refund.source_type, refund.source_id).catch(() => null);
  for (const component of components) {
    if (component.execution === "cash") {
      if (input.cashPayoutConfirmed) await payCash(client, context, refund, component, await cashSessionFor(client, context, refund.store_id, input.fallbackShiftId ?? source?.fallbackShiftId ?? null));
    } else if (component.execution === "provider") {
      await submitProvider(client, context, refund, component, input.outcome);
    } else {
      await openException(client, context, component, "manual_refund_required", "This payment cannot be refunded through the provider: refund it outside and record the reference.");
    }
  }
  await client.query(`UPDATE tenant.payment_refunds SET executed_by=COALESCE(executed_by, $3), executed_at=COALESCE(executed_at, now()) WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, refund.id, context.userId]);
  await recomputeRefund(client, context, refund.id);
  await event(client, context, "refund", refund.id, "pos.refund.executed", { components: components.length });
  return getPosRefund(client, context, refund.id);
}

async function allowedToPay(client, context, refund) {
  if (administrator(context)) return true;
  const decision = await authorizePosAction(client, context, { permission: "REFUND_INITIATE", outletId: refund.store_id ?? undefined,
    amount: refund.approval_required ? undefined : refund.authorized_amount });
  return decision.decision === "ALLOW";
}

// Cash handed to the customer for a waiting cash component (from the payer's open session). Once: a repeated confirmation finds it paid.
export async function confirmPosRefundCash(client, context, refundId, input = {}) {
  requirePermission(context, "pos.view");
  const refund = await lockRefund(client, context, refundId);
  if (!["processing", "partially_refunded", "authorized", "failed_action_required", "reconciliation_required"].includes(refund.status)) {
    if (refund.status === "refunded") throw refundError(409, "POS_REFUND_ALREADY_COMPLETED");
    throw refundError(409, "POS_REFUND_SOURCE_INVALID", `This refund is ${refund.status.replace(/_/g, " ")}.`);
  }
  if (!(await allowedToPay(client, context, refund))) throw refundError(403, "POS_REFUND_PERMISSION_DENIED");
  const components = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 AND execution='cash' AND status='pending' AND ($3::uuid IS NULL OR id=$3) FOR UPDATE`,
    [context.organizationId, refund.id, input.componentId ?? null])).rows;
  if (!components.length) throw refundError(409, "POS_REFUND_ALREADY_COMPLETED", "No cash is waiting to be paid on this refund.");
  const source = await sourceOf(client, context, refund.source_type, refund.source_id).catch(() => null);
  const shift = await cashSessionFor(client, context, refund.store_id, input.fallbackShiftId ?? source?.fallbackShiftId ?? null);
  for (const component of components) await payCash(client, context, refund, component, shift);
  await recomputeRefund(client, context, refund.id);
  return getPosRefund(client, context, refund.id);
}

// A refund made outside the provider (standalone machine, static QR, or an unknown outcome Finance has confirmed) recorded with its
// reference. Reconciliation users only.
export async function recordPosManualRefund(client, context, refundId, input = {}) {
  requirePermission(context, "pos.view");
  if (!reconciler(context)) throw refundError(403, "POS_REFUND_PERMISSION_DENIED", "Recording a refund made outside the provider needs reconciliation rights.");
  const refund = await lockRefund(client, context, refundId);
  const component = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 AND id=$3 FOR UPDATE`, [context.organizationId, refund.id, input.componentId])).rows[0];
  if (!component || !["pending", "unknown", "failed"].includes(component.status) || component.execution === "cash") throw refundError(409, "POS_REFUND_SOURCE_INVALID", "That component is not waiting for a manual refund.");
  const reference = String(input.reference ?? "").trim();
  if (!reference) throw refundError(400, "POS_REFUND_REFERENCE_REQUIRED");
  await nextAttempt(client, context, component, "manual", { status: "succeeded", providerRefundId: reference.slice(0, 80), currency: refund.currency_code });
  if (component.payment_id) {
    const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, component.payment_id])).rows[0];
    const refunded = add(dec(payment.refunded_amount), dec(component.allocated_amount));
    await client.query(`UPDATE tenant.pos_payments SET refunded_amount=$3, status=$4, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, payment.id, asDatabaseDecimal(refunded), refunded >= dec(payment.amount) ? "refunded" : "partially_refunded"]);
  }
  await setComponent(client, context, component, "succeeded", { providerRefundId: `manual:${reference.slice(0, 72)}`, confirmedBy: context.userId });
  await event(client, context, "refund", refund.id, "pos.refund.recorded_manually", { componentId: component.id, reference });
  await recomputeRefund(client, context, refund.id);
  return getPosRefund(client, context, refund.id);
}

// Ask providers again about components still processing or unknown; a definitive answer settles them.
export async function refreshPosRefund(client, context, refundId) {
  requirePermission(context, "pos.view");
  const refund = await lockRefund(client, context, refundId);
  const components = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 AND status IN ('submitted','processing','unknown') FOR UPDATE`,
    [context.organizationId, refund.id])).rows;
  for (const component of components) {
    if (!component.card_refund_id) continue;
    const answer = await getPosCardRefund(client, context, component.card_refund_id).catch(() => null);
    const status = { REFUND_SUCCEEDED: "succeeded", REFUND_FAILED: "failed" }[answer?.status] ?? null;
    if (status && status !== component.status) {
      await client.query(`UPDATE tenant.payment_refund_attempts SET status=$3, responded_at=now() WHERE organization_id=$1 AND component_id=$2 AND card_refund_id=$4 AND status NOT IN ('succeeded','failed','cancelled')`,
        [context.organizationId, component.id, status, component.card_refund_id]);
      await setComponent(client, context, component, status, { resolvesUnknown: component.status === "unknown", errorMessage: status === "failed" ? answer.failureMessage : null });
    }
  }
  await recomputeRefund(client, context, refund.id);
  return getPosRefund(client, context, refund.id);
}

// Try a definitively failed component again (a new attempt). Unknown and processing components are never sent again.
export async function retryPosRefundComponent(client, context, refundId, input = {}) {
  requirePermission(context, "pos.view");
  await refreshPosRefund(client, context, refundId);
  const refund = await lockRefund(client, context, refundId);
  if (!(await allowedToPay(client, context, refund))) throw refundError(403, "POS_REFUND_PERMISSION_DENIED");
  const components = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 AND ($3::uuid IS NULL OR id=$3) AND execution='provider' FOR UPDATE`,
    [context.organizationId, refund.id, input.componentId ?? null])).rows;
  const failed = components.filter((component) => component.status === "failed");
  if (!failed.length) {
    if (components.some((component) => component.status === "unknown")) throw refundError(409, "POS_REFUND_OUTCOME_UNKNOWN");
    if (components.some((component) => ["submitted", "processing"].includes(component.status))) throw refundError(409, "POS_REFUND_PROVIDER_PENDING");
    throw refundError(409, "POS_REFUND_ALREADY_COMPLETED", "Nothing has failed on this refund.");
  }
  for (const component of failed) {
    // The failed reservation is taken again (capacity is checked once more by the database).
    try { await client.query(`UPDATE tenant.payment_refund_components SET status='pending', version=version+1, updated_at=now() WHERE id=$1`, [component.id]); }
    catch (error) { if (error.constraint === "payment_refund_component_capacity") throw refundError(409, "POS_REFUND_EXCEEDS_PAYMENT"); throw error; }
    await submitProvider(client, context, refund, { ...component, status: "pending" }, input.outcome);
  }
  await recomputeRefund(client, context, refund.id);
  await event(client, context, "refund", refund.id, "pos.refund.retried", { components: failed.length });
  return getPosRefund(client, context, refund.id);
}

// Cancel a refund before any money moved: its reservation is released. A refund with anything sent or paid cannot be cancelled.
export async function cancelPosRefund(client, context, refundId, input = {}) {
  requirePermission(context, "pos.view");
  const refund = await lockRefund(client, context, refundId);
  checkVersion(refund, input.expectedVersion);
  const components = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 FOR UPDATE`, [context.organizationId, refund.id])).rows;
  if (["refunded", "cancelled"].includes(refund.status) || components.some((component) => !["pending", "failed", "cancelled"].includes(component.status)))
    throw refundError(409, "POS_REFUND_CANCELLATION_NOT_ALLOWED", "Money has already been sent or paid on this refund.");
  if (refund.created_by !== context.userId && !(await allowedToPay(client, context, refund))) throw refundError(403, "POS_REFUND_PERMISSION_DENIED");
  const reason = String(input.reason ?? "").trim();
  if (!reason) throw posError(400, "Say why the refund is cancelled.", "POS_REASON_REQUIRED");
  for (const component of components) if (component.status !== "cancelled") await setComponent(client, context, component, "cancelled");
  await client.query(`UPDATE tenant.payment_refunds SET status='cancelled', cancelled_by=$3, cancelled_at=now(), cancel_reason=$4, version=version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, refund.id, context.userId, reason.slice(0, 300)]);
  await event(client, context, "refund", refund.id, "pos.refund.cancelled", { reason });
  await syncSource(client, context, refund);
  return getPosRefund(client, context, refund.id);
}

// A provider's refund outcome (callback or status poll), applied once: a duplicate changes nothing; a final outcome is never undone by a
// late or out-of-order event; an amount that does not match opens a reconciliation exception.
export async function processPosRefundProviderEvent(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const reference = String(input.providerRefundReference ?? "").trim();
  if (!reference) throw posError(400, "A provider refund reference is required.", "POS_REFUND_REFERENCE_REQUIRED");
  const attempt = (await client.query(`SELECT * FROM tenant.payment_refund_attempts WHERE organization_id=$1 AND provider_refund_id=$2 ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`,
    [context.organizationId, reference])).rows[0];
  if (!attempt) return { applied: false, reason: "unknown_reference" };
  const component = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, attempt.component_id])).rows[0];
  const status = ["refunded", "succeeded"].includes(input.status) ? "succeeded" : input.status === "failed" ? "failed" : "processing";
  const events = [...(attempt.events ?? []), { at: new Date().toISOString(), status: input.status, amount: input.amount ?? null }];
  if (["succeeded", "failed", "cancelled"].includes(attempt.status)) {
    if (attempt.status !== status && status !== "processing") await openException(client, context, component, "duplicate_payout", `A ${status} event arrived for a refund already ${attempt.status}.`);
    await client.query(`UPDATE tenant.payment_refund_attempts SET events=$3::jsonb WHERE organization_id=$1 AND id=$2`, [context.organizationId, attempt.id, JSON.stringify(events)]);
    return { applied: false, reason: "already_final" };
  }
  if (input.amount !== undefined && input.amount !== null && dec(input.amount) !== dec(attempt.amount)) {
    await openException(client, context, component, "amount_mismatch", `The provider reported ${input.amount} for a refund of ${money(attempt.amount)}.`);
    await client.query(`UPDATE tenant.payment_refund_attempts SET events=$3::jsonb WHERE organization_id=$1 AND id=$2`, [context.organizationId, attempt.id, JSON.stringify(events)]);
    await recomputeRefund(client, context, component.refund_id);
    return { applied: false, reason: "amount_mismatch" };
  }
  await client.query(`UPDATE tenant.payment_refund_attempts SET status=$3, events=$4::jsonb, responded_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, attempt.id, status, JSON.stringify(events)]);
  if (attempt.card_refund_id && status !== "processing") {
    const cardRefund = (await client.query(`SELECT * FROM tenant.pos_card_refunds WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, attempt.card_refund_id])).rows[0];
    const payment = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, cardRefund.original_payment_id])).rows[0];
    if (!["succeeded", "failed"].includes(cardRefund.status)) await settlePosCardRefund(client, context, cardRefund, payment, status, null, status === "failed" ? "The provider reported the refund failed." : null);
  }
  if (component.status !== status && !["succeeded", "cancelled"].includes(component.status)) await setComponent(client, context, component, status, { resolvesUnknown: component.status === "unknown" });
  await recomputeRefund(client, context, component.refund_id);
  return { applied: true, status };
}

// The refund's state from its components (never "refunded" while anything is outstanding), and the source kept in step.
async function recomputeRefund(client, context, refundId) {
  const refund = (await client.query(`SELECT * FROM tenant.payment_refunds WHERE organization_id=$1 AND id=$2`, [context.organizationId, refundId])).rows[0];
  if (["cancelled", "refunded", "awaiting_approval", "draft"].includes(refund.status)) return refund.status;
  const components = (await client.query(`SELECT status, execution FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 AND status <> 'cancelled'`, [context.organizationId, refundId])).rows;
  const executed = Boolean(refund.executed_at);
  const succeeded = components.filter((component) => component.status === "succeeded").length;
  let next;
  if (components.some((component) => component.status === "unknown")) next = "reconciliation_required";
  else if (components.some((component) => component.status === "failed")) next = "failed_action_required";
  else if (succeeded === components.length && components.length) next = "refunded";
  else if (succeeded) next = "partially_refunded";
  else if (!executed) next = "authorized";
  else next = "processing";
  if (next !== refund.status) {
    await client.query(`UPDATE tenant.payment_refunds SET status=$3, resolved_at=CASE WHEN $3='refunded' THEN now() ELSE resolved_at END, version=version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, refundId, next]);
    await event(client, context, "refund", refundId, "pos.refund.status", { from: refund.status, to: next });
  }
  await syncSource(client, context, { ...refund, status: next });
  return next;
}

// The source keeps the refund's progress: a return's refund status, a payment exception's state.
async function syncSource(client, context, refund) {
  if (refund.source_type === "pos_return") {
    const status = await returnRefundStatus(client, context, refund.source_id);
    await client.query(`UPDATE tenant.pos_returns SET refund_status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 AND refund_status <> $3`, [context.organizationId, refund.source_id, status]);
  } else if (refund.source_type === "payment_exception") {
    const status = refund.status === "refunded" ? "refunded" : refund.status === "cancelled" ? "open" : "refund_requested";
    await client.query(`UPDATE tenant.pos_payment_exceptions SET status=$3, resolved_at=CASE WHEN $3='refunded' THEN now() ELSE NULL END, updated_at=now() WHERE organization_id=$1 AND id=$2 AND status NOT IN ('resolved')`,
      [context.organizationId, refund.source_id, status]);
  } else if (refund.source_type === "checkout_failure") {
    const status = refund.status === "refunded" ? "refunded" : refund.status === "cancelled" ? "finalization_failed" : "refund_requested";
    await client.query(`UPDATE tenant.pos_payments SET recovery_status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [context.organizationId, refund.source_id, status]);
  }
}

// A return's refund status across all its refunds' components (cash waiting for its payout is "pending").
export async function returnRefundStatus(client, context, returnId) {
  const rows = (await client.query(
    `SELECT component.status, component.execution, refund.status AS refund_status FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE refund.organization_id=$1 AND refund.source_type='pos_return' AND refund.source_id=$2 AND refund.status <> 'cancelled' AND component.status <> 'cancelled'`,
    [context.organizationId, returnId])).rows;
  if (!rows.length) return "not_initiated";
  const states = rows.map((row) => (row.refund_status === "awaiting_approval" ? "pending" : row.status === "succeeded" ? "succeeded" : row.status === "failed" ? "failed"
    : row.status === "unknown" ? "unknown" : row.status === "pending" ? "pending" : "processing"));
  if (states.includes("failed")) return "failed";
  if (states.includes("unknown")) return "unknown";
  if (states.every((state) => state === "succeeded")) return "succeeded";
  if (states.some((state) => state === "succeeded")) return states.includes("processing") ? "processing" : "partially_refunded";
  return states.includes("processing") ? "processing" : "pending";
}

// ------------------------------------------------------------------ reading

const COMPONENT_LABEL = { pending: "Refund approved", submitted: "Refund initiated", processing: "Refund processing", succeeded: "Refund processed", failed: "Refund unsuccessful; action required",
  unknown: "Refund status being checked", cancel_pending: "Cancellation requested", cancelled: "Cancelled" };
const componentView = (row) => ({
  id: row.id, paymentId: row.payment_id, method: String(row.refund_method).toUpperCase(), route: row.execution, amount: money(row.allocated_amount), paid: money(row.successful_amount),
  status: String(row.status).toUpperCase(), customerStatus: row.execution === "cash" ? (row.status === "succeeded" ? "Cash refund paid" : row.status === "pending" ? "Cash to be paid at the counter" : COMPONENT_LABEL[row.status])
    : row.execution === "manual" && row.status === "pending" ? "To be refunded by the store" : COMPONENT_LABEL[row.status],
  providerReference: row.provider_refund_id ? `…${String(row.provider_refund_id).slice(-8)}` : null, error: row.last_error_message ?? null, resolvedAt: row.resolved_at,
});

export async function getPosRefund(client, context, refundId) {
  requirePermission(context, "pos.view");
  const refund = (await client.query(
    `SELECT refund.*, creator.full_name AS created_by_name, authorizer.full_name AS authorized_by_name, sale.receipt_number, sale.invoice_number,
            CASE WHEN refund.source_type = 'pos_return' THEN (SELECT return_number FROM tenant.pos_returns WHERE organization_id = refund.organization_id AND id = refund.source_id) END AS return_number,
            CASE WHEN refund.source_type = 'pos_return' THEN (SELECT credit_note_number FROM tenant.pos_returns WHERE organization_id = refund.organization_id AND id = refund.source_id) END AS credit_note_number
       FROM tenant.payment_refunds refund LEFT JOIN public.users creator ON creator.id = refund.created_by LEFT JOIN public.users authorizer ON authorizer.id = refund.authorized_by
       LEFT JOIN tenant.pos_sales sale ON sale.organization_id = refund.organization_id AND sale.id = refund.sale_id
      WHERE refund.organization_id=$1 AND refund.id=$2`, [context.organizationId, refundId])).rows[0];
  if (!refund) throw refundError(404, "POS_REFUND_NOT_FOUND");
  if (refund.store_id) await assertPosStoreAccess(client, context, refund.store_id);
  const components = (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 ORDER BY created_at, id`, [context.organizationId, refund.id])).rows;
  const attempts = (await client.query(
    `SELECT attempt.* FROM tenant.payment_refund_attempts attempt JOIN tenant.payment_refund_components component ON component.organization_id = attempt.organization_id AND component.id = attempt.component_id
      WHERE component.organization_id=$1 AND component.refund_id=$2 ORDER BY attempt.requested_at`, [context.organizationId, refund.id])).rows;
  const exceptions = (await client.query(`SELECT * FROM tenant.refund_reconciliation_exceptions WHERE organization_id=$1 AND refund_id=$2 ORDER BY created_at`, [context.organizationId, refund.id])).rows;
  const paid = components.reduce((sum, row) => add(sum, dec(row.successful_amount)), 0n);
  const processing = components.filter((row) => ["submitted", "processing", "unknown"].includes(row.status)).reduce((sum, row) => add(sum, dec(row.allocated_amount)), 0n);
  const waiting = components.filter((row) => row.status === "pending").reduce((sum, row) => add(sum, dec(row.allocated_amount)), 0n);
  return {
    id: refund.id, refundNumber: refund.refund_number, status: String(refund.status).toUpperCase(), version: refund.version, sourceType: refund.source_type, sourceId: refund.source_id,
    returnNumber: refund.return_number ?? null, creditNoteNumber: refund.credit_note_number ?? null, saleId: refund.sale_id, receiptNumber: refund.receipt_number ?? null,
    invoiceNumber: refund.invoice_number ?? null, storeId: refund.store_id, currency: refund.currency_code, reasonCode: refund.reason_code, reasonNote: refund.reason_note,
    authorizedAmount: money(refund.authorized_amount), paid: money(asDatabaseDecimal(paid)), processing: money(asDatabaseDecimal(processing)), waiting: money(asDatabaseDecimal(waiting)),
    outstanding: money(asDatabaseDecimal(sub(dec(refund.authorized_amount), paid))), approvalRequired: refund.status === "AWAITING_APPROVAL" || refund.status === "awaiting_approval",
    createdBy: refund.created_by_name, createdById: refund.created_by, authorizedBy: refund.authorized_by_name, createdAt: refund.created_at, authorizedAt: refund.authorized_at,
    executedAt: refund.executed_at, resolvedAt: refund.resolved_at, cancelReason: refund.cancel_reason,
    components: components.map(componentView),
    attempts: attempts.map((row) => ({ id: row.id, componentId: row.component_id, attempt: row.attempt_number, route: row.execution, amount: money(row.amount), status: String(row.status).toUpperCase(),
      providerReference: row.provider_refund_id ? `…${String(row.provider_refund_id).slice(-8)}` : null, error: row.error_message, requestedAt: row.requested_at, respondedAt: row.responded_at })),
    exceptions: exceptions.map(exceptionView),
  };
}
const exceptionView = (row) => ({ id: row.id, refundId: row.refund_id, componentId: row.component_id, type: String(row.exception_type).toUpperCase(), status: String(row.status).toUpperCase(),
  detail: row.detail, resolution: row.resolution, reference: row.resolution_reference, createdAt: row.created_at, resolvedAt: row.resolved_at });

// Refund history: by refund, return, receipt or invoice number; state; source; method; dates; at the outlets the person may see.
export async function listPosRefunds(client, context, options = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  const where = [];
  const search = String(options.search ?? "").trim();
  if (search) {
    values.push(search);
    where.push(`(refund.refund_number = $${values.length} OR sale.receipt_number = $${values.length} OR sale.invoice_number = $${values.length}
      OR (refund.source_type = 'pos_return' AND refund.source_id IN (SELECT id FROM tenant.pos_returns WHERE organization_id = refund.organization_id AND return_number = $${values.length})))`);
  }
  if (options.status) { values.push(String(options.status).toLowerCase()); where.push(`refund.status = $${values.length}`); }
  if (options.sourceType) { values.push(options.sourceType); where.push(`refund.source_type = $${values.length}`); }
  if (options.sourceId) { values.push(options.sourceId); where.push(`refund.source_id = $${values.length}`); }
  if (options.method) { values.push(String(options.method).toLowerCase()); where.push(`EXISTS (SELECT 1 FROM tenant.payment_refund_components c WHERE c.organization_id = refund.organization_id AND c.refund_id = refund.id AND c.refund_method = $${values.length})`); }
  if (options.outstanding) where.push(`refund.status IN ('awaiting_approval','authorized','processing','partially_refunded','failed_action_required','reconciliation_required')`);
  if (options.dateFrom) { values.push(options.dateFrom); where.push(`refund.created_at >= $${values.length}::date`); }
  if (options.dateTo) { values.push(options.dateTo); where.push(`refund.created_at < $${values.length}::date + 1`); }
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); where.push(`(refund.store_id IS NULL OR refund.store_id = ANY($${values.length}::uuid[]))`); }
  const filter = where.length ? ` AND ${where.join(" AND ")}` : "";
  const limit = Math.min(Number(options.limit) || 25, 100);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const from = `FROM tenant.payment_refunds refund LEFT JOIN tenant.pos_sales sale ON sale.organization_id = refund.organization_id AND sale.id = refund.sale_id`;
  const total = (await client.query(`SELECT count(*)::int AS n ${from} WHERE refund.organization_id=$1${filter}`, values)).rows[0].n;
  const rows = (await client.query(
    `SELECT refund.*, sale.receipt_number, sale.invoice_number, creator.full_name AS created_by_name,
            (SELECT COALESCE(sum(successful_amount), 0) FROM tenant.payment_refund_components c WHERE c.organization_id = refund.organization_id AND c.refund_id = refund.id) AS paid,
            (SELECT string_agg(DISTINCT upper(refund_method), ' + ') FROM tenant.payment_refund_components c WHERE c.organization_id = refund.organization_id AND c.refund_id = refund.id) AS methods
     ${from} LEFT JOIN public.users creator ON creator.id = refund.created_by WHERE refund.organization_id=$1${filter} ORDER BY refund.created_at DESC, refund.id DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return { total, rows: rows.map((row) => ({ id: row.id, refundNumber: row.refund_number, status: String(row.status).toUpperCase(), sourceType: row.source_type, sourceId: row.source_id,
    receiptNumber: row.receipt_number, invoiceNumber: row.invoice_number, authorizedAmount: money(row.authorized_amount), paid: money(row.paid), currency: row.currency_code, methods: row.methods,
    reasonCode: row.reason_code, createdBy: row.created_by_name, createdAt: row.created_at, resolvedAt: row.resolved_at })) };
}

export async function listPosRefundExceptions(client, context, options = {}) {
  requirePermission(context, "pos.view");
  const status = options.status === "all" ? null : options.status ? String(options.status).toLowerCase() : "open";
  const stores = await accessiblePosStoreIds(client, context);
  const rows = (await client.query(
    `SELECT exception.*, refund.refund_number, refund.store_id, component.refund_method, component.allocated_amount FROM tenant.refund_reconciliation_exceptions exception
       JOIN tenant.payment_refunds refund ON refund.organization_id = exception.organization_id AND refund.id = exception.refund_id
       LEFT JOIN tenant.payment_refund_components component ON component.organization_id = exception.organization_id AND component.id = exception.component_id
      WHERE exception.organization_id=$1 AND ($2::text IS NULL OR exception.status = $2) AND ($3::uuid[] IS NULL OR refund.store_id IS NULL OR refund.store_id = ANY($3::uuid[]))
      ORDER BY exception.created_at DESC LIMIT 200`, [context.organizationId, status, stores])).rows;
  return rows.map((row) => ({ ...exceptionView(row), refundNumber: row.refund_number, method: row.refund_method ? String(row.refund_method).toUpperCase() : null, amount: money(row.allocated_amount) }));
}

// Resolve a reconciliation exception with evidence. For an unknown outcome: confirmed refunded (with the provider reference) settles the
// component; confirmed not refunded fails it (its amount is released for a retry). Reconciliation users only.
export async function resolvePosRefundException(client, context, exceptionId, input = {}) {
  requirePermission(context, "pos.view");
  if (!reconciler(context)) throw refundError(403, "POS_REFUND_PERMISSION_DENIED", "Resolving needs reconciliation rights.");
  const exception = (await client.query(`SELECT * FROM tenant.refund_reconciliation_exceptions WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, exceptionId])).rows[0];
  if (!exception) throw posError(404, "Exception not found.", "POS_REFUND_EXCEPTION_NOT_FOUND");
  if (exception.status === "resolved") return exceptionView(exception);
  const note = String(input.note ?? "").trim();
  if (!note) throw posError(400, "Say how it was resolved.", "POS_REASON_REQUIRED");
  const component = exception.component_id ? (await client.query(`SELECT * FROM tenant.payment_refund_components WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, exception.component_id])).rows[0] : null;
  if (component && input.outcome === "refunded" && component.status !== "succeeded") {
    await recordPosManualRefund(client, context, exception.refund_id, { componentId: component.id, reference: input.reference ?? note });
  } else if (component && input.outcome === "not_refunded" && component.status === "unknown") {
    // The provider attempt behind it is settled as failed too, so its amount stops counting against the payment.
    if (component.card_refund_id) {
      const cardRefund = (await client.query(`SELECT * FROM tenant.pos_card_refunds WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, component.card_refund_id])).rows[0];
      const payment = cardRefund ? (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, cardRefund.original_payment_id])).rows[0] : null;
      if (cardRefund && payment && !["succeeded", "failed"].includes(cardRefund.status)) await settlePosCardRefund(client, context, cardRefund, payment, "failed", null, `Confirmed not refunded: ${note}`.slice(0, 300));
    }
    await client.query(`UPDATE tenant.payment_refund_attempts SET status='failed', error_message=$3, responded_at=now() WHERE organization_id=$1 AND component_id=$2 AND status IN ('submitted','processing','unknown')`,
      [context.organizationId, component.id, `Confirmed not refunded: ${note}`.slice(0, 300)]);
    await setComponent(client, context, component, "failed", { errorCode: "POS_REFUND_CONFIRMED_NOT_MADE", errorMessage: `Confirmed not refunded: ${note}`, resolvesUnknown: true });
    await recomputeRefund(client, context, exception.refund_id);
  }
  const saved = (await client.query(`UPDATE tenant.refund_reconciliation_exceptions SET status='resolved', resolution=$3, resolution_reference=$4, resolved_by=$5, resolved_at=now(), updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, exception.id, note.slice(0, 300), input.reference ? String(input.reference).slice(0, 80) : null, context.userId])).rows[0];
  await event(client, context, "refund", exception.refund_id, "pos.refund.exception_resolved", { exceptionId, outcome: input.outcome ?? null });
  return exceptionView(saved);
}

// Refunds over a period: owed, paid, outstanding, processing, failed, unknown; by method, source, outlet, cashier and cash session;
// approvals; average time to complete. A posted return is never counted as a paid refund.
export async function getPosRefundSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(input.from ?? "") ? input.from : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(input.to ?? "") ? input.to : today;
  const values = [context.organizationId, from, to, await accessiblePosStoreIds(client, context)];
  const scope = `refund.organization_id=$1 AND refund.created_at >= $2::date AND refund.created_at < $3::date + 1 AND refund.status <> 'cancelled' AND ($4::uuid[] IS NULL OR refund.store_id IS NULL OR refund.store_id = ANY($4::uuid[]))`;
  const totals = (await client.query(
    `SELECT count(*)::int AS refunds, COALESCE(sum(refund.authorized_amount),0)::text AS authorized,
            COALESCE(sum((SELECT sum(successful_amount) FROM tenant.payment_refund_components c WHERE c.organization_id = refund.organization_id AND c.refund_id = refund.id)),0)::text AS paid,
            count(*) FILTER (WHERE refund.status IN ('processing','partially_refunded'))::int AS processing, count(*) FILTER (WHERE refund.status = 'failed_action_required')::int AS failed,
            count(*) FILTER (WHERE refund.status = 'reconciliation_required')::int AS unknown, count(*) FILTER (WHERE refund.approval_required)::int AS approved,
            COALESCE(avg(EXTRACT(EPOCH FROM (refund.resolved_at - refund.created_at))) FILTER (WHERE refund.resolved_at IS NOT NULL), 0)::numeric(20,0)::text AS average_seconds
       FROM tenant.payment_refunds refund WHERE ${scope}`, values)).rows[0];
  totals.outstanding = asDatabaseDecimal(sub(dec(totals.authorized), dec(totals.paid)));
  const byMethod = (await client.query(
    `SELECT component.refund_method AS method, component.status, count(*)::int AS components, COALESCE(sum(component.allocated_amount),0)::text AS amount, COALESCE(sum(component.successful_amount),0)::text AS paid
       FROM tenant.payment_refunds refund JOIN tenant.payment_refund_components component ON component.organization_id = refund.organization_id AND component.refund_id = refund.id
      WHERE ${scope} GROUP BY 1, 2 ORDER BY 1, 2`, values)).rows;
  const grouped = async (column, join = "") => (await client.query(
    `SELECT COALESCE(${column}, 'not recorded') AS key, count(*)::int AS refunds, COALESCE(sum(refund.authorized_amount),0)::text AS amount FROM tenant.payment_refunds refund ${join}
      WHERE ${scope} GROUP BY 1 ORDER BY 3 DESC LIMIT 20`, values)).rows;
  const cashBySession = (await client.query(
    `SELECT shift.shift_number AS session, count(*)::int AS payouts, COALESCE(sum(component.successful_amount),0)::text AS amount
       FROM tenant.payment_refunds refund JOIN tenant.payment_refund_components component ON component.organization_id = refund.organization_id AND component.refund_id = refund.id
       JOIN tenant.pos_shifts shift ON shift.organization_id = component.organization_id AND shift.id = component.cash_session_id
      WHERE ${scope} AND component.execution = 'cash' AND component.status = 'succeeded' GROUP BY 1 ORDER BY 1`, values)).rows;
  return { from, to, totals, byMethod, bySource: await grouped("refund.source_type"), byReason: await grouped("refund.reason_code"),
    byOutlet: await grouped("store.name", "LEFT JOIN tenant.pos_stores store ON store.organization_id = refund.organization_id AND store.id = refund.store_id"),
    byCashier: await grouped("person.full_name", "LEFT JOIN public.users person ON person.id = refund.created_by"), cashBySession };
}

// ------------------------------------------------------------------ acknowledgement

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const rupee = (value) => `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The refund acknowledgement: what is owed, what each tender's refund really is now, what is confirmed — "as of" the time printed. It is
// not a GST credit note (that is the return's own document) and printing it changes nothing.
export async function renderPosRefundAcknowledgement(client, context, refundId, input = {}) {
  const refund = await getPosRefund(client, context, refundId);
  const store = refund.storeId ? (await client.query(`SELECT name, timezone FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [context.organizationId, refund.storeId])).rows[0] : null;
  const width = [58, 80, 210].includes(Number(input.width)) ? Number(input.width) : 80;
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: store?.timezone || "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const row = (label, value, strong = false) => `<div class="row${strong ? " strong" : ""}"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
  const parts = [`<div class="center strong">${escapeHtml(store?.name ?? "")}</div>`, `<div class="center strong title">REFUND ACKNOWLEDGEMENT</div>`, row("Refund", refund.refundNumber)];
  if (refund.invoiceNumber || refund.receiptNumber) parts.push(row("Original sale", refund.invoiceNumber ?? refund.receiptNumber));
  if (refund.returnNumber) parts.push(row("Return", refund.returnNumber));
  if (refund.creditNoteNumber) parts.push(row("Credit note", refund.creditNoteNumber));
  parts.push(row("Status as of", when), `<div class="rule"></div>`, row("Authorized refund", rupee(refund.authorizedAmount), true), `<div class="rule"></div>`);
  for (const component of refund.components) parts.push(row(`${component.method} ${rupee(component.amount)}`, component.customerStatus));
  parts.push(`<div class="rule"></div>`, row("Confirmed refunded", rupee(refund.paid), true));
  if (Number(refund.outstanding) > 0) parts.push(row("Still outstanding", rupee(refund.outstanding)));
  parts.push(`<div class="small center">Digital refunds can take time to reach the customer's account; this shows each refund as it stands now.</div>`);
  const contentWidth = width === 58 ? "48mm" : width === 80 ? "72mm" : "180mm";
  return { refund, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(refund.refundNumber)}</title><style>
@page { size: ${width === 210 ? "A4" : `${width}mm auto`}; margin: 2mm; } body { margin: 0; font-family: "Courier New", monospace; font-size: 11px; color: #000; background: #fff; }
.doc { width: ${contentWidth}; margin: 0 auto; } .row { display: flex; justify-content: space-between; gap: 6px; } .row span:last-child { text-align: right; } .center { text-align: center; }
.strong { font-weight: 700; } .title { margin: 4px 0; } .small { font-size: 0.85em; margin-top: 4px; } .rule { border-top: 1px dashed #000; margin: 4px 0; }
</style></head><body><section class="doc">${parts.join("")}</section></body></html>` };
}
