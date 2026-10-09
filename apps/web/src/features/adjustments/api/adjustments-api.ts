"use client";

// Browser client for Stock Adjustments under /api/inventory/adjustments: the one document that corrects recorded stock to what physically
// exists. Counted (the system stock is captured with the count; a stale count is refused) or entered as a difference; drafted, previewed,
// posted once with any reservation conflicts resolved in the same posting, reversed only for a posting mistake.
import { SalesApiError } from "@/features/sales/shared/http";

export type AdjustmentStatus = "draft" | "posted" | "cancelled" | "reversed";
export type Disposition = "available" | "quality_hold" | "quarantined" | "damaged" | "expired";
export type EntryMode = "counted" | "difference";
export type ValuationSource = "current_valuation_cost" | "manual_authorized_cost" | "zero_cost_authorized";
export type Reason = {
  id: string; code: string; name: string; description: string | null; directionPolicy: "increase" | "decrease" | "both"; requiresNotes: boolean;
  gainAccountId: string | null; gainAccount: string | null; lossAccountId: string | null; lossAccount: string | null; isSystem: boolean; status: "active" | "inactive"; version: number;
};
export type AdjustmentHeader = {
  id: string; number: string; status: AdjustmentStatus; warehouseId: string; warehouse: string; warehouseName: string; adjustmentDate: string; postingDate: string | null;
  reasonId: string; reasonCode: string; reason: string; directionPolicy: string; reference: string | null; countReference: string | null; physicalCountId: string | null; notes: string | null;
  lineCount: number; increaseLines: number; decreaseLines: number; createdAt: string; createdByName: string | null; postedAt: string | null; postedByName: string | null;
  cancelledAt: string | null; cancelReason: string | null; reversedAt: string | null; reversedByName: string | null; reversalReason: string | null; version: number;
  valueIncrease?: number; valueDecrease?: number; valueNet?: number;
};
export type AdjustmentLine = {
  id: string; lineNumber: number; itemId: string; sku: string; itemName: string; trackingType: "none" | "batch" | "serial"; locationId: string | null; location: string;
  disposition: Disposition; entryMode: EntryMode; uomId: string; uom: string; conversion: number; baseUom: string | null; systemQuantity: number; countedQuantity: number | null;
  countedBaseQuantity: number | null; enteredDifference: number | null; difference: number; countedAt: string | null; valuationSource: ValuationSource | null; unitCost?: number | null;
  costNote: string | null; notes: string | null; movementIds: string[];
  batches: Array<{ batchId: string | null; batch: string; isNew: boolean; expiresOn: string | null; systemQuantity: number; countedQuantity: number | null; difference: number }>;
  serials: Array<{ id: string | null; serialNumber: string; direction: "in" | "out"; reservationResolution: unknown }>;
  value?: number;
};
export type LedgerMovement = {
  id: string; number: string; type: string; typeLabel: string; effectiveAt: string; postedAt: string; sku: string; warehouse: string; location: string; batch: string | null;
  serial: string | null; quantity: number; baseUom: string | null; unitCost?: number; value?: number;
};
export type ImpactReservation = { id: string; number: string; source: string; document: string | null; quantity: number; serialId: string | null };
export type ImpactPart = {
  key: string; batch: string | null; serial: string | null; onHand: number; reserved: number; available: number; difference: number; projectedOnHand: number; projectedReserved: number;
  reservations: ImpactReservation[]; shortfall: number; value?: number; unitCost?: number | null;
};
export type Impact = {
  ready: boolean; errors: Array<{ message: string; code: string; details?: Record<string, unknown> }>; large: boolean; value?: { increase: number; decrease: number; net: number };
  lines: Array<{ lineId: string; lineNumber: number; sku: string; itemName: string; location: string; disposition: string; entryMode: EntryMode; baseUom: string | null; difference: number;
    stale: boolean; parts: ImpactPart[] }>;
};
export type AdjustmentDetail = {
  adjustment: AdjustmentHeader; lines: AdjustmentLine[]; movements: LedgerMovement[]; history: Array<{ type: string; summary: string; at: string; actor: string | null }>;
  journals: Array<{ id: string; number: string; date: string; status: string; reversal: boolean; href: string; lines: Array<{ account: string; debit: number; credit: number }> }> | null;
  files: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string }>;
  capabilities: { edit: boolean; count: boolean; post: boolean; cancel: boolean; reverse: boolean; resolveReservations: boolean; seesCost: boolean; seesAccounting: boolean };
};
export type AdjustmentOptions = {
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean; locations: Array<{ id: string; code: string; name: string; isMain: boolean; disposition: Disposition }> }>;
  reasons: Reason[]; dispositions: Array<{ id: Disposition; label: string }>; valuationSources: Array<{ id: ValuationSource; label: string }>; valueThreshold: number | null;
  capabilities: { create: boolean; edit: boolean; count: boolean; postIncrease: boolean; postDecrease: boolean; restricted: boolean; batch: boolean; serial: boolean; resolveReservations: boolean;
    manualCost: boolean; zeroCost: boolean; backdate: boolean; reverse: boolean; seesCost: boolean; manageReasons: boolean };
};
export type Stock = {
  positions: Array<{ locationId: string | null; location: string; batchId: string | null; batch: string | null; expiresOn: string | null; disposition: string; onHand: number; reserved: number; available: number }>;
  serials: Array<{ id: string; serialNumber: string; locationId: string | null; batchId: string | null; reserved: boolean }>;
  totals: { onHand: number; reserved: number; available: number };
};
export type LineInput = {
  lineId?: string; itemId: string; locationId?: string | null; disposition?: Disposition; entryMode: EntryMode; uomId?: string; countedQuantity?: string; difference?: string;
  batches?: Array<{ batchId?: string; newBatchNumber?: string; newExpiresOn?: string; counted?: string; difference?: string }>;
  missingSerialIds?: string[]; presentSerialIds?: string[]; foundSerialNumbers?: string[]; serialsOut?: string[]; serialsIn?: string[]; valuationSource?: ValuationSource; unitCost?: string; costNote?: string; notes?: string | null;
};
export type AdjustmentInput = {
  warehouseId: string; adjustmentDate?: string; reasonId: string; reference?: string | null; countReference?: string | null; notes?: string | null; lines: LineInput[]; expectedVersion?: number;
  idempotencyKey?: string;
};
export type Resolution = { reservationId: string; action: "release" | "reallocate"; quantity?: string; locationId?: string; batchId?: string; serialId?: string };

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/adjustments";
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
const detailOf = (result: { detail: AdjustmentDetail }) => result.detail;

export const listAdjustments = (filters: Record<string, string | undefined>) => call<{ total: number; rows: AdjustmentHeader[]; canCreate: boolean; seesCost: boolean }>(query(filters));
export const getAdjustmentOptions = () => call<{ options: AdjustmentOptions }>("/options").then((result) => result.options);
export const getStock = (warehouseId: string, itemId: string) => call<{ stock: Stock }>(`/stock${query({ warehouseId, itemId })}`).then((result) => result.stock);
export const getAdjustment = (id: string) => call<{ detail: AdjustmentDetail }>(`/${id}`).then(detailOf);
export const getImpact = (id: string) => call<{ impact: Impact }>(`/${id}/impact`).then((result) => result.impact);
export const createAdjustment = (input: AdjustmentInput) => call<{ detail: AdjustmentDetail }>("", { method: "POST", json: input }).then(detailOf);
export const updateAdjustment = (id: string, input: Partial<AdjustmentInput>) => call<{ detail: AdjustmentDetail }>(`/${id}`, { method: "PATCH", json: input }).then(detailOf);
export const postAdjustment = (id: string, resolutions: Resolution[] = []) => call<{ detail: AdjustmentDetail }>(`/${id}/post`, { method: "POST", json: { resolutions } }).then(detailOf);
export const recheckAdjustment = (id: string) => call<{ detail: AdjustmentDetail }>(`/${id}/recheck`, { method: "POST", json: {} }).then(detailOf);
export const cancelAdjustment = (id: string, reason: string) => call<{ detail: AdjustmentDetail }>(`/${id}/cancel`, { method: "POST", json: { reason } }).then(detailOf);
export const reverseAdjustment = (id: string, reason: string) => call<{ detail: AdjustmentDetail }>(`/${id}/reverse`, { method: "POST", json: { reason } }).then(detailOf);
export const listReasons = (includeInactive = false) => call<{ reasons: Reason[] }>(`/reasons${query({ includeInactive: includeInactive ? "true" : undefined })}`).then((result) => result.reasons);
export const createReason = (input: Partial<Reason>) => call<{ reason: Reason }>("/reasons", { method: "POST", json: input }).then((result) => result.reason);
export const updateReason = (id: string, input: Partial<Reason> & { expectedVersion?: number }) => call<{ reason: Reason }>(`/reasons/${id}`, { method: "PATCH", json: input }).then((result) => result.reason);
export const uploadAdjustmentFile = (id: string, file: File) => { const body = new FormData(); body.append("file", file); return call<{ file: unknown }>(`/${id}/files`, { method: "POST", body }); };
export const removeAdjustmentFile = (id: string, fileId: string) => call<{ result: unknown }>(`/${id}/files/${fileId}`, { method: "DELETE", json: {} });
export const adjustmentFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const errorsOf = (error: unknown): Array<{ message: string; code: string }> =>
  error instanceof SalesApiError && Array.isArray((error.payload as { errors?: unknown })?.errors) ? (error.payload as { errors: Array<{ message: string; code: string }> }).errors : [];
export const DISPOSITION_LABEL: Record<string, string> = { available: "Available", quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged", expired: "Expired / blocked", restricted: "Restricted" };
export const STATUS_LABEL: Record<AdjustmentStatus, string> = { draft: "Draft", posted: "Posted", cancelled: "Cancelled", reversed: "Reversed" };
export const STATUS_TONE: Record<AdjustmentStatus, "info" | "success" | "warning" | "neutral"> = { draft: "info", posted: "success", cancelled: "neutral", reversed: "warning" };
export const ADJUSTMENTS_BASE = "/inventory/adjustments";
export const signed = (value: number) => (value > 0 ? `+${value.toLocaleString("en-IN", { maximumFractionDigits: 6 })}` : value.toLocaleString("en-IN", { maximumFractionDigits: 6 }));
