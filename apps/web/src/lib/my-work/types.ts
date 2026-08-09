// Prompt 8 (Shared Workspace Foundation) — the normalized shape every
// cross-module aggregation adapter (Tasks, Follow-ups & Reminders,
// Exceptions, Approvals, Notifications) maps its source rows into. Deliberately
// minimal — only what's safe to surface in a shared list (title/subtitle/
// due date/priority/href), never a full record payload. See
// docs/implementation/ERP_SHARED_WORKSPACE_008.md Section 6.
import type { ModuleId } from "@/lib/navigation/types";

export type WorkItemKind =
  | "task"
  | "follow_up"
  | "approval"
  | "exception"
  | "notification";

export type WorkItemUrgency = "overdue" | "due_today" | "upcoming" | "none";

export type WorkItem = {
  id: string;
  kind: WorkItemKind;
  moduleId?: ModuleId;
  source: string;
  title: string;
  subtitle?: string;
  dueAt?: string;
  urgency: WorkItemUrgency;
  priority?: string;
  status?: string;
  href: string;
};

export function classifyDueAt(dueAt: Date | string | null | undefined): WorkItemUrgency {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "none";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  if (due < now) return "overdue";
  if (due >= startOfToday && due < startOfTomorrow) return "due_today";
  return "upcoming";
}
