"use client";

// Browser client for Inventory Movement History under /api/inventory/movements: the Stock Ledger made readable — item movements (one row
// per ledger leg) and transaction events (one row per posting). Read, filtered, drilled into and exported; never edited.
import { SalesApiError } from "@/features/sales/shared/http";

export type Flag = "reversed" | "reversal" | "backdated" | "valuation_missing" | "negative_stock_override" | "tracking_exception";
export type Source = { type: string; label: string; id: string; number: string | null; lineId?: string | null; href: string | null };
export type MovementRow = {
  id: string; number: string; sequence: number; groupId: string; type: string; typeLabel: string; category: string; direction: "in" | "out" | "internal"; flow: "in" | "out";
  effectiveAt: string; postedAt: string; postedBy: string | null; backdated: boolean; source: Source;
  itemId: string; sku: string; itemName: string; trackingType: string; atPosting: { sku: string; itemName: string } | null;
  warehouseId: string; warehouse: string; warehouseName: string; locationId: string | null; location: string; disposition: string; dispositionLabel: string;
  from: string; to: string; batchId: string | null; batch: string | null; serialId: string | null; serial: string | null;
  quantity: number; baseUom: string | null; entered: { quantity: number; uom: string | null; conversion: number } | null; balanceAfter: number | null;
  reversesId: string | null; reversedById: string | null; reversedByGroupId: string | null; reason: string | null; flags: Flag[];
  unitCost?: number | null; value?: number | null; positionAfter?: number; warehouseAfter?: number;
};
export type SerialIdentity = {
  id: string; serialNumber: string; itemId: string; sku: string; itemName: string; status: string; inStock: boolean; warehouse: string | null; location: string | null;
  disposition: string | null; batch: string | null; reservation: string | null;
};
export type ItemHistory = {
  rows: MovementRow[]; scope: { label: string } | null; balanceShown: boolean; exact: "serial" | "batch" | null; serial: SerialIdentity | null;
  summary: { movements: number; items: number; comparable: boolean; uom: string | null; inbound: number | null; outbound: number | null; internal: number | null };
  nextCursor: string | null; canSeeCost: boolean; canExport: boolean; canReconcile: boolean;
};
export type EventRow = {
  id: string; label: string; category: string; operation: string; direction: "in" | "out" | "internal" | "mixed"; effectiveAt: string; postedAt: string; postedBy: string | null;
  backdated: boolean; reason: string | null; source: Source; items: number; legs: number; item: { sku: string; name: string } | null; uom: string | null;
  quantityIn: number | null; quantityOut: number | null; quantity: number | null; from: string; to: string; reversalOfGroupId: string | null; reversedByGroupId: string | null;
  flags: Flag[]; value?: number | null;
};
export type EventHistory = { rows: EventRow[]; nextCursor: string | null; exact: "serial" | "batch" | null; canSeeCost: boolean; canExport: boolean };
export type Transfer = {
  id: string; number: string; status: string; mode: string; from: string; to: string; requested: number; dispatched: number; received: number; lost: number; inTransit: number;
  events: EventRow[]; href: string;
};
export type EventDetail = {
  event: EventRow | null; legs: MovementRow[]; hiddenLegs: number;
  origin: { chain: Array<{ label: string; number: string | null; href: string }>; party?: string | null; reference?: string | null; reason?: string | null } | null;
  related: EventRow[]; reversalOf: EventRow | null; reversedBy: EventRow | null; transfer: Transfer | null;
  reservations: Array<{ id: string; number: string; quantity: number; at: string; href: string }>;
  finance: {
    value: number | null; valuationStatus: "valued" | "exception"; journalExpected: boolean; financeStatus: "posted" | "not_posted" | "not_applicable"; valuationHref: string;
    entries: Array<{ movementId: string; value: number; unitCost: number; costSource: string; method: string; inventoryValueAfter: number | null }> | null;
    journals: Array<{ id: string; number: string; date: string; status: string; sourceType: string; href: string }> | null;
  } | null;
  links: { source: string | null; stockLedger: string; reconciliation: string };
};
export type AsOf = { itemId: string; at: string; onHand: number; available: number; qualityHold: number; quarantined: number; damaged: number };
export type Options = {
  views: Array<{ id: string; label: string }>; categories: Array<{ id: string; label: string }>; movementTypes: Array<{ id: string; label: string; category: string }>;
  dispositions: Array<{ id: string; label: string }>; sourceTypes: Array<{ id: string; label: string }>;
  warehouses: Array<{ id: string; code: string; name: string; system: boolean; locations: Array<{ id: string; code: string; name: string }> }>;
  itemCategories: Array<{ id: string; name: string }>; postedBy: Array<{ id: string; name: string }>; canSeeCost: boolean; canExport: boolean; canReconcile: boolean;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload;
}
export const MOVEMENTS_BASE = "/inventory/movements";
const BASE = "/api/inventory/movements";
const call = <T,>(path: string) => fetch(`${BASE}${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } }).then(parse<T>);
export const queryOf = (params: Record<string, string | undefined>) => {
  const text = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  return text ? `?${text}` : "";
};

export const getItemMovements = (filters: Record<string, string | undefined>) => call<{ history: ItemHistory }>(queryOf({ ...filters, mode: "items" })).then((result) => result.history);
export const getEvents = (filters: Record<string, string | undefined>) => call<{ history: EventHistory }>(queryOf({ ...filters, mode: "events" })).then((result) => result.history);
export const getOptions = () => call<{ options: Options }>("/options").then((result) => result.options);
export const getEvent = (id: string) => call<{ detail: EventDetail }>(`/events/${id}`).then((result) => result.detail);
export const getAsOf = (params: Record<string, string | undefined>) => call<{ asOf: AsOf }>(`/as-of${queryOf(params)}`).then((result) => result.asOf);
export const exportUrl = (filters: Record<string, string | undefined>, format: "csv" | "xlsx") => `${BASE}/export${queryOf({ ...filters, cursor: undefined, limit: undefined, format })}`;
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);

export const FLAG_LABEL: Record<Flag, string> = {
  reversed: "Reversed", reversal: "Reversal", backdated: "Backdated", valuation_missing: "Valuation missing", negative_stock_override: "Negative stock override",
  tracking_exception: "Tracking exception",
};
