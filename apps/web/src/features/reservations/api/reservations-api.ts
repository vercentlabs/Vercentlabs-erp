"use client";

// Browser client for Stock Reservations under /api/inventory/reservations. A reservation is one source document line's demand for an item; its
// allocations (RSV-…) are the stock held for it — warehouse, location, batch or serial. Reservations are created by their documents (sales orders,
// transfers, purchase returns, work orders); here they are read, explained, released, reallocated, reconciled and rebuilt, never typed in.
import { SalesApiError } from "@/features/sales/shared/http";

export type ReservationStatus = "active" | "consumed" | "released" | "cancelled" | "expired";
export type Reservation = {
  id: string; status: ReservationStatus; statusLabel: string; itemId: string; sku: string; itemName: string; baseUom: string | null; sourceType: string; sourceLabel: string;
  sourceId: string; sourceLineId: string | null; sourceLineNumber: number | null; document: string | null; sourceHref: string | null; requested: number; reserved: number; consumed: number;
  released: number; active: number; unreserved: number; warehouses: string[]; warehouseIds: string[]; allocationCount: number; batches?: string[]; serials?: string[];
  expiresAt: string | null; createdAt: string; createdByName: string | null; updatedAt: string; version: number;
};
export type Allocation = {
  id: string; number: string; reservationId: string | null; status: "active" | "consumed" | "released" | "cancelled"; itemId: string; sku: string; itemName: string; baseUom: string | null;
  source: string; sourceLabel: string; sourceId: string; document: string | null; documentId: string | null; warehouseId: string; warehouse: string; location: string | null;
  batch: string | null; serial: string | null; allocation: string; quantity: number; active: number; consumed: number; released: number; expiresAt: string | null;
  reservedBy: string | null; createdAt: string; releasedAt: string | null; releaseReason: string | null; eligible: boolean; ineligibleReason: string | null;
  history: Array<{ id: string; type: string; quantity: number; activeAfter: number; reasonCode: string | null; reason: string | null; actor: string | null; at: string }>;
  consumptions: Array<{ quantity: number; at: string; movement: string | null; delivery: string | null }>;
};
export type ReservationDetail = {
  reservation: Reservation; allocations: Allocation[]; history: Array<Allocation["history"][number] & { allocation: string }>;
  exceptions: Array<{ kind: string; message: string; allocationId: string; allocation: string }>;
  capabilities: { release: boolean; reallocate: boolean; reallocateWarehouse: boolean; viewAllocations: boolean };
};
export type Capabilities = { release: boolean; reallocate: boolean; reallocateWarehouse: boolean; exceptions: boolean; reconcile: boolean; rebuild: boolean; viewAllocations: boolean; viewSources: boolean };
export type ReservationException = { kind: string; message: string; reservation: Allocation };
export type ReconcileReport = {
  checkedAt: string; consistent: boolean; projection: Array<{ itemId: string; projection: number; reservations: number; difference: number }>;
  reservationTotals: Array<{ reservationId: string; recorded: number; allocations: number }>; unattachedAllocations: number; serialsHeldTwice: Array<{ serialId: string; holds: number }>;
  sourceIssues: Array<{ kind: string; message: string; allocation: string; reservationId: string | null }>;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/reservations";
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`${BASE}${path}`, {
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

export const listReservations = (filters: Record<string, string | undefined>) => call<{ total: number; rows: Reservation[]; totalActive: number; capabilities: Capabilities }>(query(filters));
export const getReservation = (id: string) => call<{ detail: ReservationDetail }>(`/${id}`).then((result) => result.detail);
export const getReservationExceptions = () =>
  call<{ exceptions: ReservationException[]; projectionMismatches: Array<{ itemId: string; projection: number; reservations: number; difference: number }>; count: number }>("/exceptions");
export const releaseReservation = (id: string, input: { quantity?: string | null; reason: string }) => call<{ detail: ReservationDetail }>(`/${id}/release`, { method: "POST", json: input });
export const releaseAllocation = (allocationId: string, input: { quantity?: string | null; reason: string }) =>
  call<{ allocation: unknown }>(`/allocations/${allocationId}/release`, { method: "POST", json: input });
export const reallocateAllocation = (allocationId: string, input: { warehouseId?: string | null; locationId?: string | null; batchId?: string | null; serialId?: string | null; reason: string }) =>
  call<{ result: { from: { id: string; number: string }; to: { id: string; reservation_number: string } } }>(`/allocations/${allocationId}/reallocate`, { method: "POST", json: input }).then((result) => result.result);
export const reconcileReservations = () => call<{ report: ReconcileReport }>("/reconcile").then((result) => result.report);
export const rebuildReservedStock = (reason: string) => call<{ result: { corrected: number; consistent: boolean } }>("/rebuild", { method: "POST", json: { reason } }).then((result) => result.result);
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const STATUS_TONE: Record<ReservationStatus, "success" | "neutral" | "info" | "warning"> = { active: "success", consumed: "info", released: "neutral", cancelled: "warning", expired: "neutral" };
export const EXCEPTION_LABEL: Record<string, string> = {
  ineligible: "Stock no longer eligible", warehouse_inactive: "Warehouse inactive", serial_missing: "Serial missing", source_closed: "Source closed", exceeds_demand: "More than needed",
  stock_short: "Less stock than reserved",
};
