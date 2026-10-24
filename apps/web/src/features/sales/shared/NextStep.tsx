"use client";

// The one plain-language next step of a document (Sales audit: navigation and language). The statuses beside it stay exact — lifecycle,
// confirmation, stock kept aside, dispatch, billing, payment — but a small business reads this first: "Send to the customer",
// "Dispatch 40 left", "Raise the invoice", "₹12.4 L to collect".
import { money } from "./format";

const quantity = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 3 });

type Step = { text: string; tone: "action" | "waiting" | "money" };

export function NextStep({ step }: { step: Step | null }) {
  if (!step) return null;
  const tones = {
    action: "border-brand/40 bg-brand/10 text-brand",
    waiting: "border-warning-emphasis/40 bg-warning-soft text-warning",
    money: "border-danger-emphasis/30 bg-danger-soft text-danger",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[step.tone]}`}>
      <span className="opacity-70">Next:</span> {step.text}
    </span>
  );
}

export function quotationNextStep(quote: { status: string; converted_order_id: string | null }): Step | null {
  switch (quote.status) {
    case "draft": return { text: "Finalise and send", tone: "action" };
    case "awaiting_approval": return { text: "Waiting for approval", tone: "waiting" };
    case "confirmed": return { text: "Send to the customer", tone: "action" };
    case "sent": return { text: "Record the customer's answer", tone: "waiting" };
    case "accepted": return quote.converted_order_id ? null : { text: "Make the sales order", tone: "action" };
    case "expired": return { text: "Revise with a new valid-until date", tone: "action" };
    default: return null;
  }
}

export function orderNextStep(
  order: { status: string },
  delivery: { deliverable: boolean; remaining: number },
  tracking: { invoicing: { remaining: number }; payment: { balanceDue?: number; overdueBalance?: number } } | undefined,
  currency: string,
): Step | null {
  if (order.status === "draft") return { text: "Confirm the order", tone: "action" };
  if (order.status !== "confirmed") return null;
  if (delivery.deliverable && delivery.remaining > 0) return { text: `Dispatch ${quantity(delivery.remaining)} left`, tone: "action" };
  if (tracking && tracking.invoicing.remaining > 0) return { text: "Raise the invoice", tone: "action" };
  const due = tracking?.payment.balanceDue ?? 0;
  if (due > 0.005) return { text: `${money(currency, due)} to collect${(tracking?.payment.overdueBalance ?? 0) > 0.005 ? " (overdue)" : ""}`, tone: "money" };
  return null;
}

export function invoiceNextStep(invoice: { status: string; balanceDue: number; overdue: boolean; sent: boolean; currency_code: string }): Step | null {
  if (invoice.status === "draft") return { text: "Finalise the invoice", tone: "action" };
  if (["cancelled", "reversed"].includes(invoice.status)) return null;
  if (!invoice.sent) return { text: "Send to the customer", tone: "action" };
  if (invoice.balanceDue > 0.005) return { text: `${money(invoice.currency_code, invoice.balanceDue)} to collect${invoice.overdue ? " (overdue)" : ""}`, tone: "money" };
  return null;
}
