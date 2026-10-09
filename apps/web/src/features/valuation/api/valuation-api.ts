"use client";

// Browser client for Inventory Valuation under /api/inventory/valuation: what stock is worth (by warehouse and item, the company total, as of a
// date), the FIFO layers left, every value movement and its drill-down, reconciliation with the stock ledger and the General Ledger, the
// projection rebuild and exports. Nothing here sets a cost or a value: those come only from stock movements.
import { SalesApiError } from "@/features/sales/shared/http";

export type ValuationMethod = "moving_average" | "fifo";
export type ValuationCapabilities = { view: boolean; rate: boolean; layers: boolean; movements: boolean; costSource: boolean; exchangeRate: boolean; reconcileView: boolean;
  reconcileRun: boolean; rebuild: boolean; finance: boolean; export: boolean };
export type ValuationRow = {
  key: string; itemId: string | null; sku: string | null; itemName: string | null; baseUom: string | null; method: ValuationMethod | null; methodLabel: string | null;
  warehouseId: string | null; warehouse: string | null; warehouseName: string | null; items?: number; onHand: number | null; value: number; rate?: number | null;
  rateKind?: "carrying" | "moving_average"; negative: boolean;
};
export type ValuationReport = { view: string; asOf: string | null; total: number; totals: { quantity: number | null; value: number }; rows: ValuationRow[];
  capabilities: ValuationCapabilities; methods: Array<{ id: ValuationMethod; label: string }> };
export type Layer = { id: string; label: string; itemId: string; sku: string; itemName: string; warehouse: string; source: { number: string; href: string | null } | null; movement: string | null;
  transferredFrom: string | null; date: string; originalQuantity: number; remainingQuantity: number; unitCost: number; originalValue: number; remainingValue: number; status: "open" | "exhausted" };
export type ValueMovement = {
  id: string; kind: "movement" | "settlement" | "restatement"; type: string; date: string; postedAt: string; itemId: string; sku: string; itemName: string; warehouseId: string;
  warehouse: string; movementId: string | null; movement: string | null; method: ValuationMethod; methodLabel: string; source: { number: string; href: string | null } | null;
  quantity: number; rate?: number; value: number; balanceQuantity: number | null; balanceValue: number | null; costSource?: string; costSourceLabel?: string; sequence: number;
};
export type EntryDetail = {
  entry: ValueMovement; movement: { id: string; number: string; href: string } | null;
  exchange?: { sourceCurrency: string; sourceUnitCost: number; rate: number; baseCurrency: string };
  allocations: Array<{ layerId: string; quantity: number; value: number; unitCost: number; layerDate: string; layerSource: { number: string; href: string | null } | null; restored: boolean }>;
  layersOpened: Array<{ id: string; quantity: number; value: number; unitCost: number; date: string }>;
  reversalOf: { id: string; movement: string | null } | null; reversedBy: Array<{ id: string; movement: string | null; value: number }>;
  restatements: Array<{ id: string; value: number; date: string }>; journals: Array<{ id: string; number: string; date: string; status: string; description: string; href: string }>;
  details: Record<string, unknown>;
};
export type FinanceAccount = { accountId: string | null; account: string; valuation: number; items: number; ledger: number | null; difference: number | null;
  status: "reconciled" | "rounding" | "not_reconciled" | "unmapped" };
export type FinanceReport = { ledger: string | null; accounts: FinanceAccount[]; valuation?: number; ledgerBalance?: number; difference?: number; status: string };
export type ValuationException = { code: string; label: string; sku?: string | null; warehouse?: string | null; movement?: string; account?: string; difference?: number | null;
  [key: string]: unknown };
export type ReconcileReport = { checkedAt: string; positions: number; consistent: boolean; companyValue: number; warehouses: Array<{ warehouseId: string; warehouse: string; value: number }>;
  exceptions: ValuationException[]; finance: FinanceReport | null };
export type ItemValuation = { item: { id: string; sku: string; name: string; baseUom: string | null; method: ValuationMethod; methodLabel: string; methodLocked: boolean };
  warehouses: ValuationRow[]; total: { quantity: number | null; value: number }; capabilities: ValuationCapabilities };
export type WarehouseValuation = { warehouseId: string; total: number; items: ValuationRow[]; movements: ValueMovement[]; capabilities: ValuationCapabilities };

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/valuation";
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

export const getValuation = (filters: Record<string, string | undefined>) => call<ValuationReport>(query(filters));
export const getItemValuation = (itemId: string) => call<{ valuation: ItemValuation }>(`/items/${itemId}`).then((result) => result.valuation);
export const getWarehouseValuation = (warehouseId: string) => call<{ valuation: WarehouseValuation }>(`/warehouses/${warehouseId}`).then((result) => result.valuation);
export const getLayers = (filters: Record<string, string | undefined>) => call<{ rows: Layer[] }>(`/layers${query(filters)}`).then((result) => result.rows);
export const getValueMovements = (filters: Record<string, string | undefined>) => call<{ rows: ValueMovement[] }>(`/movements${query(filters)}`).then((result) => result.rows);
export const getEntry = (id: string) => call<{ detail: EntryDetail }>(`/entries/${id}`).then((result) => result.detail);
export const checkValuation = () => call<{ report: ReconcileReport }>("/reconcile").then((result) => result.report);
export const runValuationReconciliation = () => call<{ report: ReconcileReport }>("/reconcile", { method: "POST", json: {} }).then((result) => result.report);
export const rebuildValuation = (reason: string) => call<{ result: { balanceCorrections: number; layerCorrections: number } }>("/rebuild", { method: "POST", json: { reason } }).then((result) => result.result);
export const getValuationEvents = () => call<{ events: Array<{ id: string; type: string; summary: string; at: string; by: string | null }> }>("/events").then((result) => result.events);
export const valuationExportUrl = (filters: Record<string, string | undefined>, format: "csv" | "xlsx") => `${BASE}/export${query({ ...filters, format })}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const VALUATION_BASE = "/inventory/valuation";
