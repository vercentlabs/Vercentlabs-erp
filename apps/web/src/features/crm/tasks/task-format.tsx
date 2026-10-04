import { Badge, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";

import type { Task, TaskPriority, TaskStatus } from "./api/tasks-api";

export const STATUS_LABELS: Record<TaskStatus, string> = { open: "Open", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" };
const STATUS_TONE: Record<TaskStatus, "info" | "warning" | "success" | "neutral"> = { open: "info", in_progress: "warning", completed: "success", cancelled: "neutral" };
export const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];
export const RELATED_LABELS: Record<string, string> = { lead: "Lead", party: "Account", contact: "Contact", opportunity: "Opportunity", campaign: "Campaign" };

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>;
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge tone={priority === "high" ? "danger" : priority === "medium" ? "warning" : "neutral"}>{PRIORITY_OPTIONS.find((entry) => entry.value === priority)?.label ?? priority}</Badge>;
}

// Overdue, today and upcoming are calculated from the due date, never stored.
export function TaskDue({ task }: { task: Pick<Task, "dueDate" | "dueTime" | "isOverdue" | "isDueToday" | "status"> }) {
  if (!task.dueDate) return <span className="text-text-muted">No due date</span>;
  const when = `${task.isDueToday ? "Today" : formatDate(task.dueDate)}${task.dueTime ? ` ${task.dueTime}` : ""}`;
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap ${task.isOverdue ? "font-medium text-danger" : task.isDueToday ? "font-medium" : ""}`}>
      {when}
      {task.isOverdue && <Badge tone="danger">Overdue</Badge>}
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
