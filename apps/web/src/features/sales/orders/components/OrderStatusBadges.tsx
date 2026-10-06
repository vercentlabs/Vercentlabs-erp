import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const ORDER: Record<string, Tone> = { draft: "neutral", confirmed: "info", cancelled: "danger", closed: "success" };
const FULFILLMENT: Record<string, Tone> = {
  not_delivered: "neutral", partially_delivered: "warning", delivered: "success", complete: "success", cancelled: "neutral", not_required: "neutral",
};
const RESERVATION: Record<string, Tone> = { not_required: "neutral", not_reserved: "warning", partially_reserved: "warning", fully_reserved: "success" };
const INVOICING: Record<string, Tone> = { not_invoiced: "neutral", partially_invoiced: "warning", fully_invoiced: "success" };

// An order's own status is one of four. Beside it, reservation, fulfilment and
// invoicing each have their own, worked out by the server from the documents
// themselves. Payment is Finance's, read from the order's invoices.
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
export function ReservationStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={RESERVATION[status] ?? "neutral"}>{label}</StatusBadge>;
}
export function InvoicingStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={INVOICING[status] ?? "neutral"}>{label}</StatusBadge>;
}
// Derived: the requested delivery date has passed with goods still to deliver.
export function OverdueDeliveryBadge() {
  return <StatusBadge tone="danger">Overdue delivery</StatusBadge>;
}
