// Read models for the Billing page and the billing.audit health panel, plus
// the billing profile. No secrets, raw payloads or instrument data leave here.
import { listPlanCatalogue } from "./catalogue.js";
import { billingEnforcementMode } from "./enforcement.js";
import { BillingServiceError } from "./errors.js";
import { liveCheckoutForOrganization } from "./checkout.js";
import { getSeatStatus, SEAT_OVERAGE_GRACE_DAYS } from "./seats.js";
import { billingStateKey } from "./state.js";
import { billingAudit, subscriptionRow } from "./shared.js";
import { queryAuditEvents } from "../platform/audit/index.js";

const iso = (value) => (value ? new Date(value).toISOString() : null);

function checkoutPhase(session) {
  if (!session) return null;
  if (session.attention_required_at && ["failed", "cancel_pending"].includes(session.status)) return "attention";
  if (session.status === "verifying") return "verifying";
  if (session.status === "created") return session.open ? "awaiting_payment" : "verifying";
  return "preparing";
}

// Vercentlabs tax invoices are generated only once every legal fact is
// configured; until then Billing shows the payment provider's documents only.
export const TAX_INVOICE_SETTINGS = Object.freeze([
  "BILLING_SUPPLIER_LEGAL_NAME", "BILLING_SUPPLIER_GSTIN", "BILLING_SUPPLIER_STATE_CODE", "BILLING_SUPPLIER_ADDRESS",
  "BILLING_SERVICE_SAC", "BILLING_GST_RATE_PERCENT", "BILLING_TAX_INVOICE_SERIES",
]);

export function taxInvoiceReadiness(env = process.env) {
  const missing = TAX_INVOICE_SETTINGS.filter((key) => !String(env[key] || "").trim());
  // Generation itself is intentionally not implemented yet: readiness alone never enables it.
  return { available: false, configured: missing.length === 0, missing };
}

export async function getBillingOverview(client, organizationId, env = process.env) {
  const sub = await subscriptionRow(client, organizationId);
  if (!sub) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
  const seats = await getSeatStatus(client, organizationId);
  const plans = await listPlanCatalogue(client, organizationId, env);
  const live = await liveCheckoutForOrganization(client, organizationId);
  const phase = checkoutPhase(live);
  const profile = (
    await client.query(
      `SELECT legal_name, billing_email, phone, gstin, address_line1, address_line2, city, state, state_code, postal_code, country_code
         FROM billing_customers WHERE organization_id=$1`,
      [organizationId],
    )
  ).rows[0] || null;
  const invoices = (
    await client.query(
      `SELECT id, provider_invoice_id, amount_paise, amount_paid_paise, currency, status, invoice_url, issued_at, paid_at, document_kind
         FROM billing_invoices WHERE organization_id=$1 ORDER BY COALESCE(issued_at, created_at) DESC LIMIT 24`,
      [organizationId],
    )
  ).rows.map((row) => ({ ...row, amount_paise: Number(row.amount_paise), amount_paid_paise: Number(row.amount_paid_paise) }));
  const payments = (
    await client.query(
      `SELECT id, provider_payment_id, provider_invoice_id, amount_paise, amount_refunded_paise, refund_status, currency, status, method, captured_at, created_at
         FROM billing_payments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 24`,
      [organizationId],
    )
  ).rows.map((row) => ({ ...row, amount_paise: Number(row.amount_paise), amount_refunded_paise: Number(row.amount_refunded_paise) }));
  const seatChanges = (
    await client.query(
      `SELECT id, from_paid_seats, to_paid_seats, effective, status, operation, reason, created_at FROM billing_seat_changes
        WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 12`,
      [organizationId],
    )
  ).rows;
  const overageGraceEndsAt = seats.seatOverageSince ? new Date(new Date(seats.seatOverageSince).getTime() + SEAT_OVERAGE_GRACE_DAYS * 86_400_000).toISOString() : null;
  const monthlyPaise = sub.pricing_model === "per_seat" ? seats.paidSeats * Number(sub.plan_amount_paise) : 0;
  const pendingSeatChange = seatChanges.find((change) => change.status === "provider_pending") || null;
  return {
    subscription: {
      state: billingStateKey({
        status: sub.status, pricingModel: sub.pricing_model, cancelAtCycleEnd: sub.cancel_at_cycle_end,
        checkoutPhase: phase, reconciliationRequired: Boolean(sub.reconciliation_required_at),
      }),
      status: sub.status,
      planCode: sub.plan_code,
      planName: sub.plan_name,
      pricingModel: sub.pricing_model,
      currentPeriodEndsAt: iso(sub.current_period_ends_at),
      cancelAtCycleEnd: sub.cancel_at_cycle_end,
      cancellationPending: sub.cancellation_state === "provider_pending",
      graceEndsAt: iso(sub.grace_ends_at),
      hasProviderSubscription: Boolean(sub.provider_subscription_id),
      monthlyPaise,
      legacyTerms: Boolean(sub.metadata?.legacy_commercial_terms),
      contractReference: sub.pricing_model === "custom" ? sub.metadata?.custom_contract?.reference ?? null : null,
    },
    checkout: live ? { phase, totalUsers: live.metadata?.total_users ?? null, expiresAt: iso(live.expires_at) } : null,
    pendingSeatChange: pendingSeatChange ? { toPaidSeats: pendingSeatChange.to_paid_seats, operation: pendingSeatChange.operation } : null,
    seats,
    overageGraceEndsAt,
    plans,
    profile,
    invoices,
    payments,
    seatChanges,
    taxInvoices: taxInvoiceReadiness(env),
    checkoutEnabled: String(env.BILLING_CHECKOUT_ENABLED || "").toLowerCase() === "true",
    enforcementMode: billingEnforcementMode(env),
  };
}

// ------------------------------------------------------------------ profile
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INDIAN_PIN = /^[1-9][0-9]{5}$/;

// Validates and stores the billing profile. Runs inside the caller's transaction.
export async function saveBillingProfile(client, ctx, input) {
  const clean = (value, max) => String(value ?? "").trim().slice(0, max);
  const legalName = clean(input.legalName, 200);
  const email = clean(input.billingEmail, 320).toLowerCase();
  const phone = clean(input.phone, 30);
  const gstin = clean(input.gstin, 15).toUpperCase();
  const country = clean(input.country || "IN", 2).toUpperCase();
  const address = {
    line1: clean(input.addressLine1, 200), line2: clean(input.addressLine2, 200), city: clean(input.city, 100),
    state: clean(input.state, 100), postalCode: clean(input.postalCode, 20),
  };
  const invalid = (message) => new BillingServiceError(422, message, "BILLING_PROFILE_INVALID");
  if (!legalName) throw invalid("The legal name is required.");
  if (!EMAIL.test(email)) throw invalid("Enter a valid billing email.");
  if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) throw invalid("Enter a valid phone number.");
  if (!/^[A-Z]{2}$/.test(country)) throw invalid("Choose a country.");
  if (!address.line1 || !address.city || !address.state || !address.postalCode) throw invalid("Enter the billing address, city, state and postal code.");
  if (country === "IN" && !INDIAN_PIN.test(address.postalCode)) throw invalid("Enter a valid 6-digit PIN code.");
  let stateCode = null;
  if (gstin) {
    if (country !== "IN") throw new BillingServiceError(422, "A GSTIN applies only to an Indian billing address.", "BILLING_GSTIN_INVALID");
    if (!GSTIN.test(gstin)) throw new BillingServiceError(422, "That GSTIN is not valid.", "BILLING_GSTIN_INVALID");
    stateCode = gstin.slice(0, 2); // the GST state code is the GSTIN prefix
  }
  const before = (await client.query(`SELECT legal_name, gstin, state_code FROM billing_customers WHERE organization_id=$1`, [ctx.organizationId])).rows[0] || null;
  const saved = (
    await client.query(
      `INSERT INTO billing_customers (organization_id, legal_name, billing_email, phone, gstin, address_line1, address_line2, city, state, state_code, postal_code, country_code, billing_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
       ON CONFLICT (organization_id) DO UPDATE SET legal_name=EXCLUDED.legal_name, billing_email=EXCLUDED.billing_email, phone=EXCLUDED.phone, gstin=EXCLUDED.gstin,
         address_line1=EXCLUDED.address_line1, address_line2=EXCLUDED.address_line2, city=EXCLUDED.city, state=EXCLUDED.state, state_code=EXCLUDED.state_code,
         postal_code=EXCLUDED.postal_code, country_code=EXCLUDED.country_code, billing_address=EXCLUDED.billing_address
       RETURNING legal_name, billing_email, phone, gstin, address_line1, address_line2, city, state, state_code, postal_code, country_code`,
      [ctx.organizationId, legalName, email, phone || null, gstin || null, address.line1, address.line2 || null, address.city, address.state, stateCode,
        address.postalCode, country, JSON.stringify({ ...address, country })],
    )
  ).rows[0];
  await billingAudit(client, {
    organizationId: ctx.organizationId, actorUserId: ctx.userId, eventType: "billing.profile.updated", entityId: ctx.organizationId,
    beforeData: before ? { legalName: before.legal_name, gstinSet: Boolean(before.gstin) } : null, afterData: { legalName, gstinSet: Boolean(gstin), country },
  });
  return saved;
}

// ------------------------------------------------------------------ billing health (billing.audit)
export async function getBillingHealth(client, organizationId) {
  const sub = await subscriptionRow(client, organizationId);
  if (!sub) throw new BillingServiceError(409, "Billing is not initialised for this organisation.", "BILLING_NOT_INITIALISED");
  const checkouts = (
    await client.query(
      `SELECT status, count(*)::int AS count, max(updated_at) AS last_update, bool_or(attention_required_at IS NOT NULL) AS attention
         FROM billing_checkout_sessions WHERE organization_id=$1 AND status IN ('provider_creating','provider_link_pending','provider_recovery_pending','verifying','cancel_pending','failed')
          AND (status <> 'failed' OR attention_required_at IS NOT NULL) GROUP BY status`,
      [organizationId],
    )
  ).rows;
  const webhooks = (
    await client.query(
      `SELECT count(*) FILTER (WHERE processing_status='failed')::int AS failed, count(*) FILTER (WHERE processing_status='dead_lettered')::int AS dead_lettered,
              count(*) FILTER (WHERE processing_status IN ('received','processing'))::int AS queued, max(provider_created_at) AS last_event_at
         FROM billing_webhook_events WHERE organization_id=$1`,
      [organizationId],
    )
  ).rows[0];
  const lastEvent = (await client.query(`SELECT event_type, processing_status, provider_created_at FROM billing_webhook_events WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1`, [organizationId])).rows[0] || null;
  const seatOps = (await client.query(`SELECT status, operation, to_paid_seats, attempts, last_error IS NOT NULL AS has_error FROM billing_seat_changes WHERE organization_id=$1 AND status IN ('provider_pending','pending')`, [organizationId])).rows;
  const recentAudit = (await queryAuditEvents(client, organizationId, { entityType: "billing", limit: 10 })).events.map((event) => ({
    event_type: event.eventType,
    created_at: event.createdAt,
    by_user: Boolean(event.actorUserId),
  }));
  const needsAttention = Boolean(sub.reconciliation_required_at) || checkouts.some((row) => row.attention) || webhooks.dead_lettered > 0 || sub.cancellation_state === "failed";
  return {
    needsAttention,
    subscription: {
      status: sub.status,
      providerStatus: sub.provider_status,
      lastProviderSyncAt: iso(sub.last_provider_sync_at),
      lastProviderEventAt: iso(sub.last_provider_event_at),
      reconciliationRequiredAt: iso(sub.reconciliation_required_at),
      reconciliationNote: sub.reconciliation_note,
      cancellationState: sub.cancellation_state,
      pendingPaidSeats: sub.pending_paid_seats,
    },
    checkouts: checkouts.map((row) => ({ status: row.status, count: row.count, lastUpdate: iso(row.last_update), attention: row.attention })),
    webhooks: { failed: webhooks.failed, deadLettered: webhooks.dead_lettered, queued: webhooks.queued, lastEventAt: iso(webhooks.last_event_at), lastEvent: lastEvent ? { type: lastEvent.event_type, status: lastEvent.processing_status, at: iso(lastEvent.provider_created_at) } : null },
    seatOperations: seatOps,
    recentAudit: recentAudit.map((row) => ({ eventType: row.event_type, at: iso(row.created_at), byUser: row.by_user })),
  };
}
