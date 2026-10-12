"use client";

// POS Real-Time Inventory (0102): availability read from Inventory at the outlet's warehouse — a bill's items, one item in detail — and the
// live stream that says which items changed. Every figure is information; checkout reserves atomically.
import { request } from "@/features/pos/shared/http";

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "NOT_TRACKED" | "UNKNOWN";
export type Scope = { storeId: string; storeName: string; warehouseId: string; warehouseCode: string; warehouseName: string; terminalId: string | null; detailed: boolean };
export type ItemAvailability = { itemId: string; sku: string; name: string; warehouseId: string; trackingType: string; baseUom: string | null; stocked: boolean;
  availableQuantity: string | null; stockStatus: StockStatus; statusLabel: string; lowStockThreshold: string | null; onHandQuantity?: string; reservedQuantity?: string;
  nonSellableQuantity?: string; inventoryVersion: number; lastUpdatedAt: string | null };
export type ItemStock = Scope & ItemAvailability & { batches: Array<{ id: string; batchNumber: string; expiresOn: string | null; availableQuantity: string }>;
  serials: Array<{ id: string; serialNumber: string }>; checkedAt: string };
export type CartAvailabilityLine = { lineId: string; lineNumber: number; itemId: string; description: string; quantity: string; uom: string | null; baseQuantity: string; itemNeeded: string;
  availableQuantity: string | null; reservedForThisBill: string; stockStatus: StockStatus; statusLabel: string; inventoryVersion: number; warning: { code: string; message: string } | null };
export type CartAvailability = Scope & { cartId: string; inCheckout: boolean; ok: boolean; checkedAt: string; lines: CartAvailabilityLine[] };
export type AvailabilityChange = { eventId: string; sequence: number; eventType: string; warehouseId: string; itemId: string; inventoryVersion: number; reason: string; occurredAt: string };

export const STATUS_TONE: Record<StockStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  IN_STOCK: "success", LOW_STOCK: "warning", OUT_OF_STOCK: "danger", NOT_TRACKED: "neutral", UNKNOWN: "neutral",
};

export const cartAvailability = (cartId: string) => request<{ availability: CartAvailability }>(`/carts/${cartId}/availability`).then((result) => result.availability);
export const itemStock = (itemId: string, target: { cartId?: string | null; terminalId?: string | null }) => {
  const params = new URLSearchParams();
  if (target.cartId) params.set("cartId", target.cartId);
  else if (target.terminalId) params.set("terminalId", target.terminalId);
  return request<{ availability: ItemStock }>(`/items/${itemId}/availability?${params}`).then((result) => result.availability);
};
export const streamUrl = (terminalId: string | null, after: number | null) => {
  const params = new URLSearchParams();
  if (terminalId) params.set("terminalId", terminalId);
  if (after !== null) params.set("after", String(after));
  return `/api/pos/inventory/stream?${params}`;
};
