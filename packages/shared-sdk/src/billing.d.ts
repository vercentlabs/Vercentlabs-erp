import type { BillingPlanPrice, BillingSummary } from "@vercentlabs/shared-types";

export interface BillingCheckoutResult {
  checkoutSessionId: string;
  keyId: string;
  providerSubscriptionId: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact?: string };
}

export interface BillingClient {
  listPlans(): Promise<{ ok: true; plans: BillingPlanPrice[] }>;
  getSummary(): Promise<{ ok: true; summary: BillingSummary }>;
  createCheckout(
    planPriceId: string,
  ): Promise<{ ok: true } & BillingCheckoutResult>;
  verifyCheckout(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  cancelSubscription(
    cancelAtCycleEnd?: boolean,
  ): Promise<Record<string, unknown>>;
  updateProfile(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export function createBillingClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): BillingClient;
