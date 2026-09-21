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

const post = <T>(path: string, body: unknown, method = "POST") =>
  fetch(`/api/billing/${path}`, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(parse<T>);

export type Plan = {
  priceId: string;
  code: string;
  name: string;
  description: string;
  features: string[];
  availability: "available" | "coming_soon";
  pricingModel: "free" | "per_seat" | "flat";
  includedUsers: number | null;
  perUserPricePaise: number | null;
  current: boolean;
  purchasable: boolean;
};

export type Overview = {
  subscription: { status: string; planCode: string; planName: string; pricingModel: string; currentPeriodEndsAt: string | null; cancelAtCycleEnd: boolean; graceEndsAt: string | null; hasProviderSubscription: boolean; monthlyPaise: number };
  seats: { includedUsers: number | null; paidSeats: number; pendingPaidSeats: number | null; capacity: number | null; activeMembers: number; pendingInvitations: number; used: number; available: number | null; overCapacity: boolean; perUserPricePaise: number | null };
  overageGraceEndsAt: string | null;
  plans: Plan[];
  profile: { legal_name: string; billing_email: string | null; phone: string | null; gstin: string | null; billing_address: Record<string, string> } | null;
  invoices: Array<{ id: string; provider_invoice_id: string; amount_paise: string | number; amount_paid_paise: string | number; status: string; invoice_url: string | null; issued_at: string | null; paid_at: string | null }>;
  payments: Array<{ id: string; provider_payment_id: string; amount_paise: string | number; status: string; method: string | null; captured_at: string | null; created_at: string }>;
  seatChanges: Array<{ id: string; from_paid_seats: number; to_paid_seats: number; effective: string; status: string; reason: string; created_at: string }>;
  checkoutEnabled: boolean;
  enforcementMode: "observe" | "enforce";
};

export type Checkout = { checkoutSessionId: string; keyId: string; providerSubscriptionId: string; name: string; description: string; prefill: { name: string; email: string; contact?: string }; monthlyPaise: number; paidSeats: number; totalUsers: number };

export const getOverview = () => fetch("/api/billing/summary", { credentials: "same-origin" }).then(parse<{ overview: Overview }>).then((r) => r.overview);
export const startCheckout = (planPriceId: string, users: number) => post<Checkout>("checkout", { planPriceId, users });
export const verifyCheckout = (input: { checkoutSessionId: string; razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => post<{ message: string }>("verify", input);
export const changeSeats = (users: number) => post<{ effective: "now" | "cycle_end"; paidSeats: number; pendingPaidSeats?: number }>("seats", { users });
export const cancelSubscription = (cancelAtCycleEnd: boolean) => post<{ effective: "now" | "cycle_end"; endsAt?: string }>("cancel", { cancelAtCycleEnd });
export const saveProfile = (input: Record<string, string>) => post<{ message: string }>("profile", input, "PATCH");
