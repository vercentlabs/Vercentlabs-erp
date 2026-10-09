"use client";

// Browser client for the Stock Ledger under /api/inventory/stock-ledger: the immutable history of every physical stock movement. Read,
// filtered, drilled into, exported and reconciled; never edited.
import { SalesApiError } from "@/features/sales/shared/http";

export type LedgerRow = {
  id: string; number: string; sequence: number; type: string; typeLabel: string; effectiveAt: string; postedAt: string; postedBy: string | null;
  source: { type: string; label: string; id: string; number: string | null; lineId: string | null; href: string | null };
  itemId: string; sku: string; itemName: string; trackingType: string; warehouseId: string; warehouse: string; warehouseName: string; locationId: string | null; location: string;
  batchId: string | null; batch: string | null; serialId: string | null; serial: string | null; disposition: string; dispositionLabel: string;
  quantity: number; quantityIn: number | null; quantityOut: number | null; balance: number | null; baseUom: string | null;
  entered: { quantity: number; uom: string | null; conversion: number } | null; reversesId: string | null; reversedById: string | null; groupId: string; reason: string | null;
  unitCost?: number; value?: number;
};
export type LedgerScope = { itemId: string; warehouseId: string | null; locationId: string | null; batchId: string | null; serialId: string | null; disposition: string | null; label: string };
export type LedgerResult = {
  rows: LedgerRow[]; scope: LedgerScope | null; openingBalance: number | null; closingBalance: number | null;
  totals: { quantityIn: number; quantityOut: number; movements: number }; nextCursor: string | null; canSeeCost: boolean; canExport: boolean; canReconcile: boolean; baseUom: string | null;
};
export type LedgerOptions = {
  movementTypes: Array<{ id: string; label: string; direction: "in" | "out" | "either" }>; dispositions: Array<{ id: string; label: string }>;
  warehouses: Array<{ id: string; code: string; name: string; system: boolean; locations: Array<{ id: string; code: string; name: string }> }>;
  categories: Array<{ id: string; name: string }>; canSeeCost: boolean; canExport: boolean; canReconcile: boolean; canRebuild: boolean;
};
export type MovementDetail = {
  movement: LedgerRow;
  group: { id: string; operation: string; postingKey: string; effectiveAt: string; postedAt: string; postedBy: string | null; reason: string | null; reversalOfGroupId: string | null; net: number };
  legs: LedgerRow[]; reverses: LedgerRow | null; reversedBy: LedgerRow | null;
  valuation: { entryId: string; value: number; unitCost: number; costSource: string; method: "moving_average" | "fifo"; href: string } | null;
  journals: Array<{ id: string; number: string; date: string; status: string; href: string }> | null;
  links: { source: string | null; item: string; itemStock: string; warehouse: string; serialHistory: string | null; batchLedger: string | null };
};
export type SerialHistory = {
  serial: { id: string; serialNumber: string; itemId: string; sku: string; itemName: string; status: string; inStock: boolean; warehouse: string | null; location: string | null };
  movements: LedgerRow[];
};
type Difference = { itemId: string; sku: string | null; itemName: string | null; warehouse: string | null; location: string | null; batch: string | null };
export type Reconciliation = {
  runId: string; runAt: string; consistent: boolean;
  positions: Array<Difference & { ledger: number; balance: number; difference: number }>;
  batches: Array<Difference & { quantityWithoutBatch: number }>;
  serials: Array<Difference & { onHand: number; serialsInStock: number }>;
  groups: Array<{ groupId: string; document: string | null; operation: string; net: number }>;
};
export type ReconciliationRun = { id: string; runAt: string; runBy: string | null; differences: number };

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/stock-ledger";
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET", credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : undefined,
  }).then(parse<T>);
}
export const ledgerQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const getStockLedger = (filters: Record<string, string | undefined>) => call<{ ledger: LedgerResult }>(ledgerQuery(filters)).then((result) => result.ledger);
export const getLedgerOptions = () => call<{ options: LedgerOptions }>("/options").then((result) => result.options);
export const getMovement = (id: string) => call<{ detail: MovementDetail }>(`/${id}`).then((result) => result.detail);
export const getSerialHistory = (serialId: string) => call<{ history: SerialHistory }>(`/serial${ledgerQuery({ serialId })}`).then((result) => result.history);
export const runReconciliation = (input: { itemId?: string; warehouseId?: string }) =>
  call<{ reconciliation: Reconciliation }>("/reconciliation", { method: "POST", json: input }).then((result) => result.reconciliation);
export const listReconciliations = () => call<{ runs: ReconciliationRun[] }>("/reconciliation").then((result) => result.runs);
export const ledgerExportUrl = (filters: Record<string, string | undefined>, format: "csv" | "xlsx") => `${BASE}/export${ledgerQuery({ ...filters, cursor: undefined, limit: undefined, format })}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
