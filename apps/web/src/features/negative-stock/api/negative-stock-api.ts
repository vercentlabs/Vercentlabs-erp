"use client";

// Browser client for Negative-Stock Control under /api/inventory/negative-stock: the company policy (Block, or Allow with authorised override),
// the item-level block, the negative-stock report (open and resolved negative positions and the override behind each), its export, the in-app
// badge, the audit trail and reconciliation. A negative position is resolved only by a real inbound stock transaction, never edited here.
import { SalesApiError } from "@/features/sales/shared/http";

export type NegativePolicy = "block" | "allow_with_override";
export type OverrideReason = { id: string; label: string };
export type NegativeCapabilities = { viewWarnings: boolean; viewExceptions: boolean; override: boolean; viewAudit: boolean; configure: boolean; itemBlock: boolean; export: boolean };
export type NegativeSettings = {
  policy: NegativePolicy; alertsEnabled: boolean; blockedItems: number; policies: Array<{ id: NegativePolicy; label: string }>; overrideReasons: OverrideReason[];
  capabilities: NegativeCapabilities;
};
export type NegativeRow = {
  id: string; status: "open" | "resolved"; origin: "override" | "reconciliation"; itemId: string; sku: string; itemName: string; category: string | null; baseUom: string | null;
  warehouseId: string; warehouse: string; warehouseName: string; locationId: string | null; location: string; batch: string | null; onHand: number; lowest: number;
  negativeSince: string; ageDays: number; cause: string | null; lastMovement: string | null; lastMovementAt: string | null;
  source: { type: string; id: string; number: string; href: string | null } | null; reasonCode: string | null; reason: string | null; notes: string | null;
  overriddenBy: string | null; overriddenAt: string | null; override: { before: number; movement: number; after: number } | null; resolvedAt: string | null;
  resolvedBy: { movement: string; number: string; href: string | null } | null; itemStockHref: string; ledgerHref: string;
};
export type NegativeList = { status: string; total: number; limit: number; offset: number; rows: NegativeRow[]; capabilities: NegativeCapabilities; reasons: OverrideReason[] };
export type AuditRow = {
  id: string; type: string; label: string; at: string; by: string | null; itemId: string | null; sku: string | null; itemName: string | null; warehouse: string | null;
  location: string | null; exceptionId: string | null; movement: string | null; before: number | null; quantity: number | null; after: number | null; reasonCode: string | null;
  reason: string | null; notes: string | null; permission: string | null; details: Record<string, unknown>;
};
export type ReconcileReport = {
  consistent: boolean; repaired: number; unrecorded: Array<{ itemId: string; sku: string; warehouse: string; onHand: number }>;
  stale: Array<{ exceptionId: string; itemId: string; sku: string; warehouse: string; onHand: number }>;
};
export type NegativeOverride = { reasonCode: string; notes: string };
// What a refused stock movement says about the position (error.details.negativeStock).
export type NegativeFacts = {
  sku: string | null; uom: string; warehouse: string | null; location: string; batch: string | null; onHand: number; reserved: number; available: number; requested: number;
  shortfall: number; projected: number; firstNegativeOn?: string; lowestHistorical?: number; canOverride?: boolean;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
const BASE = "/api/inventory/negative-stock";
function call<T>(path: string, init?: { method?: string; json?: unknown }) {
  return fetch(`${BASE}${path}`, {
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

export const getNegativeSettings = () => call<{ settings: NegativeSettings }>("/settings").then((result) => result.settings);
export const updateNegativeSettings = (input: { policy?: NegativePolicy; alertsEnabled?: boolean; reason?: string | null }) =>
  call<{ settings: NegativeSettings }>("/settings", { method: "PATCH", json: input }).then((result) => result.settings);
export const setItemNegativeBlock = (itemId: string, alwaysBlock: boolean, reason?: string) =>
  call<{ item: { itemId: string; alwaysBlock: boolean } }>(`/items/${itemId}`, { method: "PATCH", json: { alwaysBlock, reason: reason || null } }).then((result) => result.item);
export const listNegativeStock = (filters: Record<string, string | undefined>) => call<NegativeList>(query(filters));
export const getNegativeSummary = () => call<{ summary: { open: number | null; oldest: string | null; alertsEnabled: boolean } }>("/summary").then((result) => result.summary);
export const listNegativeAudit = (filters: Record<string, string | undefined>) => call<{ rows: AuditRow[]; eventTypes: Array<{ id: string; label: string }> }>(`/audit${query(filters)}`);
export const checkNegativeReconciliation = () => call<{ report: ReconcileReport }>("/reconcile").then((result) => result.report);
export const repairNegativeReconciliation = () => call<{ report: ReconcileReport }>("/reconcile", { method: "POST", json: {} }).then((result) => result.report);
export const negativeExportUrl = (filters: Record<string, string | undefined>, format: "csv" | "xlsx") => `${BASE}/export${query({ ...filters, format })}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export const negativeFactsOf = (error: unknown): NegativeFacts | null =>
  error instanceof SalesApiError ? ((error.payload as { negativeStock?: NegativeFacts })?.negativeStock ?? null) : null;
export const NEGATIVE_STOCK_BASE = "/inventory/negative-stock";
