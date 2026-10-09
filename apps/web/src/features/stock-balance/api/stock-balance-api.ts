"use client";

// Browser client for Real-Time Stock Balance under /api/inventory/stock-balance. Read only: stock changes through receipts, deliveries,
// transfers, adjustments and the other stock transactions, never here.
import { SalesApiError } from "@/features/sales/shared/http";

export type BalanceRow = {
  key: string; itemId: string; sku: string; itemName: string; trackingType: string; category: string | null; baseUom: string | null;
  warehouseId: string | null; warehouseCode: string | null; warehouseName: string | null; locationId: string | null; locationCode: string | null;
  batchId: string | null; batchNumber: string | null; expiresOn: string | null; batchStatus: string | null; onHand: number;
  // Negative-Stock Control: on hand is never clamped; negativeQuantity is how far below zero (the sum of the negative positions in the row).
  negativeQuantity: number; hasNegativeStock: boolean;
  reserved?: number; available?: number; restricted?: number; expired?: number; qualityHold?: number; quarantined?: number; damaged?: number; inTransit?: number | null; incoming?: number | null; version?: number; value?: number;
};
export type BalanceResult = {
  view: string; grain: "position" | "batch" | "warehouse" | "item"; asOf: string | null; asOfTime: string; showsValue: boolean; total: number; limit: number; offset: number;
  totals: { onHand: number; reserved?: number; available?: number; restricted?: number; inTransit?: number; incoming?: number; value?: number; negativePositions: number };
  rows: BalanceRow[];
};
export type BalanceOptions = {
  views: Array<{ id: string; label: string }>; warehouses: Array<{ id: string; code: string; name: string }>;
  locations: Array<{ id: string; code: string; name: string; warehouseId: string }>; categories: Array<{ id: string; name: string }>;
  capabilities: { viewValue: boolean; export: boolean; rebuild: boolean; transfer: boolean; adjust: boolean };
};
export type Source = { kind: string; id: string; reference: string; warehouse: string; quantity: number; expected?: string | null };
export type ItemStock = {
  item: { id: string; sku: string; name: string; trackingType: string; baseUom: string | null; tracked: boolean };
  summary: (BalanceRow & { outgoing: number; otherOutgoing: number }) | null;
  warehouses: BalanceRow[]; positions: BalanceRow[];
  // Open negative positions and what caused them (null without the negative-stock warnings permission).
  negative: null | { quantity: number; positions: number; exceptions: Array<{ id: string; warehouse: string; location: string; since: string; onHand: number; lowest: number;
    cause: string | null; reasonCode: string | null; notes: string | null; overriddenBy: string | null; origin: string; source: { type: string; id: string; number: string } | null }> };
  reservations: Array<{ id: string; number: string; source: string; document: string | null; quantity: number; warehouse: string; location: string; batch: string | null; since: string }>;
  incoming: Source[]; outgoing: Source[];
  batches: Array<{ id: string; batch: string; expiresOn: string | null; status: string; warehouse: string; onHand: number; reserved: number; available: number; expired: boolean }>;
  serials: Array<{ id: string; serial: string; warehouse: string; location: string; batch: string | null }>;
  movements: Array<{ id: string; number: string; type: string; source: string | null; sourceHref: string | null; reason: string | null; quantity: number; effectiveAt: string;
    postedAt: string; warehouse: string; location: string; batch: string | null; balance: number | null }>;
  integrity: { ledger: number; projection: number; reserved: number; reservations: number; serials: number | null; consistent: boolean };
};
export type Drift = { itemId: string; warehouseId: string | null; difference?: number; ledger?: number; projection?: number; reservations?: number; onHand?: number; serialsInStock?: number };
export type Reconciliation = {
  reconciliation: { checkedAt: string; checkedRows: number; consistent: boolean; quantity: Drift[]; reservations: Drift[]; serials: Drift[] };
  rebuilds: Array<{ id: string; reason: string; quantityCorrections: number; reservationCorrections: number; actorName: string | null; createdAt: string }>;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/stock-balance";
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

export const getStockBalance = (filters: Record<string, string | undefined>) => call<BalanceResult>(query(filters));
export const getBalanceOptions = () => call<BalanceOptions>("/options");
export const getItemStock = (itemId: string) => call<{ stock: ItemStock }>(`/items/${itemId}`).then((result) => result.stock);
export const getReconciliation = () => call<Reconciliation>("/reconciliation");
export const rebuildBalances = (reason: string) => call<{ rebuild: { quantityCorrections: number; reservationCorrections: number } }>("/reconciliation", { method: "POST", json: { reason } })
  .then((result) => result.rebuild);
export type AvailabilityWarehouse = {
  warehouseId: string; warehouseCode: string; warehouseName: string; onHand: number; restricted: number; eligibleOnHand: number; reserved: number; reservedOnRestricted: number;
  available: number; allocatableSerials: number | null;
  restrictions: Array<{ reason: string; label: string; quantity: number; positions: Array<{ location: string; batch: string | null; quantity: number }> }>;
  reservations: Array<{ number: string; source: string; document: string | null; quantity: number }>;
  positions: Array<{ location: string; batch: string | null; onHand: number; reserved: number; eligible: boolean; restriction: string | null }>;
};
export type AvailabilityBreakdown = {
  item: { id: string; sku: string; name: string; trackingType: string; baseUom: string | null };
  warehouses: AvailabilityWarehouse[];
  total: { onHand: number; restricted: number; eligibleOnHand: number; reserved: number; available: number };
};
export const getAvailability = (itemId: string, warehouseId?: string) =>
  call<{ availability: AvailabilityBreakdown }>(`/availability${query({ itemId, warehouseId })}`).then((result) => result.availability);
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
