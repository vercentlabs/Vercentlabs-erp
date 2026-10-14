"use client";

// Production Hold: the client of /api/manufacturing/orders/<id>/hold, /production-holds and /production-hold-reports.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type HoldStatus = "ACTIVE" | "RESUMED" | "CLOSED";
export type Severity = "NORMAL" | "HIGH" | "CRITICAL";
export type Authority = "PRODUCTION" | "QUALITY" | "SAFETY";
export type ReadinessCheck = { code: string; ok: boolean; blocking: boolean; message: string };
export type Readiness = {
  orderId: string; orderNumber: string; holdId: string | null; holdNumber?: string; holdVersion?: number; orderVersion: number; ready: boolean; checks: ReadinessCheck[]; warnings: string[];
  approval: { required: boolean; requested: boolean; requestedBy: string | null; current: boolean; approved: boolean } | null; targetStatus: string | null; checkedAt?: string;
  materials?: { remaining: string; feasible: string; short: number };
};
export type HoldReason = {
  id: string; code: string; label: string; severity: Severity; description: string; authority: Authority; authorityLabel: string; sourceType: string | null; sourceId: string | null;
  sourceReference: string | null; materials: string[]; status: "ACTIVE" | "RESOLVED"; correctiveAction: string | null; resolutionNotes: string | null; evidence: string | null;
  addedBy: string | null; addedAt: string; resolvedBy: string | null; resolvedAt: string | null; pendingClearance: string | null; can: { resolve: boolean; act: boolean };
};
export type DemandLine = { demandId: string; salesOrderId: string; salesOrderNumber: string; customer: string | null; requiredDate: string | null; allocated: string; received: string;
  unfinished: string; risk: "NONE" | "ON_TRACK" | "AT_RISK" | "LATE"; salesMessage: string | null };
export type ProductionHold = {
  id: string; number: string; status: HoldStatus; statusLabel: string; severity: Severity; rowVersion: number;
  order: { id: string; number: string; status: string; statusLabel: string; version: number; item: string; planned: string; accepted: string; remaining: string; productionOwner: string | null; plannedEndAt: string | null };
  previousStatus: string; previousStatusLabel: string; resumedTo: string | null; owner: string | null; ownerId: string | null; location: { code: string; name: string } | null;
  notes: string | null; expectedResolutionAt: string | null; startedAt: string; requestedBy: string | null; resolvedAt: string | null; resumedBy: string | null; resolutionNotes: string | null;
  closedReason: string | null; durationHours: number; overdue: boolean; overdueAfterHours: number; reasons: HoldReason[];
  resumeRequest: { by: string | null; at: string; note: string | null; current: boolean; approvedBy: string | null; approvedAt: string | null } | null;
  readiness: Readiness | null; salesDemand: DemandLine[];
  dependencies: { parents: Array<{ id: string; number: string; statusLabel: string; item: string; note: string | null }>;
    children: Array<{ id: string; number: string; statusLabel: string; item: string; holdNumber: string | null; heldSince: string | null }> };
  history: Array<{ action: string; label: string; summary: string | null; actor: string | null; at: string }>;
  can: Record<"addReason" | "resume" | "requestResume" | "decideResume" | "attach" | "seeCost", boolean>;
  policy: { resumeApprovalRequired: boolean; releaseWithShortages: boolean };
};
export type HoldRow = {
  id: string; number: string; status: HoldStatus; statusLabel: string; severity: Severity; orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; item: string;
  reasons: string[]; primaryReason: string | null; openReasons: number; waitingOn: string[]; owner: string | null; startedAt: string; resolvedAt: string | null; durationHours: number;
  overdue: boolean; previousStatus: string; remaining: string; customerLines: number; plannedEndAt: string | null; expectedResolutionAt: string | null; resumeRequested: boolean;
};
export type HoldSummary = { active: number; critical: number; overdue: number; longestActiveHours: number; averageHours: number; affectedQuantity: string; customerOrdersAtRisk: number };
export type HoldFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };

export const HOLDS_BASE = "/manufacturing/production-holds";
export const REASON_OPTIONS = [
  { value: "MATERIAL_SHORTAGE", label: "Material shortage" }, { value: "QUALITY_FAILURE", label: "Quality failure" }, { value: "EQUIPMENT_BREAKDOWN", label: "Equipment breakdown" },
  { value: "SAFETY_CONCERN", label: "Safety concern" }, { value: "WORKFORCE_UNAVAILABLE", label: "Workforce unavailable" }, { value: "CUSTOMER_CHANGE", label: "Customer change" },
  { value: "PRODUCTION_PRIORITY", label: "Production priority" }, { value: "EXCESS_CONSUMPTION", label: "Excess consumption" }, { value: "INVENTORY_DISCREPANCY", label: "Inventory discrepancy" },
  { value: "COSTING_EXCEPTION", label: "Costing exception" }, { value: "OTHER", label: "Other" },
];
export const SEVERITY_OPTIONS = [{ value: "NORMAL", label: "Normal — operational interruption" }, { value: "HIGH", label: "High — significant production or delivery risk" },
  { value: "CRITICAL", label: "Critical — safety, serious quality or legal restriction" }];
export const SEVERITY_TONE: Record<Severity, "neutral" | "warning" | "danger"> = { NORMAL: "neutral", HIGH: "warning", CRITICAL: "danger" };
export const STATUS_TONE: Record<HoldStatus, "warning" | "success" | "neutral"> = { ACTIVE: "warning", RESUMED: "success", CLOSED: "neutral" };
export const duration = (hours: number) => (hours < 1 ? `${Math.round(hours * 60)} min` : hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`);

export const listHolds = (filters: Record<string, string | undefined>) => call<{ holds: HoldRow[]; summary: HoldSummary }>(`/production-holds${qs(filters)}`);
export const getHold = (id: string) => call<{ hold: ProductionHold }>(`/production-holds/${id}`).then((r) => r.hold);
export const activeHold = (orderId: string) => call<{ hold: ProductionHold | null }>(`/orders/${orderId}/hold`).then((r) => r.hold);
export const holdHistory = (orderId: string) => call<{ history: { episodes: HoldRow[]; totalDowntimeHours: number } }>(`/orders/${orderId}/hold/history`).then((r) => r.history);
export const placeHold = (orderId: string, input: Record<string, unknown>) => send<{ holdId: string; holdNumber?: string; added?: boolean }>(`/orders/${orderId}/hold`, input);
export const resumeReadiness = (orderId: string, proceedWithShortages = false) =>
  call<{ readiness: Readiness }>(`/orders/${orderId}/hold/readiness${proceedWithShortages ? "?proceedWithShortages=true" : ""}`).then((r) => r.readiness);
export const holdAction = (orderId: string, action: "resume" | "request-resume" | "decide-resume", input: Record<string, unknown>) => send<Record<string, unknown>>(`/orders/${orderId}/hold/${action}`, input);
export const reasonAction = (reasonId: string, action: "resolve" | "corrective-action", input: Record<string, unknown>) => send<Record<string, unknown>>(`/production-holds/reasons/${reasonId}/${action}`, input);
export const holdFiles = (id: string) => call<{ files: HoldFile[] }>(`/production-holds/${id}/files`).then((r) => r.files);
export const removeHoldFile = (id: string, fileId: string) => send(`/production-holds/${id}/files/${fileId}`, {}, "DELETE");
export async function uploadHoldFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: HoldFile }>(`/production-holds/${id}/files`, { method: "POST", body: form, headers: { Accept: "application/json" } }).then((r) => r.file);
}
export const holdReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/production-hold-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
