import { Badge, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";

import type { FollowUp, FollowUpStatus, FollowUpType } from "./api/follow-ups-api";

export const STATUS_LABELS: Record<FollowUpStatus, string> = { scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled" };
const STATUS_TONE: Record<FollowUpStatus, "info" | "success" | "neutral"> = { scheduled: "info", completed: "success", cancelled: "neutral" };
export const TYPE_LABELS: Record<FollowUpType, string> = { call: "Call", email: "Email", meeting: "Meeting", demo: "Demo", other: "Other" };
export const RELATED_LABELS: Record<string, string> = { lead: "Lead", party: "Account", contact: "Contact", opportunity: "Opportunity" };

export function FollowUpStatusBadge({ status }: { status: FollowUpStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

export function FollowUpTypeBadge({ type }: { type: FollowUpType }) {
  return <Badge tone="neutral">{TYPE_LABELS[type] ?? type}</Badge>;
}

// Overdue, today and upcoming come from the scheduled time, never from a stored status.
export function FollowUpWhen({ followUp }: { followUp: Pick<FollowUp, "scheduledDate" | "scheduledTime" | "isOverdue" | "isDueToday"> }) {
  if (!followUp.scheduledDate) return <span className="text-text-muted">No date</span>;
  const label = `${followUp.isDueToday ? "Today" : formatDate(followUp.scheduledDate)}${followUp.scheduledTime ? ` ${followUp.scheduledTime}` : ""}`;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap ${followUp.isOverdue ? "font-medium text-danger" : followUp.isDueToday ? "font-medium" : ""}`}>
      {label}
      {followUp.isOverdue && <Badge tone="danger">Overdue</Badge>}
    </span>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

// Snooze choices: the reminder fires again then; the follow-up's own date does not move.
export function snoozeChoices(): Array<{ id: string; label: string; minutes?: number; until?: () => string }> {
  return [
    { id: "10", label: "10 minutes", minutes: 10 },
    { id: "60", label: "1 hour", minutes: 60 },
    {
      id: "tomorrow", label: "Tomorrow, 9:00",
      until: () => { const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(9, 0, 0, 0); return at.toISOString(); },
    },
  ];
}
