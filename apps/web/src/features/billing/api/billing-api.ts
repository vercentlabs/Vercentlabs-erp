"use client";

export class BillingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new BillingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload;
}

const send = <T>(path: string, body: unknown, method = "POST") =>
  fetch(`/api/billing/${path}`, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(parse<T>);

export type Plan = {
  priceId: string;
  code: string;
  name: string;
  description: string;
  features: string[];
  availability: "available" | "coming_soon" | "contact_sales";
  pricingModel: "free" | "per_seat" | "flat" | "custom";
  includedUsers: number | null;
  perUserPricePaise: number | null;
  current: boolean;
  purchasable: boolean;
  contactSales: boolean;
  salesContactUrl: string | null;
};

export type Overview = {
  subscription: {
    state: string;
    planCode: string;
    planName: string;
    pricingModel: string;
    currentPeriodEndsAt: string | null;
    cancelAtCycleEnd: boolean;
    cancellationPending: boolean;
    graceEndsAt: string | null;
    hasProviderSubscription: boolean;
    monthlyPaise: number;
    legacyTerms: boolean;
    contractReference: string | null;
  };
  checkout: { phase: "preparing" | "awaiting_payment" | "verifying" | "attention"; totalUsers: number | null; expiresAt: string | null } | null;
  pendingSeatChange: { toPaidSeats: number; operation: string } | null;
  seats: {
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
  };
  overageGraceEndsAt: string | null;
  plans: Plan[];
  profile: {
    legal_name: string;
    billing_email: string | null;
    phone: string | null;
    gstin: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country_code: string | null;
  } | null;
  invoices: Array<{ id: string; provider_invoice_id: string; amount_paise: number; amount_paid_paise: number; status: string; invoice_url: string | null; issued_at: string | null; paid_at: string | null }>;
  payments: Array<{
    id: string;
    provider_payment_id: string;
    amount_paise: number;
    amount_refunded_paise: number;
    refund_status: string | null;
    status: string;
    method: string | null;
    captured_at: string | null;
    created_at: string;
  }>;
  seatChanges: Array<{ id: string; from_paid_seats: number; to_paid_seats: number; effective: string; status: string; operation: string; reason: string; created_at: string }>;
  taxInvoices: { available: boolean };
  checkoutEnabled: boolean;
  enforcementMode: "observe" | "enforce";
};

export type Checkout = {
  state: "awaiting_payment";
  checkoutSessionId: string;
  keyId: string;
  providerSubscriptionId: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact?: string };
  monthlyPaise: number;
  paidSeats: number;
  totalUsers: number;
};

export type VerifyResult = { state: "active" | "pending" | "attention" | "failed" | string; alreadyConfirmed?: boolean };
export type SeatResult = { state: "applied" | "scheduled" | "pending"; effective?: "now" | "cycle_end"; paidSeats?: number; pendingPaidSeats?: number | null; message?: string };
export type CancelResult = { state: "scheduled" | "pending" | "cancelled"; endsAt?: string | null };

export type Health = {
  needsAttention: boolean;
  subscription: {
    status: string;
    providerStatus: string | null;
    lastProviderSyncAt: string | null;
    lastProviderEventAt: string | null;
    reconciliationRequiredAt: string | null;
    reconciliationNote: string | null;
    cancellationState: string | null;
    pendingPaidSeats: number | null;
  };
  checkouts: Array<{ status: string; count: number; lastUpdate: string | null; attention: boolean }>;
  webhooks: { failed: number; deadLettered: number; queued: number; lastEventAt: string | null; lastEvent: { type: string; status: string; at: string | null } | null };
  seatOperations: Array<{ status: string; operation: string; to_paid_seats: number; attempts: number; has_error: boolean }>;
  recentAudit: Array<{ eventType: string; at: string; byUser: boolean }>;
};

export const getOverview = () => fetch("/api/billing/summary", { credentials: "same-origin" }).then(parse<{ overview: Overview }>).then((r) => r.overview);
export const getHealth = () => fetch("/api/billing/health", { credentials: "same-origin" }).then(parse<{ health: Health }>).then((r) => r.health);
export const startCheckout = (planPriceId: string, users: number) => send<Checkout>("checkout", { planPriceId, users });
export const verifyCheckout = (input: { checkoutSessionId: string; razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) =>
  send<VerifyResult>("verify", input);
export const changeSeats = (users: number) => send<SeatResult>("seats", { users });
export const cancelSubscription = () => send<CancelResult>("cancel", {});
export const saveProfile = (input: Record<string, string>) => send<{ message: string }>("profile", input, "PATCH");
export const syncNow = () => send<{ synced: boolean; checkout: string | null; providerStatus: string | null }>("sync", {});
