"use client";

import { verifyCheckout, type Checkout, type VerifyResult } from "./api/billing-api";

// Razorpay Checkout in the browser. Every outcome is reported precisely; we
// never tell someone they were not charged, because a payment can complete
// after the window closes or the browser loses the response.
export type CheckoutOutcome =
  | { kind: "confirmed"; result: VerifyResult }
  | { kind: "closed" }
  | { kind: "declined"; reason: string }
  | { kind: "unconfirmed" };

type RazorpayResponse = { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, handler: (response: { error?: { description?: string } }) => void): void };
  }
}

export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout is only available in the browser."));
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The payment window could not be loaded. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

export function openRazorpay(session: Checkout): Promise<CheckoutOutcome> {
  return new Promise((resolve) => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) return resolve({ kind: "closed" });
    let settled = false;
    const finish = (outcome: CheckoutOutcome) => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };
    const instance = new Razorpay({
      key: session.keyId,
      subscription_id: session.providerSubscriptionId,
      name: session.name,
      description: session.description,
      prefill: session.prefill,
      theme: { color: "#4338ca" },
      handler: (response: RazorpayResponse) => {
        verifyCheckout({ checkoutSessionId: session.checkoutSessionId, ...response }).then(
          (result) => finish({ kind: "confirmed", result }),
          () => finish({ kind: "unconfirmed" }),
        );
      },
      modal: { ondismiss: () => finish({ kind: "closed" }) },
    });
    instance.on("payment.failed", (response) => finish({ kind: "declined", reason: response.error?.description?.slice(0, 200) || "The bank or payment method declined it." }));
    instance.open();
  });
}

export const CHECKOUT_MESSAGES = {
  active: "Standard is active. Thank you.",
  pending: "Verifying your payment with the payment provider. This page updates automatically; do not pay again.",
  attention: "We could not match this payment automatically and have flagged it for billing support. Please do not pay again.",
  closed: "Checkout did not complete in this window. We are checking the payment status automatically. Do not retry immediately if your bank shows a debit.",
  unconfirmed: "We could not confirm the payment from this browser. We are checking automatically; do not pay again.",
  declined: (reason: string) => `The payment did not go through: ${reason} You can try again with another payment method.`,
};
