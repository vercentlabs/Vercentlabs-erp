import { StatusBadge } from "@vercentlabs/design-system";

const TONES: Record<string, "success" | "neutral" | "info" | "warning" | "danger"> = {
  draft: "neutral", awaiting_approval: "warning", confirmed: "info", sent: "info", accepted: "success", rejected: "danger", cancelled: "neutral",
  superseded: "neutral", expired: "warning",
};

// A quotation's status as the server reports it (Expired is derived from Valid Until).
export function QuotationStatusBadge({ status, label }: { status: string; label: string }) {
  return <StatusBadge tone={TONES[status] ?? "neutral"}>{label}</StatusBadge>;
}
