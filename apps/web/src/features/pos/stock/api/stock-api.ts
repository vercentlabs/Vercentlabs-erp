"use client";

// POS Stock Reduction (0101): the checkout's stock reservation, a sale's Inventory movements and the stock reduction report. Stock itself is
// only ever moved by the server when a sale completes.
import { request } from "@/features/pos/shared/http";

export type StockAllocation = { id: string; number: string; status: string; quantity: number; active: number; consumed: number; location: string; batch: string | null;
  batchExpiresOn: string | null; serial: string | null; expiresAt: string | null; renewals: number };
export type CheckoutStockLine = { lineId: string; lineNumber: number; itemId: string; sku: string | null; description: string; quantity: number; uom: string | null; baseQuantity: number;
  baseUom: string | null; stocked: boolean; status: string; availableNow: number | null; availableBeforeReservation: number | null; reserved: number; consumed: number;
  allocations: StockAllocation[] };
export type CheckoutStock = { cartId: string; checkoutReference: string | null; checkoutStarted: boolean; status: string;
  warehouse: { id: string; code: string; name: string; store: string } | null; warehouseError: { code: string; message: string } | null; expiresAt: string | null;
  saleId: string | null; movementsPosted: number; recovery: { status: string; code: string | null; message: string | null; at: string | null; resolvedAt: string | null } | null;
  lines: CheckoutStockLine[] };
export type SaleStockMovement = { id: string; number: string; saleLineId: string | null; lineNumber: number | null; description: string; sku: string; quantity: number;
  baseUom: string | null; warehouse: string; location: string; batch: string | null; serial: string | null; reservation: string | null; unitCost: number; value: number;
  valuationReferenceId: string | null; ledgerType: string; postedAt: string };
export type SaleStock = { saleId: string; receiptNumber: string; invoiceNumber: string | null; status: string; inventoryReconciliationStatus: string; movementsPosted: number;
  costConsumed: number; movements: SaleStockMovement[];
  reconciliation: Array<{ lineId: string; lineNumber: number; description: string; quantity: number; uom: string | null; conversionFactor: number; expectedBaseQuantity: number;
    issuedBaseQuantity: number; stocked: boolean; status: string }> };
export type StockSummary = { from: string; to: string;
  totals: { soldQuantity: number; issuedQuantity: number; costConsumed: number; discrepancies: number; recoveryRequired: number; activeHolds: number; overdueHolds: number;
    expiredHolds: number; consumedHolds: number; releasedHolds: number };
  byItem: Array<{ sku: string; name: string; baseUom: string | null; quantity: number; cost: number }>;
  byOutlet: Array<{ outlet: string; warehouse: string; sales: number; quantity: number; cost: number }>;
  byBatch: Array<{ sku: string; batch: string; expiresOn: string | null; quantity: number }>;
  serialsSold: Array<{ sku: string; serial: string; receiptNumber: string; soldAt: string }>;
  discrepancies: Array<{ saleId: string; receiptNumber: string; lineNumber: number; description: string; expected: number; issued: number }>;
  recovery: Array<{ cartId: string; cartReference: string; code: string | null; message: string | null; at: string; outlet: string }> };

export const STOCK_STATUS_LABEL: Record<string, string> = {
  RESERVED: "Reserved", PARTLY_RESERVED: "Partly reserved", EXPIRED: "Reservation expired", RELEASED: "Released", CONSUMED: "Stock posted", PARTLY_CONSUMED: "Partly posted",
  NOT_RESERVED: "Not reserved yet", NOT_REQUIRED: "No stock needed", NOT_STOCKED: "Not stocked", RECOVERY_REQUIRED: "Needs stock recovery",
};
export const STOCK_STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  RESERVED: "success", PARTLY_RESERVED: "warning", EXPIRED: "warning", RELEASED: "neutral", CONSUMED: "success", PARTLY_CONSUMED: "warning", NOT_RESERVED: "neutral",
  NOT_REQUIRED: "neutral", NOT_STOCKED: "neutral", RECOVERY_REQUIRED: "danger",
};

export const checkoutStock = (cartId: string) => request<{ stock: CheckoutStock }>(`/carts/${cartId}/stock-status`).then((result) => result.stock);
export const renewCheckoutStock = (cartId: string) =>
  request<{ renewal: { renewed: number; expiresAt: string | null; capped?: boolean } }>(`/carts/${cartId}/stock/renew`, { method: "POST", body: JSON.stringify({}) })
    .then((result) => result.renewal);
export const saleStockMovements = (saleId: string) => request<{ stock: SaleStock }>(`/sales/${saleId}/stock-movements`).then((result) => result.stock);
export const stockSummary = () => request<{ summary: StockSummary }>("/reports/stock").then((result) => result.summary);
