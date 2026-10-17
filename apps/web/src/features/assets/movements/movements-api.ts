"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/movements: the asset timeline, the Company directory, one movement with its source and corrections,
// the position on a past date, exceptions, reconciliation and reports. Movement History only reads; nothing here moves an asset.
export const MOVEMENTS_BASE = "/assets/movements";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/movements${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type MovementCustodian = { type: string | null; typeLabel: string | null; id: string | null; label: string | null } | null;
export type MovementEvent = { id: string; assetId: string; asset?: string; assetCode?: string; eventType: string; label: string; certainty: string; certaintyLabel: string; isMovement: boolean;
  changesLocation: boolean; changesCustody: boolean; group: { type: string; typeLabel: string; id: string; label: string | null } | null;
  from: { locationId: string | null; location: string | null; custodian: MovementCustodian };
  to: { locationId: string | null; location: string | null; locationRole: string | null; currentLocationName: string | null; custodian: MovementCustodian };
  condition: string | null; reason: string | null; occurredAt: string; effectiveAt: string; recordedAt: string; lateRecorded: boolean; actor: string | null; approver: string | null;
  source: { type: string; id: string; milestone: string }; document: { type: string; id: string | null; number: string | null; href: string | null } | null;
  correctionOf: string | null; supersededBy: string | null; corrected: boolean; details: Record<string, unknown> };
export type MovementGroup = { key: string; group: MovementEvent["group"]; events: MovementEvent[]; startedAt: string; lastAt: string; status: string; certainty: string; pending: boolean;
  movesLocation: boolean; movesCustody: boolean };
export type SyncState = { lastRunAt: string | null; status: string; delayed: boolean; error: string | null };
export type AssetMovementHistory = { asset: { id: string; code: string; name: string; serialNumber: string | null; tag: string | null };
  current: { locationId: string | null; location: string | null; custodian: MovementCustodian; acknowledgment: string | null; lifecycle: string; pendingMovement: { number: string; destination: string | null } | null };
  baseline: { at: string; kind: string; label: string } | null; note: string | null; events: MovementEvent[]; groups: MovementGroup[];
  issues: Array<{ id: string; type: string; expected: Record<string, unknown>; observed: Record<string, unknown>; since: string }>; sync: SyncState;
  can: { export: boolean; evidence: boolean; audit: boolean; correct: boolean; reconcile: boolean } };
export type MovementPage = { rows: MovementEvent[]; total: number; page: number; pageSize: number; pages: number; sync: SyncState;
  can: { export: boolean; reconcile: boolean; audit: boolean; companyWide: boolean; custody: boolean } };
export type MovementCorrection = { id: string; number: string; eventId: string; event: string; assetId: string; asset: string; field: string; originalValue: string; correctedValue: string; reason: string;
  evidence: string | null; status: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; canDecide: boolean };
export type MovementIssue = { id: string; assetId: string; asset: string; type: string; expected: Record<string, unknown>; observed: Record<string, unknown>; status: string; firstDetectedAt: string;
  lastDetectedAt: string; resolution: string | null; resolvedBy: string | null; resolvedAt: string | null; href: string };
export type MovementDetail = MovementEvent & { groupEvents: MovementEvent[]; corrections: MovementCorrection[]; can: { correct: boolean; evidence: boolean } };
export type AsOfPosition = { asset: { id: string; code: string; name: string }; date: string; mode: string; baselineAt: string | null; available: boolean; code?: string; message?: string;
  location?: { id: string; name: string | null; currentName: string | null } | null; custodian?: MovementCustodian; lifecycle?: string | null; lastMovement?: MovementEvent | null;
  evidence?: Array<{ type: string; id: string | null; number: string | null; href: string | null }>; corrected?: boolean };
export type MovementFilters = { search?: string; eventType?: string; certainty?: string; locationId?: string; from?: string; to?: string; exceptions?: string; movementsOnly?: string; sort?: string; page?: number; assetId?: string };

export const getMovements = (f: MovementFilters) => call<MovementPage>(qs(f));
export const getAssetMovements = (assetId: string, f: { eventType?: string; from?: string; to?: string } = {}) => call<AssetMovementHistory>(`/actions/asset${qs({ assetId, ...f })}`);
export const getAsOf = (assetId: string, date: string, mode: string) => call<AsOfPosition>(`/actions/as-of${qs({ assetId, date, mode })}`);
export const getMovement = (id: string) => call<MovementDetail>(`/${id}`);
export const getMovementSource = (id: string) => call<{ type: string; id: string; number: string | null; href: string | null }>(`/${id}/source`);
export const getMovementExceptions = () => call<{ rows: MovementEvent[]; issues: MovementIssue[]; corrections: MovementCorrection[] }>("/actions/exceptions");
export const getCorrections = (status?: string) => call<{ rows: MovementCorrection[] }>(`/actions/corrections${qs({ status })}`).then((r) => r.rows);
export const getIssues = () => call<{ rows: MovementIssue[] }>("/actions/report?kind=reconciliation").then((r) => r.rows);
export const getMovementReport = (kind: string, asOf?: string) => call<{ rows: Array<Record<string, unknown>>; summary?: { transactions: number; assetsMoved: number; events: number }; date?: string }>(`/actions/report${qs({ kind, asOf })}`);
export const requestCorrection = (eventId: string, input: Record<string, unknown>) => send<{ correctionId: string; number: string }>(`/${eventId}/request-correction`, input);
export const decideCorrection = (correctionId: string, decision: "APPLY" | "REJECT", note?: string) => send<{ status: string; applied?: boolean; conflict?: boolean; message?: string }>("/actions/decide-correction", { correctionId, decision, note });
export const resolveIssue = (issueId: string, resolution: string) => send("/actions/resolve-issue", { issueId, resolution });
export const reconcileMovements = (assetId?: string) => send<{ checked: number; found: number; opened: number; closed: number }>("/actions/reconcile", { assetId });
export const rebuildMovements = (assetId?: string) => send<{ removed: number; ingested: number }>("/actions/rebuild", { assetId });
export const movementsExportHref = (f: MovementFilters = {}) => `/api/assets/movements/export${qs(f)}`;

export const CERTAINTY_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { CONFIRMED: "success", PENDING: "info", OBSERVED: "neutral", DISPUTED: "danger", CORRECTED: "warning" };
export const EVENT_OPTIONS = [
  ["OPENING_BASELINE", "Opening baseline"], ["INITIAL_PLACEMENT", "Registered location"], ["INITIAL_CUSTODY", "First custodian"], ["ASSIGNMENT_ISSUED", "Issued to custodian"], ["ASSIGNMENT_RETURNED", "Returned"],
  ["CUSTODY_CHANGED", "Custody handed over"], ["HANDOVER_ACKNOWLEDGED", "Receipt acknowledged"], ["HANDOVER_DISPUTED", "Receipt disputed"], ["TRANSFER_REQUESTED", "Transfer requested"],
  ["TRANSFER_APPROVED", "Transfer approved"], ["TRANSFER_DISPATCHED", "Dispatched"], ["TRANSFER_RECEIVED", "Received"], ["TRANSFER_COMPLETED", "Transfer completed"], ["TRANSFER_CANCELLED", "Transfer cancelled"],
  ["MOVEMENT_EXCEPTION", "Movement exception"], ["TEMPORARY_MOVEMENT", "Temporary movement"], ["RETURN_FROM_TEMPORARY_MOVEMENT", "Back from temporary movement"], ["LOCATION_OBSERVED", "Location observed"],
  ["LOCATION_DISCREPANCY", "Location discrepancy"], ["MISSING_REPORTED", "Reported missing"], ["LOCATION_CHANGED", "Location updated"], ["DISPOSED", "Disposed"], ["MOVEMENT_CORRECTED", "Correction"],
].map(([value, label]) => ({ value, label }));
export const CERTAINTY_OPTIONS = [["CONFIRMED", "Confirmed"], ["PENDING", "Pending"], ["OBSERVED", "Observed"], ["DISPUTED", "Disputed"], ["CORRECTED", "Corrected"]].map(([value, label]) => ({ value, label }));
export const MOVEMENT_REPORT_KINDS = [
  { id: "complete-history", label: "Complete asset movement history" }, { id: "by-location", label: "Movement by location" }, { id: "by-custodian", label: "Movement by custodian" },
  { id: "interbranch", label: "Interbranch movement" }, { id: "internal-room", label: "Internal room movements" }, { id: "temporary-repair", label: "Temporary and repair movements" },
  { id: "pending", label: "Pending movements" }, { id: "partial-exceptions", label: "Partial receipt / transfer exceptions" }, { id: "corrections", label: "Movement corrections" },
  { id: "last-confirmed", label: "Last confirmed movement" }, { id: "unverified-observations", label: "Unverified location observations" }, { id: "no-movement", label: "No movement since registration" },
  { id: "historical-position", label: "Historical location / custody" }, { id: "reconciliation", label: "Reconciliation exceptions" },
];
export const ISSUE_LABEL: Record<string, string> = { LOCATION_MISMATCH: "Location differs from the registered location", CUSTODY_MISMATCH: "Custodian differs from the custody record",
  MISSING_BASELINE: "No opening baseline or registration placement", HISTORICAL_CONFLICT: "A correction would reorder later movements" };
