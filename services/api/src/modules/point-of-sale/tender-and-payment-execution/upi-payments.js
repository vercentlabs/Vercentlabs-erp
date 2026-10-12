// POS UPI & Digital Payments (migration 0094). The default is a dynamic QR from the outlet's acquiring provider, bound to exactly this
// attempt: the merchant, the amount still due (never a client total), INR and our reference, with the provider's expiry. The customer scans
// it with any UPI app; the sale is finalised only when the provider confirms the payment (verified webhook or status query) — a
// screenshot, an app screen, a speaker sound or a cashier's word never counts, and there is no "mark as paid" for an integrated payment. An
// expired QR is not a failed payment: the provider is asked again, and a new QR is possible only once the old request is cancelled or
// resolved. Payment links (where the provider offers them and the outlet enables them) follow the same lifecycle; the instrument actually
// used (UPI, wallet, netbanking) is kept as reported. UPI intent is offered only where the provider declares it.
//
// Where an administrator enables it and verifies the merchant's own UPI ID, the outlet's static QR can be used: the cashier records the
// UTR and confirms the money arrived; the payment is EXTERNALLY ATTESTED until a settlement matches the UTR (and counts for the sale only
// under provisional acceptance). Money that does not fit — short, excess, duplicate, late, wrong merchant — becomes a payment exception for
// Finance; nothing is waived, applied to another bill or turned into change.
import { add, decimal, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { createPosRefund, executePosRefund, getPosRefund } from "./refunds.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { isTerminalPaymentMethodEnabled } from "../terminals/index.js";
import { assertPosAction } from "../permissions/index.js";
import { ensurePosCheckoutStarted } from "../assortment-pricing-customer-and-cart/cart.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { resolvePaymentAdapter, PaymentAdapterError } from "./adapter.js";
import { assertSplitAllowed, loadCheckout } from "./cash-payments.js";
import { applyProviderStatus, LIVE_ATTEMPT_STATUSES, messageFor } from "./card-status.js";
import { attemptView, finalizeCheckout, outcomeFor } from "./card-payments.js";

export const POS_UPI_MESSAGES = Object.freeze({
  POS_UPI_DISABLED: "UPI payments are not available at this counter.",
  POS_UPI_PROVIDER_NOT_READY: "UPI is not set up for this outlet yet.",
  POS_UPI_MODE_UNSUPPORTED: "This way of paying is not available with the outlet's payment provider.",
  POS_UPI_PAYMENT_IN_PROGRESS: "A payment request on this bill is still open. Check its status or cancel it first.",
  POS_UPI_AMOUNT_INVALID: "The amount is not valid for this bill.",
  POS_UPI_AMOUNT_LIMIT_EXCEEDED: "The amount is above the allowed limit.",
  POS_UPI_SESSION_CLOSED: "This POS session is closed.",
  POS_UPI_PERMISSION_DENIED: "You cannot take this payment.",
  POS_UPI_CONSENT_REQUIRED: "Ask the customer before sending the link to their phone or email.",
  POS_UPI_STATIC_DISABLED: "Recording payments to the shop's UPI QR is not enabled.",
  POS_UPI_REFERENCE_REQUIRED: "Enter the UPI transaction reference (UTR).",
  POS_UPI_DUPLICATE_REFERENCE: "This UPI transaction reference was already recorded.",
  POS_UPI_ATTESTATION_REQUIRED: "Confirm that the payment reached the shop's account.",
  POS_UPI_APPROVAL_REQUIRED: "A supervisor must approve recording this payment.",
  POS_UPI_IDEMPOTENCY_CONFLICT: "This payment request conflicts with an earlier request.",
  POS_UPI_VERSION_CONFLICT: "This checkout changed. Refresh its status.",
  POS_UPI_CONFIG_INVALID: "The UPI set-up is not valid.",
  POS_PAYMENT_EXCEPTION_NOT_FOUND: "Payment exception not found.",
});

const upiError = (status, code, message = POS_UPI_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};
const money = (value) => formatDecimal(decimal(value ?? 0), 2);
const MODES = ["dynamic_qr", "payment_link", "upi_intent"];
const METHODS = ["upi", "wallet", "bank_transfer"];

async function upiConfig(client, context, storeId) {
  return (await client.query(
    `SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='upi' AND active=true`, [context.organizationId, storeId])).rows[0] ?? null;
}
function modeAvailable(config, mode) {
  if (!config || config.configuration_status !== "ready") return false;
  let capabilities = {};
  try { capabilities = resolvePaymentAdapter(config.provider_key).capabilities ?? {}; } catch { return false; }
  if (mode === "dynamic_qr") return Boolean(capabilities.dynamicQr);
  if (mode === "payment_link") return Boolean(config.payment_links_enabled && capabilities.paymentLink);
  if (mode === "upi_intent") return Boolean(config.intent_enabled && capabilities.upiIntent);
  return false;
}

// What this checkout can do with UPI: the ways available (dynamic QR, link, intent, the shop's static QR), the merchant name customers see,
// the amount due and any request still open on the bill (so a refreshed screen continues it).
export async function getPosCheckoutUpiOptions(client, context, cartId) {
  requirePermission(context, "pos.view");
  const state = await loadCheckout(client, context, cartId);
  const config = await upiConfig(client, context, state.cart.store_id);
  const enabled = await isTerminalPaymentMethodEnabled(client, context.organizationId, state.cart.terminal_id, "upi");
  const open = state.payments.find((payment) => METHODS.includes(payment.payment_method) && !payment.sale_id && (LIVE_ATTEMPT_STATUSES.includes(payment.attempt_status)
    || payment.attempt_status === "reconciliation_required" || payment.recovery_status === "finalization_failed" || (payment.attempt_status === "externally_attested" && payment.status === "pending")));
  const staticReady = Boolean(config?.static_qr_enabled && config.static_qr_vpa && config.static_qr_verified_at);
  return {
    enabled: enabled && Boolean(config) && config.configuration_status !== "disabled", currency: state.cart.store_currency ?? state.cart.currency_code, amountDue: money(state.due),
    merchantName: config?.merchant_display_name ?? null,
    modes: { dynamicQr: modeAvailable(config, "dynamic_qr"), paymentLink: modeAvailable(config, "payment_link"), upiIntent: modeAvailable(config, "upi_intent"), staticQr: staticReady },
    staticQr: staticReady ? { vpa: config.static_qr_vpa, payload: `upi://pay?pa=${config.static_qr_vpa}&pn=${encodeURIComponent(config.merchant_display_name ?? "")}&am=${money(state.due)}&cu=INR`,
      provisionalAcceptance: Boolean(config.provisional_acceptance) } : null,
    attempt: attemptView(open ?? null),
  };
}

// Ask the provider for a payment request: a dynamic QR (default), a payment link or a UPI intent. input: mode, method (upi; wallet /
// bank_transfer for links where enabled), amount (optional: what is due), contact + consent (only to send a link), expectedVersion,
// idempotencyKey, outcome (sandbox scripting only).
export async function startPosUpiPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const mode = MODES.includes(input.mode) ? input.mode : "dynamic_qr";
  const method = METHODS.includes(input.method) ? input.method : "upi";
  let idempotency;
  try {
    idempotency = await beginIdempotentOperation(client, context, {
      operation: "pos.upi.start", key: input.idempotencyKey, required: true, payload: { cartId, mode, method, amount: input.amount ?? null },
    });
  } catch (error) {
    if (/IDEMPOTENCY/.test(error.code ?? "")) throw upiError(409, "POS_UPI_IDEMPOTENCY_CONFLICT");
    throw error;
  }
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  let state = await loadCheckout(client, context, cartId, { lock: true });
  const { cart } = state;
  if (cart.status === "completed") throw upiError(409, "POS_UPI_VERSION_CONFLICT", "This bill is already completed.");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(cart.version)) throw upiError(409, "POS_UPI_VERSION_CONFLICT");
  if (cart.shift_status !== "open") throw upiError(409, "POS_UPI_SESSION_CLOSED");
  if (!(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, "upi"))) throw upiError(409, "POS_UPI_DISABLED");
  const config = await upiConfig(client, context, cart.store_id);
  if (!config || config.configuration_status !== "ready") throw upiError(409, "POS_UPI_PROVIDER_NOT_READY");
  if (!modeAvailable(config, mode)) throw upiError(409, "POS_UPI_MODE_UNSUPPORTED");
  if (method !== "upi" && (mode !== "payment_link" || !(Array.isArray(config.digital_methods) && config.digital_methods.includes(method)))) throw upiError(409, "POS_UPI_MODE_UNSUPPORTED");
  if (mode === "payment_link" && input.contact && input.consent !== true) throw upiError(400, "POS_UPI_CONSENT_REQUIRED");
  try { await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id }); }
  catch (error) { throw upiError(403, "POS_UPI_PERMISSION_DENIED", `${POS_UPI_MESSAGES.POS_UPI_PERMISSION_DENIED} ${error.message}`); }
  // One open request per bill: a second QR is never created while the first could still be paid.
  if (state.pendingNonCash.length) throw upiError(409, "POS_UPI_PAYMENT_IN_PROGRESS", undefined, { attempt: attemptView(state.pendingNonCash[0]) });
  if (!cart.checkout_started_at) {
    try { await ensurePosCheckoutStarted(client, context, cartId); }
    catch (error) { throw upiError(409, "POS_UPI_VERSION_CONFLICT", error.message, { issues: error.details?.issues ?? [] }); }
    state = await loadCheckout(client, context, cartId, { lock: true });
  }
  const amount = input.amount === undefined || input.amount === null || String(input.amount).trim() === "" ? state.due : decimal(String(input.amount));
  if (amount <= 0n || amount > state.due) throw upiError(400, "POS_UPI_AMOUNT_INVALID", `${POS_UPI_MESSAGES.POS_UPI_AMOUNT_INVALID} At most ${money(state.due)} is due.`, { amountDue: money(state.due) });
  if (config.max_amount !== null && amount > decimal(config.max_amount)) throw upiError(400, "POS_UPI_AMOUNT_LIMIT_EXCEEDED");
  await assertSplitAllowed(client, context, state, method, amount);
  const adapter = resolvePaymentAdapter(config.provider_key);

  const payment = (await client.query(
    `INSERT INTO tenant.pos_payments (organization_id, cart_id, store_id, shift_id, terminal_id, payment_method, amount, currency_code, provider_key, merchant_account_reference,
       idempotency_key, status, attempt_status, verification_status, initiated_by, created_by, cart_version, payment_mode, request_status, link_contact_consent, display_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'initiated','created','unresolved',$12,$12,$13,$14,'active',$15,$16) RETURNING *`,
    [context.organizationId, cartId, cart.store_id, cart.shift_id, cart.terminal_id, method, asDatabaseDecimal(amount), cart.store_currency ?? cart.currency_code, config.provider_key,
      config.merchant_account_reference ?? null, input.idempotencyKey, context.userId, state.cart.version, mode, Boolean(input.consent), "Creating the payment request."])).rows[0];
  await event(client, context, "payment", payment.id, "pos.digital.started", { cartId, mode, method, amount: money(amount) });

  let updated = payment;
  try {
    const result = await adapter.initiate(context, { amount: asDatabaseDecimal(amount), currency: payment.currency_code, method, merchantReference: payment.id, mode,
      merchantName: config.merchant_display_name, merchantAccount: payment.merchant_account_reference, expiresInSeconds: config.qr_validity_seconds, outcome: input.outcome });
    if (mode === "dynamic_qr" && !result.qrPayload && !result.qrImageUrl) throw Object.assign(new Error("The provider did not return a QR."), { invalidResponse: true });
    if (result.merchantAccount && payment.merchant_account_reference && result.merchantAccount !== payment.merchant_account_reference)
      throw Object.assign(new Error("The provider returned a request for a different merchant account."), { invalidResponse: true });
    await client.query(
      `UPDATE tenant.pos_payments SET payment_request_reference=$3, qr_payload=$4, qr_image_url=$5, payment_link_url=$6, expires_at=$7, provider_reference=COALESCE(provider_reference,$8),
              merchant_account_reference=COALESCE(merchant_account_reference,$9) WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, payment.id, result.requestReference ?? null, result.qrPayload ?? null, result.qrImageUrl ?? null, result.linkUrl ?? null, result.expiresAt ?? null,
        result.providerReference ?? null, result.merchantAccount ?? null]);
    const fresh = (await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND id=$2`, [context.organizationId, payment.id])).rows[0];
    updated = await applyProviderStatus(client, context, fresh, { status: result.providerStatus ?? result.status, providerReference: result.providerReference, source: "initiate" });
  } catch (error) {
    if (error instanceof PaymentAdapterError) throw error;
    if (error.invalidResponse) {
      // A request we cannot trust is cancelled with the provider and never shown to the customer.
      await adapter.cancel?.(context, { merchantReference: payment.id }).catch(() => null);
      updated = await applyProviderStatus(client, context, payment, { status: "failed", source: "invalid_response" });
      await client.query(`UPDATE tenant.pos_payments SET failure_reason=$3 WHERE organization_id=$1 AND id=$2`, [context.organizationId, payment.id, error.message]);
    } else {
      updated = await applyProviderStatus(client, context, payment, { status: "unknown", source: "initiate_timeout" });
    }
  }
  const finalized = updated.attempt_status === "captured" ? await finalizeCheckout(client, context, cartId, input.idempotencyKey) : null;
  const response = { ...(await outcomeFor(client, context, payment.id, finalized)), merchantName: config.merchant_display_name ?? null };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: payment.id });
  return response;
}

// Record a payment made to the shop's own (verified) static UPI QR. input: utr, amount (defaults to what is due), attested (true),
// approvalId (above the outlet's threshold), idempotencyKey.
export async function recordStaticUpiPayment(client, context, cartId, input = {}) {
  requirePermission(context, "pos.sale.create");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.upi.static", key: input.idempotencyKey, required: true, payload: { cartId, utr: String(input.utr ?? "").trim(), amount: input.amount ?? null },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  let state = await loadCheckout(client, context, cartId, { lock: true });
  const { cart } = state;
  if (cart.shift_status !== "open") throw upiError(409, "POS_UPI_SESSION_CLOSED");
  const config = await upiConfig(client, context, cart.store_id);
  if (!config || !config.static_qr_enabled || !config.static_qr_verified_at) throw upiError(409, "POS_UPI_STATIC_DISABLED");
  if (!(await isTerminalPaymentMethodEnabled(client, context.organizationId, cart.terminal_id, "upi"))) throw upiError(409, "POS_UPI_DISABLED");
  try { await assertPosAction(client, context, { permission: "SALE_COMPLETE", outletId: cart.store_id }); }
  catch (error) { throw upiError(403, "POS_UPI_PERMISSION_DENIED", `${POS_UPI_MESSAGES.POS_UPI_PERMISSION_DENIED} ${error.message}`); }
  if (state.pendingNonCash.length) throw upiError(409, "POS_UPI_PAYMENT_IN_PROGRESS");
  const utr = String(input.utr ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6,35}$/.test(utr)) throw upiError(400, "POS_UPI_REFERENCE_REQUIRED");
  if (input.attested !== true) throw upiError(400, "POS_UPI_ATTESTATION_REQUIRED");
  const duplicate = (await client.query(`SELECT id FROM tenant.pos_payments WHERE organization_id=$1 AND provider_transaction_reference=$2`, [context.organizationId, utr])).rows[0];
  if (duplicate) throw upiError(409, "POS_UPI_DUPLICATE_REFERENCE");
  if (!cart.checkout_started_at) {
    try { await ensurePosCheckoutStarted(client, context, cartId); }
    catch (error) { throw upiError(409, "POS_UPI_VERSION_CONFLICT", error.message, { issues: error.details?.issues ?? [] }); }
    state = await loadCheckout(client, context, cartId, { lock: true });
  }
  const amount = input.amount === undefined || input.amount === null || String(input.amount).trim() === "" ? state.due : decimal(String(input.amount));
  if (amount <= 0n || amount > state.due) throw upiError(400, "POS_UPI_AMOUNT_INVALID", `${POS_UPI_MESSAGES.POS_UPI_AMOUNT_INVALID} At most ${money(state.due)} is due.`);
  await assertSplitAllowed(client, context, state, "upi", amount);
  let approvalId = null;
  if (config.standalone_approval_above !== null && amount > decimal(config.standalone_approval_above)) {
    if (!input.approvalId) throw upiError(409, "POS_UPI_APPROVAL_REQUIRED", `${POS_UPI_MESSAGES.POS_UPI_APPROVAL_REQUIRED} (above ${money(config.standalone_approval_above)}).`);
    const approval = (await client.query(
      `UPDATE tenant.pos_permission_approvals SET status='consumed', consumed_at=now() WHERE organization_id=$1 AND id=$2 AND status='approved' AND requested_by=$3 AND resource_type='pos_cart'
          AND resource_id=$4 RETURNING id`, [context.organizationId, input.approvalId, context.userId, cartId])).rows[0];
    if (!approval) throw upiError(409, "POS_UPI_APPROVAL_REQUIRED", "The approval is not valid for this bill.");
    approvalId = approval.id;
  }
  const provisional = Boolean(config.provisional_acceptance);
  const payment = (await client.query(
    `INSERT INTO tenant.pos_payments (organization_id, cart_id, store_id, shift_id, terminal_id, payment_method, amount, currency_code, provider_key, merchant_account_reference,
       idempotency_key, status, attempt_status, verification_status, initiated_by, created_by, cart_version, payment_mode, provider_transaction_reference, instrument, attested_by,
       attested_at, captured_at, display_message, failure_reason)
     VALUES ($1,$2,$3,$4,$5,'upi',$6,$7,'static_qr',$8,$9,$10,'externally_attested','externally_attested',$11,$11,$12,'static_qr',$13,'upi',$11,now(),
       CASE WHEN $10='captured' THEN now() END,$14,$15) RETURNING *`,
    [context.organizationId, cartId, cart.store_id, cart.shift_id, cart.terminal_id, asDatabaseDecimal(amount), cart.store_currency ?? cart.currency_code, config.static_qr_vpa,
      input.idempotencyKey, provisional ? "captured" : "pending", context.userId, state.cart.version, utr, messageFor({ payment_method: "upi" }, "externally_attested"),
      approvalId ? `Approved above the threshold (approval ${approvalId}).` : null])).rows[0];
  await event(client, context, "payment", payment.id, "pos.upi.static_recorded", { cartId, amount: money(amount), utr, provisional, approvalId });
  const finalized = provisional ? await finalizeCheckout(client, context, cartId, input.idempotencyKey) : null;
  const response = { ...(await outcomeFor(client, context, payment.id, finalized)), provisional,
    note: provisional ? "Recorded against the shop's QR and accepted provisionally. Settlement reconciliation will confirm the UTR."
      : "Recorded against the shop's QR. The sale waits until a settlement confirms the UTR." };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_payment", aggregateId: payment.id });
  return response;
}

// UPI set-up per outlet (administrators). The static QR's UPI ID must be verified by an administrator (verifyStaticQr) before the static
// QR can be switched on; changing the UPI ID clears the verification. input: providerKey, merchantDisplayName, merchantAccountReference,
// configurationStatus, staticQrVpa, verifyStaticQr, staticQrEnabled, provisionalAcceptance, approvalAbove, paymentLinksEnabled,
// intentEnabled, digitalMethods, qrValiditySeconds, refundEnabled, maxAmount, credentialReference.
const upiConfigView = (row, store) => ({
  storeId: store.id, storeName: store.name, configured: Boolean(row), providerKey: row?.provider_key ?? null, merchantDisplayName: row?.merchant_display_name ?? null,
  merchantAccountReference: row?.merchant_account_reference ?? null, configurationStatus: row?.configuration_status ?? "incomplete",
  staticQrVpa: row?.static_qr_vpa ?? null, staticQrVerifiedAt: row?.static_qr_verified_at ?? null, staticQrEnabled: Boolean(row?.static_qr_enabled),
  provisionalAcceptance: Boolean(row?.provisional_acceptance), approvalAbove: row?.standalone_approval_above ? money(row.standalone_approval_above) : null,
  paymentLinksEnabled: Boolean(row?.payment_links_enabled), intentEnabled: Boolean(row?.intent_enabled), digitalMethods: row?.digital_methods ?? [],
  qrValiditySeconds: row?.qr_validity_seconds ?? 300, refundEnabled: row ? Boolean(row.refund_enabled) : true, maxAmount: row?.max_amount ? money(row.max_amount) : null,
  credentialReference: row?.credential_env_var ?? null,
});

export async function listPosUpiConfigs(client, context) {
  requirePermission(context, "pos.settings.manage");
  const stores = await accessiblePosStoreIds(client, context);
  const storeRows = (await client.query(`SELECT id, name FROM tenant.pos_stores WHERE organization_id=$1 ${stores ? "AND id = ANY($2::uuid[])" : ""} ORDER BY name`,
    stores ? [context.organizationId, stores] : [context.organizationId])).rows;
  const result = [];
  for (const store of storeRows) {
    const row = (await client.query(`SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='upi'`, [context.organizationId, store.id])).rows[0];
    result.push(upiConfigView(row, store));
  }
  return result;
}

export async function updatePosUpiConfig(client, context, storeId, input = {}) {
  requirePermission(context, "pos.settings.manage");
  await assertPosStoreAccess(client, context, storeId);
  const store = (await client.query(`SELECT id, name FROM tenant.pos_stores WHERE organization_id=$1 AND id=$2`, [context.organizationId, storeId])).rows[0];
  if (!store) throw posError(404, "Outlet not found.", "POS_STORE_NOT_FOUND");
  const existing = (await client.query(`SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='upi'`, [context.organizationId, storeId])).rows[0];
  if (input.credentialReference && !/^[A-Z][A-Z0-9_]{2,79}$/.test(String(input.credentialReference)))
    throw upiError(400, "POS_UPI_CONFIG_INVALID", "The credential reference is the NAME of a secret, never the secret itself.");
  const vpa = input.staticQrVpa !== undefined ? (input.staticQrVpa ? String(input.staticQrVpa).trim().toLowerCase() : null) : existing?.static_qr_vpa ?? null;
  if (vpa && !/^[a-z0-9._-]{2,200}@[a-z0-9.-]{2,64}$/.test(vpa)) throw upiError(400, "POS_UPI_CONFIG_INVALID", "Enter a valid UPI ID (name@bank).");
  const vpaChanged = vpa !== (existing?.static_qr_vpa ?? null);
  const verifiedAt = input.verifyStaticQr === true && vpa ? new Date().toISOString() : vpaChanged ? null : existing?.static_qr_verified_at ?? null;
  const verifiedBy = input.verifyStaticQr === true && vpa ? context.userId : vpaChanged ? null : existing?.static_qr_verified_by ?? null;
  const staticEnabled = input.staticQrEnabled ?? (vpaChanged ? false : existing?.static_qr_enabled ?? false);
  if (staticEnabled && (!vpa || !verifiedAt)) throw upiError(409, "POS_UPI_CONFIG_INVALID", "Verify the shop's UPI ID before switching the static QR on.");
  const amount = (value, fallback) => (value === undefined ? fallback : value === null || value === "" ? null
    : Number(value) > 0 ? String(value) : (() => { throw upiError(400, "POS_UPI_CONFIG_INVALID", "Amounts must be more than zero."); })());
  const methods = Array.isArray(input.digitalMethods) ? input.digitalMethods.filter((method) => ["wallet", "bank_transfer"].includes(method)) : existing?.digital_methods ?? [];
  const validity = input.qrValiditySeconds !== undefined ? Number(input.qrValiditySeconds) : existing?.qr_validity_seconds ?? 300;
  if (!Number.isInteger(validity) || validity < 60 || validity > 86400) throw upiError(400, "POS_UPI_CONFIG_INVALID", "QR validity must be between 60 seconds and one day.");
  const merged = {
    provider_key: String(input.providerKey ?? existing?.provider_key ?? "sandbox").trim().toLowerCase(),
    merchant_display_name: input.merchantDisplayName !== undefined ? String(input.merchantDisplayName ?? "").trim().slice(0, 80) || null : existing?.merchant_display_name ?? null,
    merchant_account_reference: input.merchantAccountReference !== undefined ? input.merchantAccountReference || null : existing?.merchant_account_reference ?? null,
    configuration_status: ["ready", "incomplete", "disabled"].includes(input.configurationStatus) ? input.configurationStatus : existing?.configuration_status ?? "incomplete",
    static_qr_vpa: vpa, static_qr_verified_at: verifiedAt, static_qr_verified_by: verifiedBy, static_qr_enabled: staticEnabled,
    provisional_acceptance: input.provisionalAcceptance ?? existing?.provisional_acceptance ?? false,
    standalone_approval_above: amount(input.approvalAbove, existing?.standalone_approval_above ?? null),
    payment_links_enabled: input.paymentLinksEnabled ?? existing?.payment_links_enabled ?? false, intent_enabled: input.intentEnabled ?? existing?.intent_enabled ?? false,
    digital_methods: JSON.stringify(methods), qr_validity_seconds: validity, refund_enabled: input.refundEnabled ?? existing?.refund_enabled ?? true,
    max_amount: amount(input.maxAmount, existing?.max_amount ?? null),
    credential_env_var: input.credentialReference !== undefined ? input.credentialReference || null : existing?.credential_env_var ?? null,
  };
  if (merged.configuration_status === "ready" && !merged.merchant_display_name) throw upiError(409, "POS_UPI_CONFIG_INVALID", "Customers must see the merchant name: set it before going live.");
  if (merged.configuration_status === "ready") resolvePaymentAdapter(merged.provider_key);
  await client.query(
    `INSERT INTO tenant.pos_payment_provider_configs (organization_id, store_id, payment_method, provider_key, merchant_display_name, merchant_account_reference, configuration_status,
       static_qr_vpa, static_qr_verified_at, static_qr_verified_by, static_qr_enabled, provisional_acceptance, standalone_approval_above, payment_links_enabled, intent_enabled,
       digital_methods, qr_validity_seconds, refund_enabled, max_amount, credential_env_var, created_by)
     VALUES ($1,$2,'upi',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20)
     ON CONFLICT (organization_id, store_id, payment_method) DO UPDATE SET provider_key=EXCLUDED.provider_key, merchant_display_name=EXCLUDED.merchant_display_name,
       merchant_account_reference=EXCLUDED.merchant_account_reference, configuration_status=EXCLUDED.configuration_status, static_qr_vpa=EXCLUDED.static_qr_vpa,
       static_qr_verified_at=EXCLUDED.static_qr_verified_at, static_qr_verified_by=EXCLUDED.static_qr_verified_by, static_qr_enabled=EXCLUDED.static_qr_enabled,
       provisional_acceptance=EXCLUDED.provisional_acceptance, standalone_approval_above=EXCLUDED.standalone_approval_above, payment_links_enabled=EXCLUDED.payment_links_enabled,
       intent_enabled=EXCLUDED.intent_enabled, digital_methods=EXCLUDED.digital_methods, qr_validity_seconds=EXCLUDED.qr_validity_seconds, refund_enabled=EXCLUDED.refund_enabled,
       max_amount=EXCLUDED.max_amount, credential_env_var=EXCLUDED.credential_env_var, updated_at=now()`,
    [context.organizationId, storeId, merged.provider_key, merged.merchant_display_name, merged.merchant_account_reference, merged.configuration_status, merged.static_qr_vpa,
      merged.static_qr_verified_at, merged.static_qr_verified_by, merged.static_qr_enabled, merged.provisional_acceptance, merged.standalone_approval_above, merged.payment_links_enabled,
      merged.intent_enabled, merged.digital_methods, merged.qr_validity_seconds, merged.refund_enabled, merged.max_amount, merged.credential_env_var, context.userId]);
  await event(client, context, "store", storeId, "pos.upi_config.updated", { ...merged, credential_env_var: merged.credential_env_var ? "(reference set)" : null,
    staticQrVerified: Boolean(merged.static_qr_verified_at) });
  const row = (await client.query(`SELECT * FROM tenant.pos_payment_provider_configs WHERE organization_id=$1 AND store_id=$2 AND payment_method='upi'`, [context.organizationId, storeId])).rows[0];
  return upiConfigView(row, store);
}

// Payment exceptions: credits that could not simply be applied (short, excess, duplicate, late, unmatched, wrong merchant / currency,
// conflicting). Finance or a manager resolves them — refund through the provider, or close with a note — never a cashier changing amounts.
const exceptionView = (row) => ({
  id: row.id, type: row.exception_type, status: row.status, amount: row.amount === null ? null : money(row.amount), expectedAmount: row.expected_amount === null ? null : money(row.expected_amount),
  currency: row.currency_code, providerKey: row.provider_key, providerReference: row.provider_reference, transactionReference: row.provider_transaction_reference, detail: row.detail,
  paymentId: row.payment_id, cartId: row.cart_id, resolutionNote: row.resolution_note, providerRefundReference: row.provider_refund_reference, createdAt: row.created_at, resolvedAt: row.resolved_at,
});

export async function listPosPaymentExceptions(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const values = [context.organizationId];
  const filters = [];
  if (input.status) { values.push(input.status); filters.push(`status = $${values.length}`); }
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); filters.push(`(store_id IS NULL OR store_id = ANY($${values.length}::uuid[]))`); }
  const rows = (await client.query(`SELECT * FROM tenant.pos_payment_exceptions WHERE organization_id=$1 ${filters.map((filter) => `AND ${filter}`).join(" ")} ORDER BY created_at DESC LIMIT 200`, values)).rows;
  return rows.map(exceptionView);
}

export async function resolvePosPaymentException(client, context, exceptionId, input = {}) {
  requirePermission(context, "pos.reconciliation.manage");
  const row = (await client.query(`SELECT * FROM tenant.pos_payment_exceptions WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, exceptionId])).rows[0];
  if (!row) throw upiError(404, "POS_PAYMENT_EXCEPTION_NOT_FOUND");
  const note = String(input.note ?? "").trim();
  if (!note) throw posError(400, "Say how the exception was resolved.", "POS_PAYMENT_EXCEPTION_NOTE_REQUIRED");
  if (["refunded", "resolved"].includes(row.status)) return exceptionView(row);
  if (input.action === "refund") {
    if (!row.provider_reference || row.amount === null || ["static_qr", "standalone"].includes(row.provider_key))
      throw posError(409, "This credit cannot be refunded through the provider. Refund it from the merchant account and close it with a note.", "POS_PAYMENT_EXCEPTION_REFUND_UNSUPPORTED");
    // Refunds (0100): a refund of its own (source: this exception), authorized by the reconciliation user resolving it.
    let refund = row.refund_id ? await getPosRefund(client, context, row.refund_id)
      : await createPosRefund(client, context, "payment_exception", row.id, { idempotencyKey: `exception:${row.id}:refund`, reasonNote: note, preApproved: true,
        reasonCode: row.exception_type === "duplicate" ? "duplicate_payment" : "excess_payment" });
    if (refund.status === "AUTHORIZED") refund = await executePosRefund(client, context, refund.id, { outcome: input.outcome });
    if (refund.status === "FAILED_ACTION_REQUIRED") throw posError(502, `The provider refused the refund: ${refund.components[0]?.error ?? ""}`, "POS_PAYMENT_EXCEPTION_REFUND_FAILED");
    const status = refund.status === "REFUNDED" ? "refunded" : "refund_requested";
    const reference = (await client.query(`SELECT provider_refund_id FROM tenant.payment_refund_components WHERE organization_id=$1 AND refund_id=$2 ORDER BY created_at LIMIT 1`,
      [context.organizationId, refund.id])).rows[0]?.provider_refund_id ?? null;
    const saved = (await client.query(
      `UPDATE tenant.pos_payment_exceptions SET status=$3, provider_refund_reference=$4, resolution_note=$5, resolved_by=$6, resolved_at=CASE WHEN $3='refunded' THEN now() END, updated_at=now()
        WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, row.id, status, reference, note, context.userId])).rows[0];
    await event(client, context, "payment_exception", row.id, "pos.payment_exception.refund", { status, note });
    await releaseHeldAttempt(client, context, row, note);
    return exceptionView(saved);
  }
  const saved = (await client.query(
    `UPDATE tenant.pos_payment_exceptions SET status='resolved', resolution_note=$3, resolved_by=$4, resolved_at=now(), updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, row.id, note, context.userId])).rows[0];
  await event(client, context, "payment_exception", row.id, "pos.payment_exception.resolved", { note });
  await releaseHeldAttempt(client, context, row, note);
  return exceptionView(saved);
}

// Once an exception is resolved, an attempt that was held for it (never part of a sale) is marked not applied, and the bill is free to be
// paid another way. The money itself was refunded or dealt with by Finance under the exception.
async function releaseHeldAttempt(client, context, exception, note) {
  if (!exception.payment_id) return;
  const released = (await client.query(
    `UPDATE tenant.pos_payments SET attempt_status='cancelled', status='voided', voided_at=now(), resolved_at=now(), display_message=$3, version=version+1, updated_at=now()
      WHERE organization_id=$1 AND id=$2 AND attempt_status='reconciliation_required' AND sale_id IS NULL RETURNING id`,
    [context.organizationId, exception.payment_id, `Not applied to the sale: ${note}`.slice(0, 300)])).rows[0];
  if (released) await event(client, context, "payment", exception.payment_id, "pos.payment.not_applied", { exceptionId: exception.id, note });
}

// UPI & digital payments for a period: verified collections apart from static QR attested ones, by instrument (UPI, wallet, netbanking,
// card via links) and mode, digital share of all payments, pending / unknown / expired requests, refunds, settlement with fees, and open
// exceptions by kind, by outlet and cashier. input: from, to, storeId.
export async function getPosDigitalPaymentSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const now = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : `${now.toISOString().slice(0, 8)}01`;
  const to = DATE.test(String(input.to ?? "")) ? input.to : now.toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const filters = [];
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); filters.push(`payment.store_id = ANY($${values.length}::uuid[])`); }
  if (/^[0-9a-f-]{36}$/i.test(String(input.storeId ?? ""))) { values.push(input.storeId); filters.push(`payment.store_id = $${values.length}::uuid`); }
  const period = `payment.organization_id = $1 AND payment.initiated_at >= $2::date AND payment.initiated_at < $3::date + 1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
  const scope = `${period} AND payment.payment_method IN ('upi', 'wallet', 'bank_transfer')`;
  const [totals] = (await client.query(
    `SELECT count(*) FILTER (WHERE payment.sale_id IS NOT NULL)::int AS digital_sales,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL AND payment.verification_status = 'provider_verified'), 0)::text AS verified,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.verification_status = 'externally_attested'), 0)::text AS attested,
            COALESCE(sum(payment.refunded_amount), 0)::text AS refunded,
            count(*) FILTER (WHERE payment.attempt_status IN ('awaiting_customer', 'processing', 'unknown', 'cancel_pending') AND payment.request_status <> 'expired')::int AS pending,
            count(*) FILTER (WHERE payment.request_status = 'expired' AND payment.attempt_status NOT IN ('captured', 'failed', 'declined', 'cancelled'))::int AS expired_unresolved,
            count(*) FILTER (WHERE payment.attempt_status IN ('failed', 'declined'))::int AS failed, count(*) FILTER (WHERE payment.attempt_status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE payment.attempt_status = 'reconciliation_required')::int AS reconciliation_required,
            COALESCE(sum(payment.settled_amount) FILTER (WHERE payment.settlement_status = 'settled'), 0)::text AS settled_gross,
            COALESCE(sum(payment.settlement_fee_amount) FILTER (WHERE payment.settlement_status = 'settled'), 0)::text AS fees,
            COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL AND payment.settlement_status <> 'settled'), 0)::text AS unsettled
       FROM tenant.pos_payments payment WHERE ${scope}`, values)).rows;
  const [share] = (await client.query(
    `SELECT COALESCE(sum(payment.amount) FILTER (WHERE payment.sale_id IS NOT NULL), 0)::text AS all_payments FROM tenant.pos_payments payment WHERE ${period}`, values)).rows;
  const byInstrument = (await client.query(
    `SELECT COALESCE(payment.instrument, payment.payment_method) AS instrument, COALESCE(payment.payment_mode, 'hosted') AS mode, count(*)::int AS payments,
            COALESCE(sum(payment.amount), 0)::text AS amount
       FROM tenant.pos_payments payment WHERE ${scope} AND payment.sale_id IS NOT NULL GROUP BY 1, 2 ORDER BY 4 DESC`, values)).rows;
  const byOutlet = (await client.query(
    `SELECT store.name, count(*)::int AS payments, COALESCE(sum(payment.amount), 0)::text AS amount FROM tenant.pos_payments payment
       JOIN tenant.pos_stores store ON store.organization_id = payment.organization_id AND store.id = payment.store_id
      WHERE ${scope} AND payment.sale_id IS NOT NULL GROUP BY store.name ORDER BY 3 DESC`, values)).rows;
  const byCashier = (await client.query(
    `SELECT person.full_name AS name, count(*)::int AS payments, COALESCE(sum(payment.amount), 0)::text AS amount FROM tenant.pos_payments payment
       JOIN public.users person ON person.id = payment.created_by WHERE ${scope} AND payment.sale_id IS NOT NULL GROUP BY person.full_name ORDER BY 3 DESC`, values)).rows;
  const exceptions = (await client.query(
    `SELECT exception_type AS type, status, count(*)::int AS count, COALESCE(sum(amount), 0)::text AS amount FROM tenant.pos_payment_exceptions
      WHERE organization_id=$1 AND created_at >= $2::date AND created_at < $3::date + 1 GROUP BY 1, 2 ORDER BY 1`, [context.organizationId, from, to])).rows;
  const verified = decimal(totals.verified);
  const all = decimal(share.all_payments);
  return {
    from, to, totals: { ...totals, net: money(verified - decimal(totals.refunded)), digital_share_percent: all > 0n ? ((Number(totals.verified) / Number(share.all_payments)) * 100).toFixed(1) : "0.0" },
    byInstrument, byOutlet, byCashier, exceptions, openExceptionAmount: money(exceptions.filter((row) => row.status === "open").reduce((sum, row) => add(sum, decimal(row.amount)), decimal(0))),
  };
}
