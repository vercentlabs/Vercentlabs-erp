import type { PoolClient } from "pg";

type Client = Pick<PoolClient, "query">;
export type BillingContext = { organizationId: string; userId: string; email?: string };
export type BillingProvider = Record<string, any>;

export class BillingServiceError extends Error {
  status: number;
  code: string;
  outcome: "rejected" | "unknown" | null;
  constructor(status: number, message: string, code?: string, options?: { outcome?: "rejected" | "unknown" | null });
}
export const PROVIDER_OUTCOME: Readonly<{ REJECTED: "rejected"; UNKNOWN: "unknown" }>;
export function isDefiniteProviderRejection(error: unknown): boolean;
export function redactedErrorText(error: unknown): string;

export const BILLING_EVENTS: readonly string[];
export function billingEvent(name: string, fields?: Record<string, unknown>, labels?: Record<string, string>): void;
export const billingLogger: { info(message: string, fields?: unknown): unknown; warn(message: string, fields?: unknown): unknown; error(message: string, fields?: unknown): unknown };
export const billingMetrics: { snapshot(): { counters: Array<{ name: string; labels: Record<string, string>; value: number }> }; reset(): void };

export function billingEnforcementMode(env?: any): "observe" | "enforce";

export const TRANSITION_SOURCES: readonly string[];
export const TRANSITIONS: Readonly<Record<string, readonly string[]>>;
export const PROVIDER_STATUS_MAP: Readonly<Record<string, string>>;
export const PAID_STATUSES: readonly string[];
export const TERMINAL_STATUSES: readonly string[];
export function canTransition(from: string, to: string): boolean;
export function assertTransition(from: string, to: string, source: string): void;
export function mapProviderSubscriptionStatus(status: unknown): string | null;
export function hasWriteAccess(subscription: Record<string, unknown> | null, now?: Date): boolean;
export function shouldApplyProviderEvent(currentEventAt: string | Date | null, incomingEventAt: string | Date | null): boolean;
export function billingStateKey(input: { status: string; pricingModel: string | null; cancelAtCycleEnd?: boolean; checkoutPhase?: string | null; reconciliationRequired?: boolean }): string;

export const COMMERCIAL_MODEL: Readonly<{
  currency: "INR";
  free: { code: "free"; includedUsers: number; pricePaise: number };
  standard: { code: "standard"; includedUsers: number; perAdditionalUserPaise: number; billingPeriod: "monthly" };
  custom: { code: "enterprise" };
}>;
export const MAX_SEATED_USERS: number;
export function calculateSeatCharge(input: { includedUsers: number; perUserPaise: number | string; totalUsers: number }): {
  totalUsers: number;
  includedUsers: number;
  billableSeats: number;
  monthlyPaise: number;
};
export function currentPrice(client: Client, planCode: string): Promise<any>;
export function salesContact(env?: any): string | null;
export type PlanCatalogueEntry = {
  priceId: string;
  code: string;
  name: string;
  description: string;
  features: string[];
  availability: "available" | "coming_soon" | "contact_sales";
  pricingModel: "free" | "per_seat" | "flat" | "custom";
  includedUsers: number | null;
  perUserPricePaise: number | null;
  currency: string;
  current: boolean;
  purchasable: boolean;
  contactSales: boolean;
  salesContactUrl: string | null;
};
export function listPlanCatalogue(client: Client, organizationId?: string | null, env?: any): Promise<PlanCatalogueEntry[]>;
export function buildProviderPlanPayload(price: Record<string, unknown>): Record<string, unknown>;
export function ensureProviderPlan(client: Client, provider: BillingProvider, price: Record<string, unknown>): Promise<string>;

export const SEAT_OVERAGE_GRACE_DAYS: number;
export type SeatStatus = {
  planCode: string | null;
  planName: string | null;
  pricingModel: string | null;
  includedUsers: number | null;
  paidSeats: number;
  pendingPaidSeats: number | null;
  capacity: number | null;
  activeMembers: number;
  pendingInvitations: number;
  used: number;
  available: number | null;
  overCapacity: boolean;
  perUserPricePaise: number | null;
  seatOverageSince: string | null;
};
export function countBillableUsers(client: Client, organizationId: string, options?: { excludeInvitationId?: string | null }): Promise<{ members: number; pending: number }>;
export function getSeatStatus(client: Client, organizationId: string, options?: { excludeInvitationId?: string | null }): Promise<SeatStatus>;
export function assertSeatAvailable(
  client: Client,
  organizationId: string,
  options?: { additional?: number; excludeInvitationId?: string | null; env?: any },
): Promise<(SeatStatus & { wouldBlock?: boolean }) | null>;
export function withSeatLock<T>(client: Client, organizationId: string, work: () => Promise<T>): Promise<T>;
export function reconcileSeatOverage(client: Client, organizationId: string): Promise<SeatStatus>;
export function changeSubscriptionSeats(client: Client, ctx: BillingContext, input: { users: number }, provider: BillingProvider): Promise<Record<string, unknown>>;
export function finalizeSeatChange(client: Client, changeId: string, remote: unknown, options?: { actorUserId?: string | null }): Promise<Record<string, unknown>>;
export function recoverSeatChange(client: Client, change: Record<string, unknown>, provider: BillingProvider): Promise<Record<string, unknown>>;

export const LIVE_CHECKOUT_STATUSES: readonly string[];
export function startSeatCheckout(client: Client, ctx: BillingContext, input: { planPriceId?: string; users: number }, provider: BillingProvider): Promise<Record<string, unknown>>;
export function confirmSeatCheckout(
  client: Client,
  ctx: BillingContext,
  input: { checkoutSessionId: string; razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string },
  provider: BillingProvider,
): Promise<{ state: string; alreadyConfirmed?: boolean; paidSeats?: number }>;
export function verifyCheckoutWithProvider(client: Client, sessionId: string, provider: BillingProvider, options?: { actorUserId?: string | null }): Promise<{ state: string }>;
export function checkoutEntityMismatches(session: Record<string, unknown>, entity: Record<string, unknown>): string[];
export function applyCheckoutEntityInTx(
  client: Client,
  session: Record<string, unknown>,
  entity: Record<string, unknown>,
  options: { source: string; actorUserId?: string | null; eventAt?: Date | null },
): Promise<{ state: string }>;
export function recoverCheckoutSession(client: Client, sessionId: string, provider: BillingProvider): Promise<string>;
export function liveCheckoutForOrganization(client: Client, organizationId: string): Promise<Record<string, unknown> | null>;

export function applyPaidPlanInTx(client: Client, input: Record<string, unknown>): Promise<unknown>;
export function revertToFreeInTx(client: Client, organizationId: string, reason: string, actorUserId?: string | null): Promise<void>;
export function applySubscriptionEntityInTx(
  client: Client,
  input: { organizationId: string; entity: Record<string, any>; eventAt: Date | null; source: string },
): Promise<{ status: string; outcome?: string; reason?: string }>;
export function cancelPaidSubscription(client: Client, ctx: BillingContext, provider: BillingProvider): Promise<Record<string, unknown>>;
export function finalizeCancellation(client: Client, organizationId: string, remote: unknown, options?: { actorUserId?: string | null }): Promise<Record<string, unknown>>;
export function recoverCancellation(client: Client, sub: Record<string, unknown>, provider: BillingProvider): Promise<Record<string, unknown>>;
export function cancelSubscriptionImmediately(client: Client, input: { organizationId: string; actorUserId?: string | null; reason: string }, provider: BillingProvider): Promise<{ state: string }>;
export function provisionCustomSubscription(
  client: Client,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    users: number;
    modules: string[];
    limits?: Record<string, number>;
    contractReference: string;
    startsAt: string | Date;
    endsAt: string | Date;
    notes?: string;
  },
): Promise<Record<string, unknown>>;

export function minimalPaymentSnapshot(payment: Record<string, unknown>): Record<string, unknown>;
export function minimalInvoiceSnapshot(invoice: Record<string, unknown>): Record<string, unknown>;
export function upsertPaymentInTx(client: Client, input: Record<string, unknown>): Promise<void>;
export function upsertInvoiceInTx(client: Client, input: Record<string, unknown>): Promise<void>;
export function recordRefundInTx(client: Client, input: Record<string, unknown>): Promise<boolean>;

export const MAX_WEBHOOK_BODY_BYTES: number;
export const MAX_WEBHOOK_ATTEMPTS: number;
export function webhookRetryDelayMinutes(attempts: number): number;
export function parseWebhookEnvelope(rawBody: string): Record<string, any>;
export function sanitizeWebhookEvent(event: Record<string, any>): Record<string, any>;
export function ingestBillingWebhook(
  client: Client,
  input: { rawBody: string; signature: string | null; eventIdHeader: string | null },
  provider: BillingProvider,
): Promise<{ duplicate: boolean; eventId: string }>;
export function claimWebhookEvents(client: Client, input: { workerId: string; limit?: number; leaseSeconds?: number }): Promise<Array<Record<string, any>>>;
export function processClaimedWebhookEvent(client: Client, row: Record<string, any>, workerId: string): Promise<string>;
export function applyWebhookEventInTx(client: Client, event: Record<string, any>): Promise<{ status: string; organizationId: string | null; note?: string }>;

export function providerSubscriptionMismatches(sub: Record<string, unknown>, remote: Record<string, unknown>): string[];
export function reconcileSubscription(client: Client, organizationId: string, provider: BillingProvider, options?: { actorUserId?: string | null }): Promise<Record<string, unknown>>;
export function syncSubscriptionFromProvider(client: Client, ctx: BillingContext, provider: BillingProvider): Promise<Record<string, unknown>>;

export function runBillingMaintenance(input: {
  connect: () => Promise<Client & { release?: () => void }>;
  provider: BillingProvider;
  workerId: string;
  batchSize?: number;
  leaseSeconds?: number;
  steps?: Array<"webhooks" | "checkouts" | "seats" | "cancellations" | "reconciliation"> | null;
}): Promise<Record<string, any>>;

export const TAX_INVOICE_SETTINGS: readonly string[];
export function taxInvoiceReadiness(env?: any): { available: false; configured: boolean; missing: string[] };
export function getBillingOverview(client: Client, organizationId: string, env?: any): Promise<any>;
export function saveBillingProfile(client: Client, ctx: BillingContext, input: Record<string, string | undefined>): Promise<Record<string, unknown>>;
export function getBillingHealth(client: Client, organizationId: string): Promise<any>;

export * from "./entitlements.js";

export function verifyCheckoutSignature(input: { paymentId?: string; subscriptionId?: string; signature?: string }, keySecret: string): boolean;
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secrets: string[]): boolean;
export function razorpayConfig(env?: Record<string, string | undefined>): {
  keyId: string;
  keySecret: string;
  webhookSecrets: string[];
  timeoutMs: number;
  checkoutEnabled: boolean;
  mode: "live" | "test";
  apiBase: string;
};
export function validateRazorpayConfig(env?: Record<string, string | undefined>): string[];
export function createRazorpayProvider(env?: Record<string, string | undefined>, fetchImpl?: typeof fetch): BillingProvider;
