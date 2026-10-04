"use client";

// Browser client for the task routes under /api/crm/tasks. One function per
// task operation; a failed request throws TaskApiError with the server's
// message and code.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class TaskApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(TaskApiError, "body");

export type TaskStatus = "open" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high";
export type TaskRelatedType = "lead" | "party" | "contact" | "opportunity";
export type TaskViewKey = "mine" | "due_today" | "upcoming" | "overdue" | "high_priority" | "completed" | "created_by_me" | "team" | "all" | "cancelled";

export type Task = {
  id: string;
  number: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  relatedType: TaskRelatedType | "campaign" | null;
  relatedId: string | null;
  relatedName: string | null;
  relatedCode: string | null;
  relatedHref: string | null;
  accountId: string | null;
  accountName: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  dueAt: string | null;
  dueDate: string | null;
  dueTime: string | null;
  reminderOffsetMinutes: number | null;
  reminderAt: string | null;
  isOverdue: boolean;
  isDueToday: boolean;
  isUpcoming: boolean;
  completedAt: string | null;
  completedByName: string | null;
  completionNote: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

export type TaskCapabilities = Record<
  "view" | "viewTeam" | "viewAll" | "create" | "edit" | "complete" | "reopen" | "cancel" | "delete" | "assign" | "reassign" | "export",
  boolean
>;
type CodeLabel<Code extends string = string> = { code: Code; label: string };
export type TaskOptions = {
  views: Array<{ key: TaskViewKey; label: string }>;
  statuses: CodeLabel<TaskStatus>[];
  priorities: CodeLabel<TaskPriority>[];
  relatedTypes: CodeLabel<TaskRelatedType>[];
  reminderOptions: Array<{ minutes: number; label: string }>;
  // what a new task starts with (CRM Settings, Task Defaults)
  defaults?: { priority: TaskPriority; reminderOffsetMinutes: number | null };
  followUpTypes: string[];
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string; memberIds: string[] }>;
  currentUserId: string;
  capabilities: TaskCapabilities;
};
export type TaskListFilters = Partial<{
  view: TaskViewKey; search: string; status: string; priority: string; assigneeId: string; createdBy: string; relatedType: string; relatedId: string;
  accountId: string; leadId: string; opportunityId: string; contactId: string; dueFrom: string; dueTo: string; createdFrom: string; createdTo: string;
  ids: string; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;
export type TaskSummary = { overdue: number; dueToday: number; upcoming: number; highPriority: number; open: number; teamOverdue: number | null };
export type TaskHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };
export type TaskBulkResult = { results: Array<{ taskId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };
export type TaskInput = Partial<{
  title: string; description: string; priority: TaskPriority; dueDate: string; dueTime: string; reminderOffsetMinutes: number | null; reminderAt: string | null;
  relatedType: TaskRelatedType | null; relatedId: string | null; assignedTo: string; idempotencyKey: string; reason: string; expectedUpdatedAt: string;
}>;

const BASE = "/api/crm/tasks";

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
const post = <T>(url: string, json: unknown = {}) => request<T>(url, { method: "POST", json });

export const getTaskOptions = () => request<{ options: TaskOptions }>(`${BASE}/options`).then((result) => result.options);
export const getTaskSummary = () => request<{ summary: TaskSummary }>(`${BASE}/summary`).then((result) => result.summary);
export const listTasks = (filters: TaskListFilters = {}) =>
  request<{ rows: Task[]; total: number; limit: number; offset: number; capabilities: TaskCapabilities }>(`${BASE}${query(filters)}`);
export const getTask = (id: string) => request<{ record: Task }>(`${BASE}/${id}`).then((result) => result.record);
export const createTask = (input: TaskInput) => post<{ record: Task }>(BASE, input).then((result) => result.record);
export const updateTask = (id: string, input: TaskInput) => request<{ record: Task }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.record);
export const deleteTask = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const listTaskHistory = (id: string) => request<{ history: TaskHistoryEntry[] }>(`${BASE}/${id}/history`).then((result) => result.history);

export const assignTask = (id: string, input: { assignedTo: string; reason?: string; expectedUpdatedAt?: string }) => post<{ changed: boolean }>(`${BASE}/${id}/assign`, input);
export const startTask = (id: string, expectedUpdatedAt?: string) => post<{ changed: boolean }>(`${BASE}/${id}/start`, { expectedUpdatedAt });
export const completeTask = (id: string, input: { note?: string; expectedUpdatedAt?: string; nextFollowUp?: { type: string; dueAt: string; notes?: string } } = {}) =>
  post<{ changed: boolean; followUpId: string | null }>(`${BASE}/${id}/complete`, input);
export const reopenTask = (id: string, input: { reason?: string; expectedUpdatedAt?: string } = {}) => post<{ changed: boolean }>(`${BASE}/${id}/reopen`, input);
export const cancelTask = (id: string, input: { reason?: string; expectedUpdatedAt?: string } = {}) => post<{ changed: boolean }>(`${BASE}/${id}/cancel`, input);
export const bulkTaskAction = (input: { action: "assign" | "priority" | "reschedule" | "complete" | "cancel"; taskIds: string[] } & Record<string, unknown>) =>
  post<TaskBulkResult>(`${BASE}/bulk`, input);
export const taskExportUrl = (filters: TaskListFilters) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
