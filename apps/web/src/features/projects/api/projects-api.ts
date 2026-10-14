"use client";

// Projects: the client of /api/projects.
export class ProjectApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/projects${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new ProjectApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
export const send = <T = Record<string, unknown>>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });
export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof ProjectApiError ? error.status : 0);
export const errorCode = (error: unknown) => (error instanceof ProjectApiError ? error.code : undefined);
export const errorDetails = (error: unknown) => (error instanceof ProjectApiError ? error.details : {});
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const PROJECTS_BASE = "/projects";
export type ProjectStatus = "DRAFT" | "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type Health = "ON_TRACK" | "AT_RISK" | "BLOCKED" | "UNKNOWN" | "COMPLETED" | "CANCELLED";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export const STATUS_TONE: Record<ProjectStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", PLANNED: "info", IN_PROGRESS: "info", ON_HOLD: "warning", COMPLETED: "success", CANCELLED: "neutral" };
export const HEALTH_TONE: Record<Health, "neutral" | "info" | "success" | "warning" | "danger"> = {
  ON_TRACK: "success", AT_RISK: "warning", BLOCKED: "danger", UNKNOWN: "neutral", COMPLETED: "success", CANCELLED: "neutral" };
export const PRIORITY_LABEL: Record<Priority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };
export const PRIORITY_TONE: Record<Priority, "neutral" | "info" | "warning" | "danger"> = { LOW: "neutral", NORMAL: "info", HIGH: "warning", URGENT: "danger" };

export type ProjectRow = {
  id: string; code: string; name: string | null; classification: "INTERNAL" | "CUSTOMER"; type: string | null; customer: string | null; customerId: string | null; managerId: string | null;
  manager: string | null; status: ProjectStatus; statusLabel: string; priority: Priority; plannedStartDate: string | null; targetEndDate: string | null; actualStartDate: string | null;
  completedAt: string | null; health: Health; healthLabel: string; healthReasons: string[]; progress: number | null; progressLabel: string; tags: string[]; members: number; archived: boolean;
  approval: string; targetIn: number | null; overdue: boolean; lastActivityAt: string | null; updatedAt: string;
};
export type ProjectList = { rows: ProjectRow[]; total: number; page: number; pageSize: number; pages: number; can: { create: boolean; export: boolean; viewAll: boolean } };
export type WorkCounts = { total: number; completed: number; open: number; overdue: number; overdueCritical?: number; openRequired?: number } | null;
export type Project = {
  id: string; code: string; name: string | null; description: string | null; classification: "INTERNAL" | "CUSTOMER"; typeId: string | null; type: string | null;
  customerId: string | null; customer: string | null; customerNumber: string | null; contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  managerId: string | null; manager: string | null; managerActive: boolean; status: ProjectStatus; statusLabel: string; previousStatus: ProjectStatus | null; priority: Priority; source: string;
  plannedStartDate: string | null; targetEndDate: string | null; actualStartDate: string | null; completedAt: string | null; completionNote: string | null; completedBy: string | null;
  cancelledAt: string | null; cancelReason: string | null; cancelledBy: string | null;
  approval: { status: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED"; requestedBy: string | null; requestedAt: string | null; approvedBy: string | null; approvedAt: string | null; note: string | null;
    required: boolean; mayDecide: boolean };
  risk: { flagged: boolean; note: string | null };
  health: { state: Health; label: string; reasons: string[]; final?: boolean; note: { text: string; at: string } | null; noteBy: string | null };
  progress: { state: "NO_DATA" | "TRACKED"; percent: number | null; label: string; tasks: WorkCounts; milestones: WorkCounts };
  hold: { reason: string; owner: string | null; startedAt: string } | null;
  activation: { ready: boolean; problems: Array<{ code: string; field: string; message: string }> } | null;
  tags: string[]; template: { id: string; name: string } | null; archived: boolean; archivedAt: string | null; archivedBy: string | null; members: number; createdBy: string | null; createdAt: string;
  updatedAt: string; lastActivityAt: string | null; version: number; role: string | null; roleLabel: string | null;
  can: Record<"edit" | "members" | "links" | "start" | "hold" | "resume" | "complete" | "reopen" | "cancel" | "archive" | "approve" | "contribute" | "financials" | "activate" | "restore" | "delete", boolean>;
};
export type ActivityEntry = { id: string; action: string; summary: string | null; actor: string; at: string };
export type ProjectSummary = { project: Project; links: Array<{ type: string; label: string; count: number }>; activity: ActivityEntry[]; next: string };
export type Member = { id: string; userId: string; name: string; email: string; role: "MANAGER" | "MEMBER" | "VIEWER" | "FINANCIAL_VIEWER"; roleLabel: string; joinedAt: string; addedBy: string | null;
  leftAt: string | null; removedBy: string | null; removalNote: string | null; active: boolean; accountActive: boolean | null };
export type Link = { id: string; sourceModule: string; sourceType: string; typeLabel: string; sourceId: string; sourceLineId: string | null; linkType: string; note: string | null; createdAt: string;
  createdBy: string | null; record: { missing: true } | { restricted: true } | { number: string | null; title: string | null; status: string | null; billingStatus: string | null; paymentStatus: string | null;
    amount: string | null; outstanding: string | null; href: string } };
export type Note = { id: string; body: string; author: string | null; createdAt: string; editedAt: string | null; version: number; mine: boolean; mayRemove: boolean };
export type ProjectFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null };
export type Check = { key: string; label: string; state: "PASS" | "FAIL" | "WARN" | "NOT_TRACKED" | "TO_CONFIRM"; message: string; blocking: boolean };
export type Options = {
  types: Array<{ id: string; code: string; name: string }>; users: Array<{ id: string; name: string; email: string }>; priorities: Priority[]; roles: Array<{ code: string; name: string }>;
  settings: { activationApprovalRequired: boolean; selfApprovalAllowed: boolean; dueSoonDays: number; customerAcceptanceRequired: boolean }; currentUserId: string;
  can: { create: boolean; viewAll: boolean; export: boolean; reports: boolean; settings: boolean; inviteUsers: boolean };
};
export type Overview = {
  counts: Record<"active" | "inProgress" | "onHold" | "overdue" | "dueSoon" | "atRisk" | "drafts" | "pendingApproval" | "completedThisMonth" | "mine" | "noManager", number>;
  attention: Array<ProjectRow & { reason: string }>; byStatus: Array<{ status: ProjectStatus; label: string; count: number }>;
  recent: Array<{ id: string; projectId: string; project: string; action: string; summary: string | null; actor: string; at: string }>; can: { create: boolean; reports: boolean; viewAll: boolean };
};
export type SavedView = { id: string; name: string; filters: Record<string, string>; isDefault: boolean };

export const listProjects = (filters: Record<string, string | number | undefined>) => call<ProjectList>(`${qs(filters)}`);
export const getProject = (id: string) => call<{ project: Project }>(`/${id}`).then((r) => r.project);
export const getSummary = (id: string) => call<{ summary: ProjectSummary }>(`/${id}/summary`).then((r) => r.summary);
export const getActivity = (id: string) => call<{ activity: ActivityEntry[] }>(`/${id}/activity`).then((r) => r.activity);
export const getStatusHistory = (id: string) => call<{ history: Array<{ action: string; from: string | null; to: string; reason: string | null; actor: string; at: string }> }>(`/${id}/status-history`).then((r) => r.history);
export const getCompletionCheck = (id: string) => call<{ check: { checks: Check[]; completionDate: string; ready: boolean } }>(`/${id}/completion-check`).then((r) => r.check);
export const getCancellationReview = (id: string) => call<{ review: { dependencies: Array<{ type: string; number: string | null; status: string | null; message: string }>; members: number; hold: string | null; notes: string[] } }>(`/${id}/cancellation-review`).then((r) => r.review);
export const createProject = (input: Record<string, unknown>) => send<{ projectId: string; projectCode: string; replayed?: boolean }>("", input);
export const updateProject = (id: string, input: Record<string, unknown>) => send<{ projectId: string; version: number; changed: string[] }>(`/${id}`, input, "PATCH");
export const projectAction = (id: string, action: string, input: Record<string, unknown> = {}) => send<{ projectId: string; status?: string; approval?: string }>(`/${id}/${action}`, input);
export const createFromSalesOrder = (salesOrderId: string, input: Record<string, unknown> = {}) => send<{ projectId: string; projectCode: string; replayed?: boolean }>("/from-sales-order", { salesOrderId, ...input });
export const getOptions = () => call<{ options: Options }>("/options").then((r) => r.options);
export const searchCustomers = (search: string) => call<{ customers: Array<{ id: string; name: string; number: string | null }> }>(`/customers${qs({ search })}`).then((r) => r.customers);
export const customerContacts = (customerId: string) => call<{ contacts: Array<{ id: string; name: string; email: string | null }> }>(`/customers/${customerId}/contacts`).then((r) => r.contacts);
export const getMembers = (id: string) => call<{ members: Member[]; can: { manage: boolean } }>(`/${id}/members`);
export const addMember = (id: string, userId: string, role: string) => send(`/${id}/members`, { userId, role });
export const changeMemberRole = (id: string, memberId: string, role: string) => send(`/${id}/members/${memberId}`, { role }, "PATCH");
export const removeMember = (id: string, memberId: string, note?: string) => send(`/${id}/members/${memberId}`, { note }, "DELETE");
export const getLinks = (id: string) => call<{ links: Link[]; financials: boolean; can: { manage: boolean; types: Array<{ type: string; label: string }> } }>(`/${id}/links`);
export const searchLinkable = (id: string, type: string, search: string) => call<{ records: Array<{ id: string; number: string | null; title: string | null; status: string | null }> }>(`/${id}/link-search${qs({ type, search })}`).then((r) => r.records);
export const addLink = (id: string, input: Record<string, unknown>) => send(`/${id}/links`, input);
export const removeLink = (id: string, linkId: string) => send(`/${id}/links/${linkId}`, {}, "DELETE");
export const getNotes = (id: string) => call<{ notes: Note[]; can: { add: boolean } }>(`/${id}/notes`);
export const addNote = (id: string, body: string) => send(`/${id}/notes`, { body });
export const editNote = (id: string, noteId: string, body: string, expectedVersion: number) => send(`/${id}/notes/${noteId}`, { body, expectedVersion }, "PATCH");
export const removeNote = (id: string, noteId: string) => send(`/${id}/notes/${noteId}`, {}, "DELETE");
export const getFiles = (id: string) => call<{ files: ProjectFile[] }>(`/${id}/files`).then((r) => r.files);
export async function uploadFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: ProjectFile }>(`/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
}
export const removeFile = (id: string, fileId: string) => send(`/${id}/files/${fileId}`, {}, "DELETE");
export const fileHref = (id: string, fileId: string) => `/api/projects/${id}/files/${fileId}`;
export const getOverview = () => call<{ overview: Overview }>("/overview").then((r) => r.overview);
export const getReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/reports/overview${qs({ kind, ...filters })}`).then((r) => r.rows);
export const exportHref = (filters: Record<string, string | number | undefined>) => `/api/projects/export${qs(filters)}`;
export const importProjects = (csv: string, importKey: string) => send<{ results: Array<{ row: number; status: string; projectCode?: string; projectId?: string; code?: string; message?: string }>; created: number; failed: number }>("/import", { csv, importKey });
export const getViews = () => call<{ views: SavedView[] }>("/views").then((r) => r.views);
export const saveView = (input: { name: string; filters: Record<string, string>; isDefault?: boolean }) => send("/views", input);
export const deleteView = (id: string) => send(`/views/${id}`, {}, "DELETE");
export const getSettings = () => call<{ settings: Options["settings"]; types: Array<{ id: string; code: string; name: string; description: string | null; status: string }>; roles: Array<{ code: string; name: string }>; can: { manage: boolean } }>("/settings");
export const saveSettings = (input: Record<string, unknown>) => send("/settings", input, "PUT");
export const saveType = (input: Record<string, unknown>) => send("/settings/types", input);

export const dateLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
export const targetLabel = (row: { targetIn: number | null; status: ProjectStatus }) => (row.targetIn === null || !["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status) ? null
  : row.targetIn < 0 ? `${-row.targetIn} day(s) overdue` : row.targetIn === 0 ? "Due today" : `${row.targetIn} day(s) left`);
