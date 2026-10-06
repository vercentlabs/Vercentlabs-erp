import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const STATUS: Record<string, Tone> = { draft: "neutral", posted: "success", reversed: "danger", cancelled: "danger" };
const APPLICATION: Record<string, Tone> = { unapplied: "warning", partially_applied: "info", applied: "success", refunded: "success", settled: "success" };

// Draft → Posted, or Reversed / Cancelled; beside a posted one, how much of it was applied to invoices.
export function CreditNoteStatusBadges({ row }: { row: { status: string; statusLabel: string; financeStatus?: string; finance_status?: string; applicationStatus: string; applicationStatusLabel: string } }) {
  const awaiting = (row.financeStatus ?? row.finance_status) === "pending_approval";
  return (
    <span className="flex flex-wrap gap-1">
      <StatusBadge tone={awaiting ? "warning" : STATUS[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge>
      {APPLICATION[row.applicationStatus] && <StatusBadge tone={APPLICATION[row.applicationStatus]}>{row.applicationStatusLabel}</StatusBadge>}
    </span>
  );
}
