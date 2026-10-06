import { StatusBadge } from "@vercentlabs/design-system";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const STATUS: Record<string, Tone> = { draft: "neutral", received: "success", cancelled: "danger" };
const CREDIT: Record<string, Tone> = { awaiting: "warning", credited: "info", not_required: "neutral" };

// Draft → Received, or Cancelled; beside it, for a received return, whether a credit note is owed.
export function ReturnStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={STATUS[status] ?? "neutral"}>{label}</StatusBadge>;
}
export function ReturnCreditBadge({ status, label }: { status: string; label: string }) {
  if (!CREDIT[status] || status === "not_required") return null;
  return <StatusBadge tone={CREDIT[status]}>{label}</StatusBadge>;
}
