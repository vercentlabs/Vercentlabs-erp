import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const STATUS: Record<string, Tone> = { draft: "neutral", posted: "info", reversed: "danger", cancelled: "neutral" };
const PAYMENT: Record<string, Tone> = { unpaid: "warning", partially_paid: "warning", paid: "success" };

// The invoice's own status (Draft, Posted, Reversed), and beside it, for a posted
// invoice, its payment status and whether it is overdue: three separate things.
export function InvoiceStatusBadges({ row }: { row: { status: string; statusLabel: string; paymentStatus: string; paymentStatusLabel: string; overdue: boolean } }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={STATUS[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge>
      {row.status === "posted" && <StatusBadge tone={PAYMENT[row.paymentStatus] ?? "neutral"}>{row.paymentStatusLabel}</StatusBadge>}
      {row.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
    </span>
  );
}
