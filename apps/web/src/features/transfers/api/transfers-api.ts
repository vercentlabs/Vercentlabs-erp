"use client";

// Browser client for Internal Transfers under /api/inventory/transfers: stock moved inside the company — between warehouses (direct, or through
// Goods in Transit) or between locations of one warehouse. Drafted, confirmed (source stock reserved), dispatched and received, fully or partly;
// never edited after it moves, and never changes the stock's disposition.
import { SalesApiError } from "@/features/sales/shared/http";

export type TransferStatus = "draft" | "confirmed" | "dispatched" | "partially_received" | "completed" | "cancelled" | "reversed";
export type TransferType = "warehouse" | "location";
export type TransferMode = "direct" | "in_transit";
export type Disposition = "available" | "quality_hold" | "quarantined" | "damaged" | "expired";
export type TransferHeader = {
  id: string; number: string; type: TransferType; mode: TransferMode; status: TransferStatus; statusLabel: string; sourceWarehouseId: string; source: string; sourceName: string;
  destinationWarehouseId: string; destination: string; destinationName: string; transferDate: string; expectedArrivalDate: string | null; dispatchDate: string | null;
  receiptDate: string | null; reasonCode: string | null; reason: string | null; reference: string | null; carrier: string | null; vehicleNumber: string | null;
  transportReference: string | null; notes: string | null; discrepancyNote: string | null; lineCount: number; inTransit: number; createdAt: string; createdByName: string | null;
  confirmedAt: string | null; confirmedByName: string | null; dispatchedAt: string | null; dispatchedByName: string | null; completedAt: string | null; completedByName: string | null;
  cancelledAt: string | null; cancelReason: string | null; reversedAt: string | null; reversalReason: string | null; version: number;
};
export type TransferLine = {
  id: string; lineNumber: number; itemId: string; sku: string; itemName: string; trackingType: "none" | "batch" | "serial"; quantity: number; uomId: string; uom: string; conversion: number;
  baseQuantity: number; baseUom: string | null; sourceLocationId: string | null; sourceLocation: string; destinationLocationId: string | null; destinationLocation: string;
  disposition: Disposition; dispatched: number; received: number; lost: number; inTransit: number; notes: string | null;
  batches: Array<{ batchId: string; batch: string; expiresOn: string | null; quantity: number; received: number; lost: number }>;
  serials: Array<{ id: string; serialNumber: string; status: "allocated" | "in_transit" | "received" | "lost" }>;
  availableNow?: number;
};
export type LedgerMovement = {
  id: string; number: string; type: string; typeLabel: string; effectiveAt: string; postedAt: string; sku: string; itemName: string; warehouse: string; warehouseId: string; location: string;
  batch: string | null; serial: string | null; quantity: number; baseUom: string | null; groupId: string;
};
export type TransferDetail = {
  transfer: TransferHeader; lines: TransferLine[]; movements: LedgerMovement[]; history: Array<{ type: string; summary: string; at: string; actor: string | null }>;
  reservations: Array<{ number: string; status: string; quantity: number; active: number; consumed: number; released: number }>;
  capabilities: { edit: boolean; confirm: boolean; backToDraft: boolean; cancel: boolean; dispatch: boolean; complete: boolean; receive: boolean; writeOff: boolean; reverse: boolean };
};
export type TransferLocation = { id: string; code: string; name: string; isMain: boolean; isReceiving: boolean; disposition: string | null };
export type TransferOptions = {
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean; transferEnabled: boolean; mine: boolean; locations: TransferLocation[] }>;
  reasons: Array<{ id: string; label: string }>; statuses: Array<{ id: TransferStatus; label: string }>;
  capabilities: { create: boolean; confirm: boolean; dispatch: boolean; receive: boolean; restricted: boolean; writeOff: boolean; reverse: boolean; export: boolean };
};
export type Availability = {
  positions: Array<{ locationId: string | null; location: string; batchId: string | null; batch: string | null; expiresOn: string | null; disposition: string; onHand: number; reserved: number; available: number }>;
  serials: Array<{ id: string; serialNumber: string; locationId: string | null; batchId: string | null; reserved: boolean }>;
  totals: { onHand: number; reserved: number; available: number };
};
export type LineInput = {
  itemId: string; quantity: string; uomId?: string; sourceLocationId?: string | null; destinationLocationId?: string | null; disposition?: Disposition;
  batches?: Array<{ batchId: string; quantity: string }>; serialIds?: string[]; notes?: string | null;
};
export type TransferInput = {
  sourceWarehouseId: string; destinationWarehouseId: string; transferMode?: TransferMode; transferDate?: string; expectedArrivalDate?: string | null; reasonCode?: string | null;
  reference?: string | null; carrier?: string | null; vehicleNumber?: string | null; transportReference?: string | null; notes?: string | null; lines: LineInput[];
  expectedVersion?: number; idempotencyKey?: string;
};
export type ReceiptLineInput = { lineId: string; quantity?: string; batches?: Array<{ batchId: string; quantity: string }>; serialIds?: string[]; destinationLocationId?: string | null };

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
export const TRANSFERS_API = "/api/inventory/transfers";
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`${TRANSFERS_API}${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  }).then(parse<T>);
}
export const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};
const detailOf = (result: { detail: TransferDetail }) => result.detail;

export const listTransfers = (filters: Record<string, string | undefined>) => call<{ total: number; rows: TransferHeader[]; canCreate: boolean; canExport: boolean }>(query(filters));
export const getTransferOptions = () => call<{ options: TransferOptions }>("/options").then((result) => result.options);
export const getAvailability = (warehouseId: string, itemId: string) => call<{ availability: Availability }>(`/availability${query({ warehouseId, itemId })}`).then((result) => result.availability);
export const getTransfer = (id: string) => call<{ detail: TransferDetail }>(`/${id}`).then(detailOf);
export const createTransfer = (input: TransferInput) => call<{ detail: TransferDetail }>("", { method: "POST", json: input }).then(detailOf);
export const updateTransfer = (id: string, input: Partial<TransferInput>) => call<{ detail: TransferDetail }>(`/${id}`, { method: "PATCH", json: input }).then(detailOf);
export const validateTransfer = (id: string) => call<{ validation: { ready: boolean; errors: Array<{ message: string; code: string }> } }>(`/${id}/validate`).then((result) => result.validation);
const act = (id: string, action: string, json: unknown = {}) => call<{ detail: TransferDetail }>(`/${id}/${action}`, { method: "POST", json }).then(detailOf);
export const confirmTransfer = (id: string) => act(id, "confirm");
export const returnToDraft = (id: string) => act(id, "draft");
export const cancelTransfer = (id: string, reason: string) => act(id, "cancel", { reason });
export const dispatchTransfer = (id: string) => act(id, "dispatch");
export const completeTransfer = (id: string) => act(id, "complete");
export const receiveTransfer = (id: string, input: { lines?: ReceiptLineInput[]; idempotencyKey: string }) => act(id, "receive", input);
export const writeOffTransit = (id: string, input: { reason: string; lines?: ReceiptLineInput[]; idempotencyKey: string }) => act(id, "write-off", input);
export const reverseTransfer = (id: string, reason: string) => act(id, "reverse", { reason });
export const exportUrl = (filters: Record<string, string | undefined>) => `${TRANSFERS_API}/export${query(filters)}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const errorsOf = (error: unknown): Array<{ message: string; code: string }> =>
  error instanceof SalesApiError && Array.isArray((error.payload as { errors?: unknown })?.errors) ? (error.payload as { errors: Array<{ message: string; code: string }> }).errors : [];
export const DISPOSITION_LABEL: Record<string, string> = { available: "Available", quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged", expired: "Expired / blocked", restricted: "Restricted" };
export const STATUS_LABEL: Record<TransferStatus, string> = {
  draft: "Draft", confirmed: "Confirmed", dispatched: "In transit", partially_received: "Partly received", completed: "Completed", cancelled: "Cancelled", reversed: "Reversed",
};
export const STATUS_TONE: Record<TransferStatus, "info" | "success" | "warning" | "neutral"> = {
  draft: "neutral", confirmed: "info", dispatched: "warning", partially_received: "warning", completed: "success", cancelled: "neutral", reversed: "neutral",
};
export const TRANSFERS_BASE = "/inventory/transfers";
