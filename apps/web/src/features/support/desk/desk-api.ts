"use client";

// Support — the client of /api/support: the queues and their counts, one ticket, every action, files, the dashboard, options, reports and
// settings (targets, mailboxes, categories).
import { SpecApiError, qs } from "@/features/quality/specifications/spec-api";

export const SUPPORT_BASE = "/support";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/support${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SpecApiError(payload.message || "The request could not be completed.", response.status, payload.details?.code ?? payload.code, payload.details ?? payload);
  return payload as T;
}

export type Option = { value: string; label: string };
export type Clock = "MET" | "MISSED" | "OVERDUE" | "RUNNING" | "PAUSED" | null;
export type TicketRow = { id: string; number: string; subject: string; status: string; statusLabel: string; priority: string; priorityLabel: string; source: string;
  category: { id: string; name: string } | null; customer: { id: string; name: string } | null; contact: { id: string; name: string } | null; customerName: string | null;
  customerEmail: string | null; agent: { id: string; name: string } | null; unmatched: boolean; reopened: number; responseDue: string | null; resolutionDue: string | null;
  response: Clock; resolution: Clock; createdAt: string; updatedAt: string; lastCustomerAt: string | null; followUpOf: { id: string; number: string } | null; rowVersion: number };
export type Message = { id: string; kind: string; kindLabel: string; private: boolean; channel: string; subject: string | null; body: string; from: string | null; fromAddress: string | null;
  to: string[]; cc: string[]; delivery: string | null; deliveryLabel: string | null; deliveryError: string | null; at: string; files: Array<{ id: string; fileName: string }> };
export type TicketDetail = TicketRow & {
  description: string; customerPhone: string | null; tags: string[]; mailbox: { id: string; name: string; address: string } | null;
  candidates: Array<{ contactId?: string; contact?: string; customerId?: string | null; customer?: string | null }>; resolutionSummary: string | null; resolutionCode: string | null;
  firstRespondedAt: string | null; resolvedAt: string | null; closedAt: string | null; reopenedAt: string | null; pausedMinutes: number; messages: Message[];
  files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number | null; messageId: string | null; private: boolean; at: string }>;
  assignments: Array<{ from: string | null; to: string | null; by: string | null; reason: string | null; at: string }>;
  statuses: Array<{ from: string | null; to: string; reason: string | null; actor: string | null; at: string }>;
  history: Array<{ type: string; label: string; at: string; actor: string | null; detail: string | null }>; followUps: Array<{ id: string; number: string; status: string }>;
  can: Record<"edit" | "assign" | "reply" | "note" | "logCustomer" | "status" | "resolve" | "close" | "reopen" | "cancel" | "link" | "upload", boolean>;
};
export type Counts = Record<"open" | "mine" | "unassigned" | "new" | "pending_customer" | "pending_internal" | "unmatched" | "response_overdue" | "resolution_overdue" | "urgent" | "resolved" | "closed" | "cancelled", number>;
export type Dashboard = { counts: Counts; created30: number; resolved30: number; failedReplies: number; responseMinutes: number | null; resolutionHours: number | null; responseMetRate: number | null };
export type Options = { agents: Option[]; categories: Option[]; mailboxes: Option[]; customers: Option[]; routes: Option[]; priorities: Option[]; reports: Option[];
  can: { create: boolean; mailboxes: boolean; reports: boolean; settings: boolean } };
export type Mailbox = { id: string; name: string; address: string; displayName: string | null; routeId: string | null; route: { name: string; status: string } | null; categoryId: string | null;
  category: string | null; priority: string; agentId: string | null; agent: string | null; autoAcknowledge: boolean; replyReopensResolved: boolean; blockedSenders: string[]; blockedDomains: string[];
  signature: string | null; status: string };
export type Settings = { settings: { defaultPriority: string; reopenWindowDays: number; reopenOnCustomerReply: boolean; targets: Record<string, { response: number; resolution: number }> };
  mailboxes: Mailbox[]; categories: Array<{ id: string; code: string; name: string; description: string | null; defaultPriority: string; active: boolean }> };
export type Report = { kind: string; title: string; rows: Array<Record<string, unknown>> };

export const deskApi = {
  list: (view: string, search: string, priority = "") => call<{ rows: TicketRow[] }>(`/tickets${qs({ view, search, priority })}`),
  counts: () => call<{ counts: Counts }>("/tickets/view/counts").then((r) => r.counts),
  dashboard: () => call<Dashboard>("/tickets/view/dashboard"),
  options: () => call<Options>("/tickets/view/options"),
  contacts: (customerId: string) => call<{ contacts: Array<Option & { email: string | null }> }>(`/tickets/view/contacts${qs({ customerId })}`).then((r) => r.contacts),
  get: (id: string) => call<TicketDetail>(`/tickets/${id}`),
  create: (body: Record<string, unknown>) => call<{ id: string }>("/tickets", { method: "POST", body: JSON.stringify(body) }),
  action: (id: string, action: string, body: Record<string, unknown> = {}) => call<Record<string, unknown>>(`/tickets/${id}/${action}`, { method: "POST", body: JSON.stringify(body) }),
  fileHref: (id: string, fileId: string) => `/api/support/tickets/${id}/files/${fileId}`,
  upload: async (id: string, file: File, extra: { messageId?: string; private?: boolean } = {}) => {
    const form = new FormData();
    form.append("file", file);
    if (extra.messageId) form.append("messageId", extra.messageId);
    if (extra.private) form.append("private", "true");
    return call<{ file: { id: string } }>(`/tickets/${id}/files`, { method: "POST", body: form });
  },
  removeFile: (id: string, fileId: string) => call<{ removed: boolean }>(`/tickets/${id}/files/${fileId}`, { method: "DELETE" }),
  report: (kind: string, from = "", to = "") => call<Report>(`/reports${qs({ kind, from, to })}`),
  csvHref: (kind: string, from = "", to = "") => `/api/support/reports${qs({ kind, from, to, format: "csv" })}`,
  settings: () => call<Settings>("/settings"),
  save: (body: Record<string, unknown>) => call<Record<string, unknown>>("/settings", { method: "POST", body: JSON.stringify(body) }),
};
export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { new: "info", open: "info", pending_customer: "warning", pending_internal: "warning",
  resolved: "success", closed: "neutral", cancelled: "neutral", merged: "neutral" };
export const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { low: "neutral", normal: "neutral", high: "warning", urgent: "danger" };
export const CLOCK_TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = { MET: "success", MISSED: "danger", OVERDUE: "danger", RUNNING: "neutral", PAUSED: "warning" };
export const CLOCK_LABEL: Record<string, string> = { MET: "Met", MISSED: "Missed", OVERDUE: "Overdue", RUNNING: "Due", PAUSED: "Paused" };
export const DELIVERY_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { RECEIVED: "neutral", QUEUED: "info", SENT: "success", FAILED: "danger", BOUNCED: "danger", NOT_SENT: "warning" };
