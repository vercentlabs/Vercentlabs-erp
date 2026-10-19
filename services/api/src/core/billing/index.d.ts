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
export function billingStateKey(input: { status: string; pricingModel: string | null; cancelAtCycleEnd?: boolean; checkoutPhase?: string | null; reconciliationRequired?: boolean; trialEndsAt?: string | Date | null; now?: Date }): string;
export function trialHasEnded(trialEndsAt: string | Date | null | undefined, now?: Date): boolean;

export const BILLING_PERIODS: readonly ["monthly", "yearly"];
export type BillingPeriod = "monthly" | "yearly";
export const COMMERCIAL_MODEL: Readonly<{
  currency: "INR";
  free: { code: "free"; includedUsers: number; pricePaise: number; moduleAllowance: number };
  standard: { code: "standard"; includedUsers: number; perUserMonthlyPaise: number; perUserYearlyPaise: number };
  custom: { code: "enterprise" };
}>;
export function gstRatePercent(env?: any): number;
export function pricesIncludeGst(env?: any): boolean;
export function chargedPerUserPaise(pricePaise: number | string, env?: any): number;
export const MAX_SEATED_USERS: number;
export function calculateSeatCharge(input: { includedUsers: number | null; perUserPaise: number | string; totalUsers: number; env?: any }): {
  totalUsers: number;
  includedUsers: number;
  billableSeats: number;
  pricePaise: number;
  chargedPaise: number;
  gstPaise: number;
  monthlyPaise: number;
};
export function currentPrice(client: Client, planCode: string, billingPeriod?: string | null): Promise<any>;
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
  moduleAllowance: number | null;
  perUserPricePaise: number | null;
  currency: string;
  prices: Partial<Record<BillingPeriod, { priceId: string; perUserPaise: number; perUserMonthlyPaise: number; perUserChargedPaise: number }>>;
  pricesIncludeGst: boolean;
  gstRatePercent: number;
  current: boolean;
  currentBillingPeriod: string | null;
  purchasable: boolean;
  contactSales: boolean;
  salesContactUrl: string | null;
};
export function listPlanCatalogue(client: Client, organizationId?: string | null, env?: any): Promise<PlanCatalogueEntry[]>;
export function buildProviderPlanPayload(price: Record<string, unknown>, env?: any): Record<string, unknown>;
export function ensureProviderPlan(client: Client, provider: BillingProvider, price: Record<string, unknown>, env?: any): Promise<string>;

// Free plan app choice (app-choice.js)
export const APP_SWITCH_INTERVAL_DAYS: number;
export type AppChoice = {
  planCode: string; planName: string; allowance: number | null; selected: string[] | null; grandfathered: boolean; needsChoice: boolean;
  canSwitch: boolean; nextSwitchAt: string | null; lastSwitchAt: string | null; switchIntervalDays: number;
};
export function getAppChoice(client: Client, organizationId: string): Promise<AppChoice>;
export function effectiveModulesFor(input: { moduleAllowance: number | null | undefined; selectedModules: unknown; modulesSnapshot: unknown }): string[];
export function chooseApps(client: Client, ctx: BillingContext & { roleSlugs?: readonly string[] }, input: { module?: string; modules?: string[] }): Promise<AppChoice & { changed: boolean }>;

// Usage (usage.js)
export const USAGE_WARNING_PERCENT: number;
export declare class UsageLimitError extends Error { status: number; code: string; details?: unknown }
export function storageUsedBytes(client: Client, organizationId: string): Promise<number>;
export function assertStorageAvailable(client: Client, organizationId: string, additionalBytes: number, env?: any): Promise<{ usedBytes: number; limitBytes: number } | null>;
export function countOutboundMessages(client: Client, organizationId: string, input?: { quantity?: number; channel?: string; idempotencyKey?: string }, env?: any): Promise<{ replayed: boolean; quantity: number | null }>;
export type UsageOverview = {
  storage: { usedBytes: number; limitBytes: number; percent: number };
  messages: { used: number; limit: number; percent: number };
  warningPercent: number;
  enforced: boolean;
};
export function getUsageOverview(client: Client, organizationId: string, env?: any): Promise<UsageOverview>;

// Renewals and Vercentlabs' own tax invoices
export const RENEWAL_NOTICE_DAYS: Readonly<{ yearly: number; monthly: number }>;
export function sendRenewalReminders(client: Client, options?: { limit?: number; env?: any }): Promise<number>;
export function indiaFinancialYear(at: string | Date): { label: string; code: string; day: string };
export function splitGst(chargedPaise: number, ratePercent: number, states: { supplierStateCode: string; customerStateCode: string | null }): { taxable: number; tax: number; cgst: number; sgst: number; igst: number; intraState: boolean };
export function issueTaxInvoiceForPaymentInTx(client: Client, input: { organizationId: string; providerPaymentId: string }, env?: any): Promise<Record<string, any> | null>;
export function issueCreditNoteForRefundInTx(client: Client, input: { organizationId: string; providerPaymentId: string; providerRefundId: string; amountPaise: number }, env?: any): Promise<Record<string, any> | null>;
export function issueMissingTaxInvoices(client: Client, env?: any, options?: { limit?: number }): Promise<number>;
export function getTaxDocument(client: Client, organizationId: string, id: string): Promise<Record<string, any>>;
export function taxDocumentModel(row: Record<string, any>): Record<string, unknown>;
export function renderTaxDocumentPdf(client: Client, organizationId: string, id: string): Promise<{ fileName: string; body: Uint8Array | Buffer }>;

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
  billingPeriod: string | null;
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
export function startSeatCheckout(client: Client, ctx: BillingContext, input: { planPriceId?: string; users: number; billingPeriod?: BillingPeriod }, provider: BillingProvider, env?: any): Promise<Record<string, unknown>>;
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
export function switchTrialToFree(client: Client, ctx: BillingContext & { roleSlugs?: readonly string[] }): Promise<{ planCode: "free" }>;
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
  steps?: Array<"webhooks" | "checkouts" | "seats" | "cancellations" | "reconciliation" | "renewals" | "tax_invoices"> | null;
}): Promise<Record<string, any>>;

export const TAX_INVOICE_SETTINGS: readonly string[];
export function taxInvoiceReadiness(env?: any): { available: boolean; configured: boolean; missing: string[]; problems: string[] };
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
