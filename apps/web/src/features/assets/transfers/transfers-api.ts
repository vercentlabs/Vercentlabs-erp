"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/transfers: the transfer directory, one transfer, its movement steps and exceptions.
export const TRANSFERS_BASE = "/assets/transfers";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/transfers${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type TransferRow = { id: string; number: string; type: string; typeLabel: string; reason: string; status: string; statusLabel: string; approval: string; approvalLabel: string; assets: number; received: number;
  outstanding: number; from: string; to: string; requestedBy: string | null; requestedAt: string; plannedDate: string | null; expectedArrival: string | null; expectedReturn: string | null; overdue: boolean; href: string };
export type TransferLine = { id: string; line: number; assetId: string; asset: string; serialNumber: string | null; assetHref: string; from: string; fromCustodian: string | null; to: string; toCustodian: string | null;
  status: string; statusLabel: string; dispatchCondition: string | null; dispatchedAt: string | null; dispatchedBy: string | null; transitHolder: string | null; receiptCondition: string | null; receivedAt: string | null;
  receivedBy: string | null; receiptIdentifier: string | null; custodyOutcome: string | null; handoverStatus: string | null; closeReason: string | null; confirmedLocation: string };
export type TransferException = { id: string; number: string; lineId: string; asset: string; type: string; typeLabel: string; description: string; expected: string | null; observed: string | null; condition: string | null;
  status: string; resolution: string | null; resolutionLabel: string | null; resolutionNote: string | null; reportedBy: string | null; reportedAt: string; incidentId: string | null };
export type TransferDetail = TransferRow & { reasonCode: string; reasonDetail: string | null; approvalReasons: string[]; approvedBy: string | null; approvedAt: string | null; decisionNote: string | null;
  carrier: string | null; trackingReference: string | null; notes: string | null; cancelReason: string | null; completedAt: string | null; version: number;
  returnLeg: { id: string; number: string; status: string; href: string } | null; returnOf: { id: string; number: string; href: string } | null;
  progress: { assets: number; dispatched: number; received: number; outstanding: number }; lines: TransferLine[]; exceptions: TransferException[];
  events: Array<{ id: string; action: string; from: string | null; to: string | null; asset: string | null; reason: string | null; by: string | null; at: string }>;
  can: { edit: boolean; submit: boolean; approve: boolean; reject: boolean; dispatch: boolean; receive: boolean; cancel: boolean; reportException: boolean; resolve: boolean; createReturn: boolean } };
export type ValidationLine = { assetId: string | null; asset: string | null; ok: boolean; error: { code: string; message: string } | null; from: { locationId: string | null; custodian: string | null } | null;
  to: { locationId: string | null; location: string | null; custodian: string | null } | null };
export type AssetTransferPanel = { visible: false } | { visible: true; assetId: string; confirmedLocation: string | null; custodian: string | null; effective: string;
  movement: { transferId: string; number: string; type: string; status: string; destination: string; receivingCustodian: string | null; transitHolder: string | null; expectedArrival: string | null; receipt: string | null; href: string } | null;
  history: Array<{ transferId: string; number: string; type: string; from: string; to: string; status: string; at: string; href: string }>; can: { initiate: boolean }; note: string };

export const getTransfers = (view: string, search = "") => call<{ rows: TransferRow[]; counts: Record<string, number>; can: { create: boolean; bulk: boolean; export: boolean; manage: boolean } }>(`${qs({ view, search })}`);
export const getTransfer = (id: string) => call<TransferDetail>(`/${id}`);
export const validateTransfer = (input: Record<string, unknown>) => send<{ eligible: number; blocked: number; lines: ValidationLine[] }>("/actions/validate", input);
export const createTransfer = (input: Record<string, unknown>) => send<{ transferId: string; number: string; status: string }>("", input);
export const transferAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/${id}/${action}`, input);
export const lineAction = <T = Record<string, unknown>>(id: string, lineId: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/${id}/lines/${lineId}/${action}`, input);
export const resolveException = (exceptionId: string, input: Record<string, unknown>) => send("/actions/resolve-exception", { exceptionId, ...input });
export const getTransferExceptions = () => call<{ rows: Array<{ kind: string; label: string; subject: string; detail: string | null; href: string }> }>("/actions/exceptions").then((r) => r.rows);
export const getTransferReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);
export const transfersExportHref = "/api/assets/transfers/export";
export const TRANSFER_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", CHANGES_REQUESTED: "warning", APPROVED: "info", IN_TRANSIT: "info",
  PARTIALLY_RECEIVED: "warning", RECEIPT_EXCEPTION: "danger", COMPLETED: "success", REJECTED: "neutral", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const LINE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PENDING: "neutral", APPROVED: "info", DISPATCHED: "info", RECEIVED: "success", COMPLETED: "success", RECEIPT_EXCEPTION: "danger",
  RETURN_IN_PROGRESS: "warning", CANCELLED: "neutral", REJECTED: "neutral", RETURNED: "neutral" };
export const TYPE_OPTIONS = [{ value: "LOCATION", label: "Location transfer" }, { value: "CUSTODY", label: "Custody transfer (same place)" }, { value: "COMBINED", label: "Location and custody" },
  { value: "TEMPORARY", label: "Temporary movement (e.g. repair)" }];
export const REASON_OPTIONS = [{ value: "EMPLOYEE_REASSIGNMENT", label: "Employee reassignment" }, { value: "DEPARTMENT_CHANGE", label: "Department change" }, { value: "OFFICE_RELOCATION", label: "Office relocation" },
  { value: "INTERNAL_STORAGE", label: "Internal storage movement" }, { value: "CUSTOMER_SITE", label: "Temporary customer-site deployment" }, { value: "REPAIR", label: "Repair or service" },
  { value: "RETURN_FROM_REPAIR", label: "Return from repair" }, { value: "REPLACEMENT_RECOVERY", label: "Replacement or recovery" }, { value: "DISPOSAL_MOVEMENT", label: "Authorized disposal-related movement" }, { value: "OTHER", label: "Other" }];
export const CONDITION_OPTIONS = [{ value: "NEW", label: "New" }, { value: "GOOD", label: "Good" }, { value: "FAIR", label: "Fair" }, { value: "DAMAGED", label: "Damaged" }, { value: "UNSERVICEABLE", label: "Unserviceable" }];
export const TRANSFER_REPORT_KINDS = [{ id: "all-transfers", label: "All asset transfers" }, { id: "pending-approvals", label: "Pending transfer approvals" }, { id: "ready-to-dispatch", label: "Ready to dispatch" },
  { id: "in-transit", label: "In-transit assets" }, { id: "overdue-receipts", label: "Overdue receipts" }, { id: "partially-received", label: "Partially received transfers" },
  { id: "transfer-exceptions", label: "Transfer exceptions" }, { id: "by-location", label: "Transfers by location" }, { id: "by-custodian", label: "Transfers by custodian" },
  { id: "temporary-overdue-returns", label: "Temporary transfers & overdue returns" }, { id: "movement-history", label: "Asset movement history" }, { id: "reconciliation", label: "Transfer reconciliation" }];
