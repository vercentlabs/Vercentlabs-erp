"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/custody (and the asset's own custody views).
export const CUSTODY_BASE = "/assets/custody";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/custody${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Assignment = { id: string; assetId: string; asset: string; assetHref: string; lifecycleLabel: string; type: string; typeLabel: string; custodian: string | null; userId: string | null; department: string | null;
  storeLocationId: string | null; accountable: string | null; accountableUserId: string | null; since: string; until: string | null; conditionAtIssue: string | null; conditionAtReturn: string | null;
  expectedReturn: string | null; overdue: boolean; returnRequestedAt: string | null; acknowledgment: string; acknowledgmentLabel: string; source: string; status: string; custodianInactive: boolean };
export type Handover = { id: string; number: string; assetId: string; asset: string; assetHref: string; kind: string; kindLabel: string; toType: string; to: string | null; recipient: string | null; recipientUserId: string | null;
  issuedBy: string | null; status: string; statusLabel: string; physicalAt: string | null; acknowledgedAt: string | null; condition: string | null; accessories: string | null; expectedReturn: string | null;
  notes: string | null; createdAt: string; mine: boolean };
export type AssetCustody = { assetId: string; legalOwner: string | null; current: Assignment | null; openHandover: Handover | null; physicalHolder: string | null;
  exception: { id: string; kind: string; kindLabel: string; description: string } | null; note: string;
  can: { issue: boolean; return: boolean; confirmHandover: boolean; cancel: boolean; acknowledge: boolean; dispute: boolean; waive: boolean; resolve: boolean; requestReturn: boolean; history: boolean } };
export type CustodyHistory = { assignments: Assignment[]; handovers: Handover[]; acknowledgments: Array<{ id: string; handoverId: string; decision: string; reason: string | null; comment: string | null; onBehalf: boolean; by: string | null; at: string }> };
export type Clearance = { userId: string; name: string; email: string; active: boolean; status: string; statusLabel: string; assets: Assignment[]; accountableFor: Assignment[]; openHandovers: Handover[];
  recordedExceptions: Array<{ id: string; asset: string; note: string }>; note: string };
export type CustodyException = { id: string | null; kind: string; label: string; asset: string; issue: string; href: string; resolvable: boolean };
export type BulkCustodyResult = { succeeded: number; failed: number; results: Array<{ assetId: string; assetNumber: string | null; ok: boolean; errorCode?: string; message?: string }> };

export const getWorkspace = (filters: Record<string, string | undefined>) => call<{ kind: "assignments" | "handovers"; rows: Array<Assignment | Handover> }>(`/actions/workspace${qs(filters)}`);
export const getMine = () => call<{ rows: Assignment[]; awaitingMe: Handover[]; can: { acknowledge: boolean; dispute: boolean } }>("/actions/mine");
export const getClearance = (userId: string) => call<Clearance>(`/actions/clearance${qs({ userId })}`);
export const getClearanceList = () => call<{ rows: Array<{ userId: string; name: string; active: boolean; assets: number; nextDue: string | null; href: string }> }>("/actions/clearance-list");
export const getExceptions = () => call<{ rows: CustodyException[] }>("/actions/exceptions").then((r) => r.rows);
export const getDepartments = () => call<{ rows: Array<{ id: string; name: string; code: string | null; accountableUserId: string | null; accountable: string | null }> }>("/actions/departments").then((r) => r.rows);
export const getStores = () => call<{ rows: Array<{ id: string; name: string; code: string; managerUserId: string | null; manager: string | null }> }>("/actions/stores").then((r) => r.rows);
export const handoverAction = <T = Record<string, unknown>>(handoverId: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/handovers/${handoverId}/${action}`, input);
export const custodyAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown>) => send<T>(`/actions/${action}`, input);
export const custodyExportHref = "/api/assets/custody/export";
export const CUSTODIAN_TYPES = [{ value: "EMPLOYEE", label: "Employee" }, { value: "DEPARTMENT", label: "Department" }, { value: "ASSET_STORE", label: "Asset store" }];
export const DISPUTE_REASONS = [{ value: "NOT_RECEIVED", label: "Asset not received" }, { value: "WRONG_ASSET", label: "Incorrect asset" }, { value: "WRONG_CONDITION", label: "Condition not as recorded" },
  { value: "MISSING_ACCESSORIES", label: "Missing accessories" }, { value: "OTHER", label: "Other" }];
export const CONDITION_OPTIONS = [{ value: "NEW", label: "New" }, { value: "GOOD", label: "Good" }, { value: "FAIR", label: "Fair" }, { value: "DAMAGED", label: "Damaged" }, { value: "UNSERVICEABLE", label: "Unserviceable" }];
export const ACK_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { PENDING: "warning", ACKNOWLEDGED: "success", EXCEPTION: "info", DISPUTED: "danger", NOT_REQUIRED: "neutral" };
