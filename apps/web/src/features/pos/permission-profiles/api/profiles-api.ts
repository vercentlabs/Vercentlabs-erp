"use client";

// Browser client for Cashier Permissions: permission profiles (/api/pos/permission-profiles), supervisor approvals (/api/pos/approvals) and
// a cashier's assigned profile (/api/pos/cashiers/:id/permissions). The server decides every permission; screens only show and request.
import { PosApiError } from "@/features/pos/shared/http";

export const PROFILES_BASE = "/pos/settings/cashier-permissions";
export const APPROVALS_BASE = "/pos/approvals";

export type ProfileCapabilities = Record<"view" | "manage" | "status" | "assign" | "configureUnlimited" | "viewHistory", boolean>;
export type LimitMode = "not_applicable" | "limited" | "unlimited" | "hidden";
export type CatalogueEntry = { code: string; area: string; label: string; description: string; limits: Array<"percentage" | "amount">; limitRequired: boolean; reason: boolean; approval: string | null };
export type Area = { code: string; label: string };
export type Grant = {
  code: string; area: string; label: string; description: string | null; enabled: boolean; limitMode: LimitMode; maxPercentage: number | null; maxAmount: number | null;
  currency: string | null; requireReason: boolean; reasonForced: boolean; limits: Array<"percentage" | "amount">; limitRequired: boolean; approvalCode: string | null; supported: boolean;
};
export type ProfileSummary = {
  id: string; code: string; name: string; description: string | null; status: "draft" | "active" | "inactive"; assignedCashiers: number; activeCashiers: number;
  enabledGrants: number; version: number; updatedAt: string; updatedBy: string | null; summary?: string[];
};
export type Profile = ProfileSummary & {
  grants: Grant[]; areas: Area[]; currency: string; issues: Array<{ code: string; message: string }>; capabilities: ProfileCapabilities;
  cashiers: Array<{ id: string; code: string; name: string; status: string; assignedAt: string | null; assignedBy: string | null }>;
};
export type HistoryRow = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; actorName: string | null; createdAt: string };
export type CashierPermissions = {
  cashierId: string; cashierCode: string; profileId: string | null; profileCode: string | null; profileName: string | null; profileStatus: string | null;
  assignedAt: string | null; assignedBy: string | null; grants: Grant[];
} | null;
export type Approval = {
  id: string; status: "pending" | "approved" | "rejected" | "consumed" | "expired"; permission: string; permissionLabel: string; approvalCode: string; resourceType: string;
  resourceId: string; resourceVersion: number | null; action: Record<string, unknown>; amount: number | null; percentage: number | null; currency: string | null; reason: string;
  requestedBy: string | null; requestedById: string; approver: string | null; outlet: string | null; terminal: string | null; session: string | null; decisionNote: string | null;
  requestedAt: string; decidedAt: string | null; consumedAt: string | null; expiresAt: string;
};
export type GrantInput = { code: string; enabled: boolean; limitMode: Exclude<LimitMode, "hidden">; maxPercentage?: string | number | null; maxAmount?: string | number | null; requireReason?: boolean };

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  // The route layer spreads error details (issues, approvalCode, ...) flat into the body.
  if (!response.ok || payload.ok === false) throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`/api/pos${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  }).then(parse<T>);
}
const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listProfiles = (filters: { status?: string; search?: string } = {}) =>
  call<{ profiles: ProfileSummary[]; capabilities: ProfileCapabilities }>(`/permission-profiles${query(filters)}`);
export const getCatalogue = () => call<{ permissions: CatalogueEntry[]; areas: Area[]; capabilities: ProfileCapabilities }>("/permission-profiles/catalogue");
export const getProfile = (id: string) => call<{ profile: Profile }>(`/permission-profiles/${id}`).then((result) => result.profile);
export const createProfile = (input: Record<string, unknown>) => call<{ profile: Profile }>("/permission-profiles", { method: "POST", json: input }).then((result) => result.profile);
export const updateProfile = (id: string, input: Record<string, unknown>) =>
  call<{ profile: Profile }>(`/permission-profiles/${id}`, { method: "PATCH", json: input }).then((result) => result.profile);
export const deleteProfile = (id: string) => call<{ deleted: true }>(`/permission-profiles/${id}`, { method: "DELETE", json: {} });
export const setProfileStatus = (id: string, status: "active" | "inactive") =>
  call<{ profile: Profile }>(`/permission-profiles/${id}/status`, { method: "POST", json: { status } }).then((result) => result.profile);
export const cloneProfile = (id: string, input: { code?: string; name?: string } = {}) =>
  call<{ profile: Profile }>(`/permission-profiles/${id}/clone`, { method: "POST", json: input }).then((result) => result.profile);
export const getProfileHistory = (id: string) => call<{ rows: HistoryRow[] }>(`/permission-profiles/${id}/history`).then((result) => result.rows);

export const getCashierPermissions = (cashierId: string) => call<{ permissions: CashierPermissions }>(`/cashiers/${cashierId}/permissions`).then((result) => result.permissions);
export const assignProfile = (cashierId: string, profileId: string | null) =>
  call<{ permissions: CashierPermissions }>(`/cashiers/${cashierId}/permissions`, { method: "PUT", json: { profileId } }).then((result) => result.permissions);

export const listApprovals = (filters: { status?: string; mine?: boolean } = {}) =>
  call<{ approvals: Approval[] }>(`/approvals${query({ status: filters.status, mine: filters.mine ? "true" : undefined })}`).then((result) => result.approvals);
export const requestApproval = (input: { permission: string; resource: { type: string; id: string }; amount?: string | number | null; percentage?: string | number | null;
  action?: Record<string, unknown>; reason: string; idempotencyKey?: string }) =>
  call<{ approval: Approval }>("/approvals", { method: "POST", json: input }).then((result) => result.approval);
export const getApproval = (id: string) => call<{ approval: Approval }>(`/approvals/${id}`).then((result) => result.approval);
export const approveApproval = (id: string, note?: string) => call<{ approval: Approval }>(`/approvals/${id}/approve`, { method: "POST", json: { note } }).then((result) => result.approval);
export const rejectApproval = (id: string, note?: string) => call<{ approval: Approval }>(`/approvals/${id}/reject`, { method: "POST", json: { note } }).then((result) => result.approval);

type Issue = { field: string; message: string };
const payloadOf = (error: unknown) => (error instanceof PosApiError ? (error.details as Record<string, unknown> | undefined) : undefined);
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof PosApiError ? error.code : undefined);
export const fieldErrors = (error: unknown): Record<string, string> =>
  Object.fromEntries(((payloadOf(error)?.issues as Issue[] | undefined) ?? []).map((issue) => [issue.field, issue.message]));
export const issuesOf = (error: unknown) => (payloadOf(error)?.issues as Array<{ code: string; message: string }> | undefined) ?? [];
// When an action needs a supervisor: which permission and approval, with the amount and percentage the server worked out.
export const approvalNeeded = (error: unknown) => (errorCode(error) === "POS_APPROVAL_REQUIRED"
  ? (payloadOf(error) as { permission: string; approvalCode: string; amount: string | null; percentage: string | null }) : null);

export const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "info" | "danger"> = {
  draft: "warning", active: "success", inactive: "neutral", pending: "warning", approved: "info", rejected: "danger", consumed: "success", expired: "neutral",
};
export const statusLabel = (status: string) => status.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
export const limitText = (grant: Grant) => {
  if (!grant.enabled) return "Not granted";
  if (grant.limitMode === "hidden") return "Granted";
  if (grant.limitMode === "unlimited") return "Unlimited";
  if (grant.limitMode !== "limited") return "Granted";
  return [grant.maxPercentage !== null ? `up to ${grant.maxPercentage}%` : null, grant.maxAmount !== null ? `up to ${grant.maxAmount.toLocaleString("en-IN")} ${grant.currency ?? ""}`.trim() : null]
    .filter(Boolean).join(" and ");
};
