import { Badge, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime, dueLabel, dueState } from "@/shared/format/human";

import type { Lead, LeadStatus } from "./api/leads-api";

export const STATUS_LABELS: Record<LeadStatus, string> = {
  open: "Open",
  qualified: "Qualified",
  disqualified: "Disqualified",
  converted: "Converted",
};

const STATUS_TONE: Record<LeadStatus, "info" | "success" | "danger" | "neutral"> = {
  open: "info",
  qualified: "success",
  disqualified: "danger",
  converted: "neutral",
};

export const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const RATING_OPTIONS = [
  { value: "cold", label: "Cold" },
  { value: "warm", label: "Warm" },
  { value: "hot", label: "Hot" },
];

// A lead may have only a person, only a company, or both.
export function leadName(lead: Pick<Lead, "fullName" | "companyName" | "code">) {
  return lead.fullName || lead.companyName || lead.code;
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

// The stage's name is whatever the organization calls it; the lead carries it.
export function LeadStageBadge({ name }: { name: string }) {
  return <Badge tone="brand">{name}</Badge>;
}

export const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

// Stale is calculated (an open lead with no activity for a while), never a status.
export function StaleBadge({ lead }: { lead: Pick<Lead, "isStale" | "daysSinceActivity"> }) {
  if (!lead.isStale) return null;
  return <Badge tone="warning">Stale · no activity for {days(lead.daysSinceActivity)}</Badge>;
}

export function RatingBadge({ rating }: { rating: Lead["rating"] }) {
  return <Badge tone={rating === "hot" ? "danger" : rating === "warm" ? "warning" : "neutral"}>{rating}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Lead["priority"] }) {
  return <Badge tone={priority === "high" ? "danger" : priority === "medium" ? "info" : "neutral"}>{priority}</Badge>;
}

// "Due today" / "Overdue by 2 days" with the exact time beneath it.
export function FollowUpCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-text-muted">None</span>;
  const state = dueState(value);
  return (
    <span className="flex flex-col">
      <span className={state === "overdue" ? "font-medium text-danger" : state === "today" ? "font-medium text-warning" : undefined}>{dueLabel(value)}</span>
      <span className="text-xs text-text-muted">{formatDateTime(value)}</span>
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
