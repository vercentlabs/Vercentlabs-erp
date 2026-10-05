import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const ORDER: Record<string, Tone> = { draft: "neutral", confirmed: "info", cancelled: "danger", closed: "success" };
const FULFILLMENT: Record<string, Tone> = {
  not_started: "neutral", partially_reserved: "warning", reserved: "info", partially_delivered: "warning", delivered: "success", cancelled: "neutral", not_required: "neutral",
};
const INVOICING: Record<string, Tone> = { not_invoiced: "neutral", partially_invoiced: "warning", fully_invoiced: "success" };

// An order carries three statuses, each worked out by the server: the order
// itself, what has been reserved and delivered, and what has been invoiced.
// Payment is the invoice's, not the order's.
export function OrderStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={ORDER[status] ?? "neutral"}>{label}</StatusBadge>;
}
const CONFIRMATION: Record<string, Tone> = { none: "neutral", not_sent: "warning", sent: "info", acknowledged: "success", superseded: "neutral" };
// Whether the Order Confirmation went out: never part of the order's own status.
export function ConfirmationStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={CONFIRMATION[status] ?? "neutral"}>{`Confirmation: ${label}`}</StatusBadge>;
}
export function FulfillmentStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={FULFILLMENT[status] ?? "neutral"}>{label}</StatusBadge>;
}
export function InvoicingStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={INVOICING[status] ?? "neutral"}>{label}</StatusBadge>;
}
