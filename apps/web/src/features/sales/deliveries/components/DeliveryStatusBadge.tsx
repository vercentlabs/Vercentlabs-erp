import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const STATUS: Record<string, Tone> = { draft: "neutral", ready: "warning", dispatched: "info", delivered: "success", cancelled: "danger" };
const INVOICING: Record<string, Tone> = { not_invoiced: "neutral", partially_invoiced: "warning", fully_invoiced: "success" };

// Draft → Ready to dispatch → Dispatched (in transit) → Delivered; or Cancelled before dispatch.
export function DeliveryStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={STATUS[status] ?? "neutral"}>{label}</StatusBadge>;
}
export function DeliveryInvoicingBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={INVOICING[status] ?? "neutral"}>{label}</StatusBadge>;
}
