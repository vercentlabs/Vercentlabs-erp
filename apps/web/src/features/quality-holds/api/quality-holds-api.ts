"use client";

// Browser client for Quality Holds under /api/inventory/quality-holds: the one Inventory workflow that restricts owned stock — quality hold or
// quarantine — until an authorised decision. Placing, releasing, escalating and moving to damaged are balanced disposition movements: on hand
// never changes, Available does. A goods receipt or sales return that puts stock on hold opens a case for it.
import { SalesApiError } from "@/features/sales/shared/http";

export type HoldType = "quality_hold" | "quarantine";
export type HoldStatus = "draft" | "active" | "partially_resolved" | "resolved" | "cancelled";
export type HoldHeader = {
  id: string; number: string; holdType: HoldType; holdTypeLabel: string; status: HoldStatus; statusLabel: string; reasonId: string; reason: string; reasonCode: string;
  source: { type: string; id: string | null; number: string | null; href: string | null }; originWarehouseId: string; originWarehouse: string; originWarehouseName: string;
  currentWarehouses: string | null; assignedUserId: string | null; assignedUserName: string | null; reviewDueOn: string | null; overdue: boolean; inspectionResult: string | null;
  inspectionNotes: string | null; decisionAt: string | null; notes: string | null; skus: string | null; heldQuantity: number; originalQuantity: number; createdAt: string;
  createdByName: string | null; activatedAt: string | null; activatedByName: string | null; resolvedAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  version: number; heldValue?: number;
};
export type HoldLine = {
  id: string; lineNumber: number; itemId: string; sku: string; itemName: string; trackingType: "none" | "batch" | "serial"; warehouseId: string; sourceLocationId: string | null;
  sourceLocation: string; targetLocationId: string | null; targetLocation: string | null; batchId: string | null; batch: string | null; serialIds: string[]; quantity: number;
  uom: string | null; baseUom: string | null; baseQuantity: number; unresolved: number; sourceDisposition: string; holdDisposition: string; notes: string | null;
};
export type HoldAllocation = {
  id: string; lineId: string; itemId: string; warehouseId: string; warehouse: string; locationId: string | null; location: string; batch: string | null; expiresOn: string | null;
  serial: string | null; held: number; resolved: number; remaining: number; disposition: string; dispositionLabel: string; status: "active" | "resolved" | "moved";
};
export type HoldResolution = { id: string; action: string; label: string; quantity: number; from: string | null; to: string | null; fromLocation: string | null; toLocation: string | null;
  movement: string | null; movementId: string | null; document: { type: string; id: string; number: string } | null; reason: string | null; by: string | null; at: string };
export type HoldDetail = {
  hold: HoldHeader; lines: HoldLine[]; allocations: HoldAllocation[]; resolutions: HoldResolution[]; history: Array<{ type: string; summary: string; at: string; actor: string | null }>;
  capabilities: { edit: boolean; cancel: boolean; place: boolean; release: boolean; releaseQuarantine: boolean; partialRelease: boolean; escalate: boolean; damage: boolean; review: boolean;
    files: boolean; seesValue: boolean; purchaseReturn: boolean; dispose: boolean };
};
export type Reason = { id: string; code: string; name: string; defaultHoldType: HoldType; requiresNotes: boolean; defaultReviewDays: number | null; status: "active" | "inactive"; system: boolean; version: number };
export type HoldOptions = {
  holdTypes: Array<{ id: HoldType; label: string }>; statuses: Array<{ id: HoldStatus; label: string }>; inspectionResults: Array<{ id: string; label: string }>; reasons: Reason[];
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean; locations: Array<{ id: string; code: string; name: string; disposition: string; isMain: boolean }> }>;
  reviewers: Array<{ id: string; name: string }>; capabilities: { create: boolean; place: boolean; placeQuarantine: boolean; manageReasons: boolean; resolveReservations: boolean };
};
export type HoldValidation = { ready: boolean; errors: Array<{ message: string; code: string }>;
  reservationConflicts: Array<{ lineId: string; lineNumber: number; sku: string; shortfall: number; reservations: Array<{ id: string; number: string; quantity: number; source: string }> }> };
export type HeldStockRow = { itemId: string; sku: string; itemName: string; warehouseId: string; warehouse: string; locationId: string; location: string; batchId: string | null; batch: string | null;
  disposition: string; dispositionLabel: string; onHand: number; explained: number; unexplained: number; holds: string | null };
export type HoldInput = { holdType: HoldType; reasonId: string; warehouseId: string; assignedUserId?: string | null; reviewDueOn?: string | null; notes?: string | null; expectedVersion?: number;
  lines: Array<{ itemId: string; quantity?: string; uomId?: string; sourceLocationId?: string | null; batchId?: string | null; serialIds?: string[]; targetLocationId?: string | null; notes?: string }> };

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/quality-holds";
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
const detailOf = (result: { detail: HoldDetail }) => result.detail;

export const listHolds = (filters: Record<string, string | undefined>) => call<{ rows: HoldHeader[]; canCreate: boolean }>(query(filters));
export const getHoldOptions = () => call<{ options: HoldOptions }>("/options").then((result) => result.options);
export const getHold = (id: string) => call<{ detail: HoldDetail }>(`/${id}`).then(detailOf);
export const createHold = (input: HoldInput) => call<{ detail: HoldDetail }>("", { method: "POST", json: input }).then(detailOf);
export const updateHold = (id: string, input: Partial<HoldInput>) => call<{ detail: HoldDetail }>(`/${id}`, { method: "PATCH", json: input }).then(detailOf);
export const validateHold = (id: string) => call<{ validation: HoldValidation }>(`/${id}/validate`).then((result) => result.validation);
export const placeHold = (id: string) => call<{ detail: HoldDetail }>(`/${id}/place`, { method: "POST", json: {} }).then(detailOf);
export const cancelHold = (id: string, reason: string) => call<{ detail: HoldDetail }>(`/${id}/cancel`, { method: "POST", json: { reason } }).then(detailOf);
export const resolveHold = (id: string, input: { action: "release" | "escalate" | "damage"; reason: string; decision?: string; targetLocationId?: string | null; idempotencyKey?: string;
  entries?: Array<{ allocationId: string; quantity?: string }> }) => call<{ detail: HoldDetail }>(`/${id}/resolve`, { method: "POST", json: input }).then(detailOf);
export const reviewHold = (id: string, input: { assignedUserId?: string | null; reviewDueOn?: string | null; inspectionNotes?: string | null; inspectionResult?: string }) =>
  call<{ detail: HoldDetail }>(`/${id}/review`, { method: "POST", json: input }).then(detailOf);
export const listHeldStock = (filters: Record<string, string | undefined>) => call<{ rows: HeldStockRow[]; unexplained: number }>(`/held-stock${query(filters)}`);
export const registerHeld = (input: { warehouseId: string; reasonId: string; notes?: string; positions: Array<{ itemId: string; locationId: string; batchId?: string | null; quantity: string }> }) =>
  call<{ holdId: string }>("/register", { method: "POST", json: input });
export const listReasons = (includeInactive = false) => call<{ reasons: Reason[] }>(`/reasons${query({ includeInactive: includeInactive ? "true" : undefined })}`).then((result) => result.reasons);
export const createReason = (input: Partial<Reason>) => call<{ reason: Reason }>("/reasons", { method: "POST", json: input }).then((result) => result.reason);
export const updateReason = (id: string, input: Partial<Reason> & { expectedVersion?: number }) => call<{ reason: Reason }>(`/reasons/${id}`, { method: "PATCH", json: input }).then((result) => result.reason);
export const listHoldFiles = (id: string) => call<{ files: Array<{ id: string; fileName: string; sizeBytes: number; uploadedAt: string }> }>(`/${id}/files`).then((result) => result.files);
export const uploadHoldFile = (id: string, file: File) => { const body = new FormData(); body.append("file", file); return call<{ file: unknown }>(`/${id}/files`, { method: "POST", body }); };
export const holdFileUrl = (id: string, fileId: string) => `${BASE}/${id}/files/${fileId}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const errorsOf = (error: unknown): Array<{ message: string; code: string }> =>
  error instanceof SalesApiError && Array.isArray((error.payload as { errors?: unknown })?.errors) ? (error.payload as { errors: Array<{ message: string; code: string }> }).errors : [];
export const STATUS_TONE: Record<HoldStatus, "info" | "success" | "warning" | "neutral" | "danger"> = { draft: "neutral", active: "warning", partially_resolved: "info", resolved: "success", cancelled: "neutral" };
export const QUALITY_HOLDS_BASE = "/inventory/quality-holds";
