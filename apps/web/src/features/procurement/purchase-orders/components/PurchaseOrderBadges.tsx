"use client";

import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const LIFECYCLE: Record<string, Tone> = { draft: "neutral", confirmed: "info", closed: "success", cancelled: "danger" };
const RECEIPT: Record<string, Tone> = { not_required: "neutral", not_received: "neutral", partially_received: "warning", fully_received: "success", complete_with_cancellations: "success" };
const BILLING: Record<string, Tone> = { not_billed: "neutral", partially_billed: "warning", fully_billed: "success", complete_with_cancellation: "success", overbilled: "danger" };
const PAYMENT: Record<string, Tone> = { no_payable: "neutral", unpaid: "warning", partially_paid: "warning", paid: "success" };
const COMMUNICATION: Record<string, Tone> = { not_sent: "warning", sent: "info", acknowledged: "success" };
const LABELS: Record<string, string> = {
  not_required: "Not required", not_received: "Not received", partially_received: "Partially received", fully_received: "Fully received",
  complete_with_cancellations: "Complete with cancellations", not_billed: "Not billed", partially_billed: "Partially billed", fully_billed: "Fully billed",
  complete_with_cancellation: "Complete with cancellation", overbilled: "Overbilled",
  no_payable: "No payable yet", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid", not_sent: "Not sent", sent: "Sent", acknowledged: "Acknowledged",
  draft: "Draft", confirmed: "Confirmed", closed: "Closed", cancelled: "Cancelled",
};
const label = (status: string) => LABELS[status] ?? status.replace(/_/g, " ");

// The order's own status: one of four. Receiving, billing, payment and sending each stand beside it.
export function LifecycleBadge({ status, amending = false }: { status: string; amending?: boolean }) {
  return <StatusBadge tone={LIFECYCLE[status] ?? "neutral"}>{amending ? "Draft (amending)" : label(status)}</StatusBadge>;
}
export function ReceiptBadge({ status }: { status: string }) {
  return <StatusBadge tone={RECEIPT[status] ?? "neutral"}>{label(status)}</StatusBadge>;
}
export function BillingBadge({ status }: { status: string }) {
  return <StatusBadge tone={BILLING[status] ?? "neutral"}>{label(status)}</StatusBadge>;
}
export function PaymentBadge({ status }: { status: string }) {
  return <StatusBadge tone={PAYMENT[status] ?? "neutral"}>{`Payment: ${label(status)}`}</StatusBadge>;
}
export function CommunicationBadge({ status }: { status: string }) {
  return <StatusBadge tone={COMMUNICATION[status] ?? "neutral"}>{`Supplier: ${label(status)}`}</StatusBadge>;
}
export function OverdueBadge() {
  return <StatusBadge tone="danger">Overdue receipt</StatusBadge>;
}
export const statusText = label;
