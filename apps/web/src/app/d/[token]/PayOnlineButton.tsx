"use client";

// Pay now on a shared invoice (Sales report Phase 3): opens Razorpay Checkout for what is due, with the company's own account; the
// payment is confirmed on the server and recorded on the invoice. A payment that completes after the window closes is recorded by
// Razorpay's webhook, so the customer is never told they were not charged.
import { useState } from "react";

type Checkout = { keyId: string; orderId: string; amount: number; currency: string; name: string; description: string };
type Answer = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayWindow = Window & { Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, handler: (response: { error?: { description?: string } }) => void): void } };

function loadCheckout(): Promise<void> {
  const page = window as RazorpayWindow;
  if (page.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The payment window could not be loaded. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

export function PayOnlineButton({ token, label }: { token: string; label: string }) {
  const [state, setState] = useState<"idle" | "working" | "paid" | "pending">("idle");
  const [message, setMessage] = useState<string | null>(null);
  async function pay() {
    setState("working");
    setMessage(null);
    try {
      const started = await fetch(`/api/sales/public/documents/${encodeURIComponent(token)}/pay`, { method: "POST" }).then((response) => response.json());
      if (!started.ok) throw new Error(started.message ?? "Online payment could not be started.");
      await loadCheckout();
      const checkout = started.checkout as Checkout;
      const Razorpay = (window as RazorpayWindow).Razorpay!;
      const instance = new Razorpay({
        key: checkout.keyId, order_id: checkout.orderId, amount: checkout.amount, currency: checkout.currency, name: checkout.name, description: checkout.description,
        handler: async (answer: Answer) => {
          const confirmed = await fetch(`/api/sales/public/documents/${encodeURIComponent(token)}/pay/confirm`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: answer.razorpay_order_id, paymentId: answer.razorpay_payment_id, signature: answer.razorpay_signature }),
          }).then((response) => response.json()).catch(() => ({ ok: false }));
          setState(confirmed.ok ? "paid" : "pending");
          if (!confirmed.ok) setMessage(confirmed.message ?? "We could not confirm the payment here. If money left your account, it will show on the invoice shortly.");
        },
        modal: { ondismiss: () => setState((current) => (current === "working" ? "idle" : current)) },
      });
      instance.on("payment.failed", (response) => { setState("idle"); setMessage(response.error?.description ?? "The payment did not go through. Try again."); });
      instance.open();
    } catch (error) {
      setState("idle");
      setMessage((error as Error).message);
    }
  }
  if (state === "paid") return <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-3 py-2 text-sm">Payment received. Thank you.</p>;
  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => void pay()} disabled={state === "working"}
        className="inline-flex h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-text-inverse hover:bg-brand-hover disabled:opacity-60">
        {state === "working" ? "Opening the payment window…" : label}
      </button>
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
    </div>
  );
}
