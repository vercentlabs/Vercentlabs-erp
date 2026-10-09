"use client";

// Browser client for Stock Counts under /api/inventory/stock-counts: physical inventory — the whole warehouse, some locations or some items —
// counted against the system stock captured when the count starts, its scope frozen until completed or cancelled, and its confirmed variances
// posted as one linked Stock Adjustment. A count never moves stock itself.
import { SalesApiError } from "@/features/sales/shared/http";

export type CountStatus = "draft" | "in_progress" | "ready_for_review" | "completed" | "cancelled";
export type CountType = "full_warehouse" | "locations" | "items";
export type LineStatus = "not_counted" | "counted" | "recount_required" | "accepted";
export type ResolutionType = "stock_adjustment" | "location_transfer" | "disposition_movement" | "manual_investigation" | "no_action";
export type CountHeader = {
  id: string; number: string; status: CountStatus; statusLabel: string; warehouseId: string; warehouse: string; warehouseName: string; countType: CountType; countTypeLabel: string;
  blindCount: boolean; snapshotAt: string | null; assignedUserId: string | null; assignedUserName: string | null; recountThresholdPercent: number | null; reference: string | null;
  instructions: string | null; lineCount: number; countedLines: number; recountLines: number; varianceLines: number; progress: number; adjustmentId: string | null;
  adjustmentNumber: string | null; adjustmentStatus: string | null; valueNet?: number; createdAt: string; createdByName: string | null; startedAt: string | null; submittedAt: string | null;
  completedAt: string | null; completedByName: string | null; cancelledAt: string | null; cancelReason: string | null; version: number;
};
export type CountLine = {
  id: string; lineNumber: number; itemId: string; sku: string; itemName: string; trackingType: "none" | "batch" | "serial"; locationId: string | null; location: string;
  disposition: string; batchId: string | null; batch: string | null; newBatch: boolean; expiresOn: string | null; baseUomId: string | null; baseUom: string | null; status: LineStatus;
  unexpected: boolean; counted: number | null; accepted: number | null; system?: number; variance?: number | null; variancePercent?: number | null; kinds: string[];
  serials: Array<{ serialNumber: string; expected: boolean; result: string | null }>; resolutionType: ResolutionType; resolutionNote: string | null; valuationSource: string | null;
  unitCost: number | null; costNote: string | null; notes: string | null;
  attempts: Array<{ attempt: number; quantity: number; uom: string | null; conversion: number; baseQuantity: number; source: string; notes: string | null; countedBy: string | null; countedAt: string }>;
};
export type CountSummary = {
  lines: number; counted: number; notCounted: number; recountRequired: number; accepted: number; serialsExpected: number; serialsPresent: number; noVariance?: number; shortages?: number;
  gains?: number; serialsMissing?: number; serialsUnexpected?: number; possibleMisplacements?: number;
};
export type CountDetail = {
  count: CountHeader; scope: Array<{ locationScoped: boolean; locationId: string | null; location: string | null; itemId: string | null; item: string | null }>; lines: CountLine[];
  summary: CountSummary; history: Array<{ type: string; summary: string; at: string; actor: string | null }>; seesSystemQuantity: boolean;
  capabilities: { edit: boolean; start: boolean; count: boolean; countSerial: boolean; addUnexpected: boolean; import: boolean; submit: boolean; requestRecount: boolean; recount: boolean;
    review: boolean; complete: boolean; resolveReservations: boolean; cancel: boolean; export: boolean; seesValue: boolean };
};
export type CountOptions = {
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean; locations: Array<{ id: string; code: string; name: string; isMain: boolean }> }>;
  countTypes: Array<{ id: CountType; label: string }>; statuses: Array<{ id: CountStatus; label: string }>; resolutionTypes: Array<{ id: ResolutionType; label: string }>;
  capabilities: Record<string, boolean>;
};
export type ScopePreview = { locations: number; items: number; positions: number; batchPositions: number; serialsExpected: number; activeReservations: number; overlaps: string[]; freeze: string };
export type AdjustmentPreview = {
  lines: number; ready: boolean; errors: Array<{ message: string; code: string }>;
  impact: null | { ready: boolean; value?: { increase: number; decrease: number; net: number }; lines: Array<{ lineId: string; lineNumber: number; sku: string; location: string; difference: number;
    parts: Array<{ key: string; batch: string | null; serial: string | null; onHand: number; reserved: number; difference: number; projectedOnHand: number; shortfall: number;
      reservations: Array<{ id: string; number: string; document: string | null; quantity: number; serialId: string | null }> }> }> };
};
export type CountInput = {
  warehouseId: string; countType: CountType; locationIds?: string[]; itemIds?: string[]; blindCount?: boolean; recountThresholdPercent?: string | number | null; reference?: string | null;
  instructions?: string | null; expectedVersion?: number;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/stock-counts";
function call<T>(path: string, init?: { method?: string; json?: unknown; body?: FormData }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ?? (init?.json !== undefined ? JSON.stringify(init.json) : undefined),
  }).then(parse<T>);
}
const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};
const detailOf = (result: { detail: CountDetail }) => result.detail;
const act = (id: string, action: string, json: unknown = {}) => call<{ detail: CountDetail | { count: CountDetail } }>(`/${id}/${action}`, { method: "POST", json })
  .then((result) => ("count" in result.detail && "summary" in (result.detail as { count: CountDetail }).count ? (result.detail as { count: CountDetail }).count : result.detail as CountDetail));

export const listCounts = (filters: Record<string, string | undefined>) => call<{ total: number; rows: CountHeader[]; canCreate: boolean; seesValue: boolean }>(query(filters));
export const getCountOptions = () => call<{ options: CountOptions }>("/options").then((result) => result.options);
export const getCount = (id: string) => call<{ detail: CountDetail }>(`/${id}`).then(detailOf);
export const createCount = (input: CountInput) => call<{ detail: CountDetail }>("", { method: "POST", json: input }).then(detailOf);
export const updateCount = (id: string, input: Partial<CountInput>) => call<{ detail: CountDetail }>(`/${id}`, { method: "PATCH", json: input }).then(detailOf);
export const previewScope = (id: string) => call<{ preview: ScopePreview }>(`/${id}/scope-preview`).then((result) => result.preview);
export const previewAdjustment = (id: string) => call<{ preview: AdjustmentPreview }>(`/${id}/adjustment-preview`).then((result) => result.preview);
export const startCount = (id: string) => act(id, "start");
export const enterCount = (id: string, input: { lineId: string; quantity: string; uomId?: string; notes?: string }) => act(id, "entries", input);
export const enterSerials = (id: string, input: { lineId: string; presentSerialNumbers: string[]; unexpectedSerialNumbers?: string[] }) => act(id, "serials", input);
export const addUnexpected = (id: string, input: { itemId: string; locationId?: string | null; quantity?: string; uomId?: string; batchNumber?: string; newExpiresOn?: string; serialNumbers?: string[]; notes?: string }) =>
  act(id, "unexpected", input);
export const requestRecount = (id: string, lineIds: string[], reason?: string) => act(id, "recount", { lineIds, reason });
export const submitCount = (id: string) => act(id, "submit");
export const acceptLines = (id: string, lineIds?: string[]) => act(id, "accept", { lineIds });
export const setResolution = (id: string, input: { lineId: string; resolutionType?: ResolutionType; note?: string; valuationSource?: string | null; unitCost?: string; costNote?: string }) =>
  act(id, "resolution", input);
export const completeCount = (id: string, resolutions: Array<{ reservationId: string; action: "release" | "reallocate"; quantity?: string; serialId?: string }> = []) => act(id, "complete", { resolutions });
export const cancelCount = (id: string, reason: string) => act(id, "cancel", { reason });
export const importSheet = (id: string, file: File) => { const body = new FormData(); body.append("file", file); return call<{ result: { imported: number } }>(`/${id}/import`, { method: "POST", body }); };
export const sheetUrl = (id: string, format: "csv" | "xlsx") => `${BASE}/${id}/sheet?format=${format}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const errorDetails = (error: unknown) => (error instanceof SalesApiError ? (error.payload as { details?: { errors?: Array<{ row?: number; message: string }> }; errors?: Array<{ row?: number; message: string }> }) : null);
export const STATUS_TONE: Record<CountStatus, "info" | "success" | "warning" | "neutral"> = { draft: "neutral", in_progress: "info", ready_for_review: "warning", completed: "success", cancelled: "neutral" };
export const LINE_STATUS_LABEL: Record<LineStatus, string> = { not_counted: "Not counted", counted: "Counted", recount_required: "Recount", accepted: "Accepted" };
export const KIND_LABEL: Record<string, string> = {
  no_variance: "No variance", shortage: "Shortage", gain: "Gain", missing_serial: "Missing serial", unexpected_serial: "Unexpected serial", unexpected_batch: "New batch",
  recount_required: "Recount required", possible_misplacement: "Possible misplacement",
};
export const STOCK_COUNTS_BASE = "/inventory/stock-counts";
