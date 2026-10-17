"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/assignments: assignment requests, their issue, returns and the employee's own requests.
export const ASSIGNMENTS_BASE = "/assets/assignments";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/assignments${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type AssignmentRow = { id: string; number: string; assetId: string | null; asset: string; serialNumber: string | null; recipientType: string; recipientLabel: string; recipient: string; location: string;
  purpose: string; assignmentType: string; status: string; statusLabel: string; acknowledgment: string | null; acknowledgmentLabel: string | null; issuedAt: string | null; expectedReturn: string | null;
  originalExpectedReturn: string | null; returnedAt: string | null; requestedBy: string | null; requestedAt: string; overdue: boolean; href: string };
export type AssignmentDetail = AssignmentRow & { category: string | null; deliverToLocationId: string | null; requestedIssueDate: string | null; approvalStatus: string; decisionNote: string | null; issueCondition: string | null; accessories: string | null;
  returnCondition: string | null; cancelReason: string | null; version: number; current: { custodian: string | null; since: string | null; location: string | null };
  reservation: { status: string; since: string; releasedAt: string | null; reason: string | null } | null; handover: { number: string; status: string; at: string | null; decision: string | null; dispute: string | null } | null;
  transfer: { id: string; number: string; status: string; href: string } | null; events: Array<{ id: string; action: string; from: string | null; to: string | null; reason: string | null; by: string | null; at: string }>;
  can: { submit: boolean; approve: boolean; chooseAsset: boolean; reject: boolean; issue: boolean; cancel: boolean; acknowledge: boolean; requestReturn: boolean; receiveReturn: boolean; extend: boolean; reassign: boolean }; note: string };
export type AssignableAsset = { assetId: string; asset: string; serialNumber: string | null; category: string; location: string | null; store: string | null; condition: string | null };
export type AssetAssignmentPanel = { visible: false } | { visible: true; assetId: string; current: AssignmentRow | null; open: AssignmentRow | null; history: AssignmentRow[]; can: { assign: boolean } };
export type BulkResult = { batchId: string; number: string; status: string; succeeded: number; failed: number; results: Array<{ row: number; ok: boolean; number?: string; status?: string; asset?: string | null; message?: string }> };

export const getAssignments = (view: string, search = "") => call<{ rows: AssignmentRow[]; can: { request: boolean; team: boolean; bulk: boolean; export: boolean } }>(`${qs({ view, search })}`);
export const getAssignment = (id: string) => call<AssignmentDetail>(`/${id}`);
export const getAssignable = (search = "") => call<{ rows: AssignableAsset[] }>(`/actions/assignable${qs({ search })}`).then((r) => r.rows);
export const getMyRequests = () => call<{ rows: AssignmentRow[]; can: { request: boolean } }>("/actions/mine");
export const getAssignmentExceptions = () => call<{ rows: Array<AssignmentRow & { kind: string; label: string }> }>("/actions/exceptions").then((r) => r.rows);
export const getAssignmentReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);
export const createAssignment = (input: Record<string, unknown>) => send<{ requestId: string; number: string; status: string }>("", input);
export const assignmentAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/${id}/${action}`, input);
export const bulkAssign = (input: Record<string, unknown>) => send<BulkResult>("/actions/bulk", input);
export const assignmentsExportHref = "/api/assets/assignments/export";
export const ASSIGNMENT_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", CHANGES_REQUESTED: "warning", READY_TO_ISSUE: "info",
  IN_TRANSFER: "info", ISSUED_AWAITING_ACKNOWLEDGMENT: "warning", FULFILLED: "success", REJECTED: "neutral", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const ASSIGNMENT_REPORT_KINDS = [{ id: "assets-by-employee", label: "Assets by employee" }, { id: "assets-by-department", label: "Assets by department" }, { id: "available-for-assignment", label: "Available for assignment" },
  { id: "pending-requests", label: "Pending assignment requests" }, { id: "reserved-not-issued", label: "Reserved but not issued" }, { id: "issued-not-acknowledged", label: "Issued, not acknowledged" },
  { id: "temporary-assignments", label: "Temporary assignments" }, { id: "overdue-returns", label: "Overdue returns" }, { id: "employee-clearance", label: "Employee asset clearance" },
  { id: "damaged-missing", label: "Damaged / missing assigned assets" }, { id: "assignment-history", label: "Assignment history" }, { id: "assignment-transfer-conflicts", label: "Assignment and transfer conflicts" },
  { id: "bulk-results", label: "Bulk assignment results" }];
