import { Badge, StatusBadge } from "@vercentlabs/design-system";

import type { Opportunity, OpportunityStatus } from "./api/opportunities-api";

export const STATUS_LABELS: Record<OpportunityStatus, string> = { open: "Open", won: "Won", lost: "Lost" };
const STATUS_TONE: Record<OpportunityStatus, "info" | "success" | "danger"> = { open: "info", won: "success", lost: "danger" };

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

export function OpportunityStatusBadge({ status }: { status: OpportunityStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

// The stage's name is whatever the organization calls it; the opportunity carries it.
export function OpportunityStageBadge({ opportunity }: { opportunity: Pick<Opportunity, "status" | "stageName" | "stageBeforeCloseName"> }) {
  // A closed deal shows the stage it was won or lost from.
  const name = opportunity.status === "open" ? opportunity.stageName : opportunity.stageBeforeCloseName ?? opportunity.stageName;
  return <Badge tone="brand">{name ?? "No stage"}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Opportunity["priority"] }) {
  return <Badge tone={priority === "high" ? "danger" : priority === "medium" ? "warning" : "neutral"}>{priority}</Badge>;
}

// Overdue and stale are calculated from the dates, never stored as a status.
export function OpportunityFlags({ opportunity }: { opportunity: Pick<Opportunity, "isOverdue" | "isStale" | "daysSinceActivity" | "archivedAt"> }) {
  return (
    <>
      {opportunity.isOverdue && <Badge tone="danger">Overdue</Badge>}
      {opportunity.isStale && <Badge tone="warning">Stale · no activity for {days(opportunity.daysSinceActivity)}</Badge>}
      {opportunity.archivedAt && <Badge tone="neutral">Archived</Badge>}
    </>
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
