"use client";

// Browser client for the follow-up routes under /api/crm/follow-ups. One
// function per follow-up operation; a failed request throws FollowUpApiError
// with the server's message and code.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class FollowUpApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(FollowUpApiError, "body");

export type FollowUpStatus = "scheduled" | "completed" | "cancelled";
export type FollowUpType = "call" | "email" | "meeting" | "demo" | "other";
export type FollowUpRelatedType = "lead" | "party" | "contact" | "opportunity";
export type FollowUpViewKey = "due_today" | "mine" | "overdue" | "upcoming" | "completed" | "created_by_me" | "team" | "all" | "cancelled";

export type FollowUp = {
  id: string;
  number: string | null;
  subject: string;
  notes: string | null;
  type: FollowUpType;
  status: FollowUpStatus;
  relatedType: FollowUpRelatedType | null;
  relatedId: string | null;
  relatedName: string | null;
  relatedCode: string | null;
  relatedHref: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactMobile: string | null;
  accountId: string | null;
  accountName: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  scheduledAt: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  reminderOffsetMinutes: number | null;
  reminderAt: string | null;
  isOverdue: boolean;
  isDueToday: boolean;
  isUpcoming: boolean;
  outcome: string | null;
  outcomeLabel: string | null;
  outcomeNotes: string | null;
  loggedActivityId: string | null;
  originLeadId: string | null;
  originLeadCode: string | null;
  snoozeCount: number;
  completedAt: string | null;
  completedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
};

export type FollowUpCapabilities = Record<
  "view" | "viewTeam" | "viewAll" | "create" | "edit" | "complete" | "reschedule" | "cancel" | "reassign" | "delete" | "export",
  boolean
>;
type CodeLabel<Code extends string = string> = { code: Code; label: string };
export type FollowUpOptions = {
  views: Array<{ key: FollowUpViewKey; label: string }>;
  statuses: CodeLabel<FollowUpStatus>[];
  types: CodeLabel<FollowUpType>[];
  outcomes: CodeLabel[];
  relatedTypes: CodeLabel<FollowUpRelatedType>[];
  reminderOptions: Array<{ minutes: number; label: string }>;
  users: Array<{ id: string; name: string; email: string }>;
  teams: Array<{ id: string; name: string; memberIds: string[] }>;
  currentUserId: string;
  capabilities: FollowUpCapabilities;
};
export type FollowUpListFilters = Partial<{
  view: FollowUpViewKey; search: string; status: string; type: string; outcome: string; assigneeId: string; createdBy: string; completedBy: string;
  relatedType: string; relatedId: string; accountId: string; contactId: string; leadId: string; opportunityId: string; dueFrom: string; dueTo: string;
  createdFrom: string; createdTo: string; ids: string; sortBy: string; sortDirection: "asc" | "desc"; limit: number; offset: number;
}>;
export type FollowUpSummary = { dueToday: number; overdue: number; upcoming: number; open: number; teamOverdue: number | null };
export type FollowUpHistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; createdAt: string; actorName: string | null };
export type FollowUpBulkResult = { results: Array<{ followUpId: string; ok: boolean; message?: string }>; succeeded: number; failed: number };
export type ScheduleInput = Partial<{
  relatedType: FollowUpRelatedType; relatedId: string; type: FollowUpType; subject: string; notes: string; contactId: string | null; assignedTo: string;
  scheduledDate: string; scheduledTime: string; reminderOffsetMinutes: number | null; reminderAt: string | null; idempotencyKey: string; expectedUpdatedAt: string;
}>;

const BASE = "/api/crm/follow-ups";

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
const post = <T>(url: string, json: unknown = {}) => request<T>(url, { method: "POST", json });

export const getFollowUpOptions = () => request<{ options: FollowUpOptions }>(`${BASE}/options`).then((result) => result.options);
export const getFollowUpSummary = () => request<{ summary: FollowUpSummary }>(`${BASE}/summary`).then((result) => result.summary);
export const listFollowUps = (filters: FollowUpListFilters = {}) =>
  request<{ rows: FollowUp[]; total: number; limit: number; offset: number; capabilities: FollowUpCapabilities }>(`${BASE}${query(filters)}`);
export const getFollowUp = (id: string) => request<{ record: FollowUp }>(`${BASE}/${id}`).then((result) => result.record);
export const scheduleFollowUp = (input: ScheduleInput) => post<{ record: FollowUp }>(BASE, input).then((result) => result.record);
export const updateFollowUp = (id: string, input: ScheduleInput) =>
  request<{ record: FollowUp }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.record);
export const deleteFollowUp = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" });
export const listFollowUpHistory = (id: string) => request<{ history: FollowUpHistoryEntry[] }>(`${BASE}/${id}/history`).then((result) => result.history);
export const rescheduleFollowUp = (id: string, input: { scheduledDate: string; scheduledTime?: string; reason?: string; expectedUpdatedAt?: string }) =>
  post<{ changed: boolean }>(`${BASE}/${id}/reschedule`, input);
export const reassignFollowUp = (id: string, input: { assignedTo: string; reason?: string; expectedUpdatedAt?: string }) => post<{ changed: boolean }>(`${BASE}/${id}/reassign`, input);
export const completeFollowUp = (id: string, input: {
  outcome?: string; notes?: string; expectedUpdatedAt?: string;
  nextFollowUp?: { type?: string; scheduledDate: string; scheduledTime?: string }; nextTask?: { title: string; dueDate: string };
} = {}) => post<{ changed: boolean; followUpId: string | null; taskId: string | null; activityId: string | null }>(`${BASE}/${id}/complete`, input);
export const cancelFollowUp = (id: string, input: { reason?: string; expectedUpdatedAt?: string } = {}) => post<{ changed: boolean }>(`${BASE}/${id}/cancel`, input);
export const snoozeFollowUp = (id: string, input: { minutes?: number; until?: string }) => post<{ changed: boolean; remindAt: string }>(`${BASE}/${id}/snooze`, input);
export const bulkFollowUpAction = (input: { action: "reassign" | "reschedule" | "cancel"; followUpIds: string[] } & Record<string, unknown>) =>
  post<FollowUpBulkResult>(`${BASE}/bulk`, input);
export const followUpExportUrl = (filters: FollowUpListFilters) => `${BASE}/export${query({ ...filters, limit: undefined, offset: undefined })}`;

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
