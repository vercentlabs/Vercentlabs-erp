// Curated tenant-facing billing language. Internal/provider enums are never
// rendered directly; unknown values fall back to neutral wording.

type Tone = "success" | "warning" | "danger" | "neutral" | "info";

export const STATE_LABELS: Record<string, { label: string; tone: Tone; detail?: string }> = {
  free_active: { label: "Active", tone: "success" },
  active: { label: "Active", tone: "success" },
  authenticated: { label: "Being activated", tone: "info", detail: "Your payment method is authorised. The subscription activates with the first charge." },
  past_due: { label: "Payment overdue", tone: "warning" },
  halted: { label: "Billing paused", tone: "danger", detail: "Payments failed repeatedly. Business changes are paused until the payment is fixed." },
  cancel_at_cycle_end: { label: "Cancels at renewal", tone: "warning" },
  verification_pending: { label: "Verifying payment", tone: "info", detail: "We are confirming your payment with the payment provider. This page updates automatically." },
  attention_required: { label: "Needs billing support attention", tone: "warning", detail: "Your subscription details need a check by Vercentlabs billing support. Your access is not affected." },
  custom_active: { label: "Custom contract", tone: "success" },
  internal: { label: "Internal access", tone: "neutral" },
  inactive: { label: "Inactive", tone: "danger" },
};

export const stateLabel = (key: string) => STATE_LABELS[key] ?? { label: "Unknown", tone: "neutral" as Tone };

const PAYMENT_STATUS: Record<string, string> = {
  captured: "Paid",
  authorized: "Authorised",
  created: "Started",
  failed: "Failed",
  refunded: "Refunded",
};

export function paymentStatusLabel(status: string, refundStatus: string | null) {
  if (refundStatus === "full") return "Refunded";
  if (refundStatus === "partial") return "Partly refunded";
  return PAYMENT_STATUS[status] ?? "Processing";
}

const INVOICE_STATUS: Record<string, string> = { paid: "Paid", issued: "Issued", partially_paid: "Partly paid", cancelled: "Cancelled", expired: "Expired", draft: "Draft" };
export const invoiceStatusLabel = (status: string) => INVOICE_STATUS[status] ?? "Issued";

const METHOD: Record<string, string> = {
  card: "Card", upi: "UPI", netbanking: "Net banking", wallet: "Wallet", emandate: "e-Mandate", nach: "NACH", bank_transfer: "Bank transfer",
  paylater: "Pay later", cardless_emi: "Cardless EMI", emi: "EMI",
};
export const methodLabel = (method: string | null) => (method ? METHOD[method] ?? "Other" : "—");

export function seatChangeText(change: { operation: string; effective: string; status: string; from_paid_seats: number; to_paid_seats: number }, includedUsers: number) {
  const total = (paid: number) => paid + includedUsers;
  if (change.operation === "cancel_reduction") return "Scheduled reduction cancelled";
  const direction = change.to_paid_seats > change.from_paid_seats ? "Users increased" : "Users reduced";
  const when = change.effective === "now" ? "" : " at renewal";
  const status =
    { applied: "", pending: " (scheduled)", provider_pending: " (being confirmed)", failed: " (not applied)", cancelled: " (cancelled)", superseded: " (replaced)" }[change.status] ?? "";
  return `${direction}${when}: ${total(change.from_paid_seats)} → ${total(change.to_paid_seats)} users${status}`;
}

export const inr = (paise: number | string | null | undefined) => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
export const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
