"use client";

import type { PosCart, PosPayment } from "@vercentlabs/api";

import { request, post, del } from "@/features/pos/shared/http";
import type { PosReturn } from "@/features/pos/returns/api/returns-api";

export const createPosCart = (input: Record<string, unknown>) => post<{ cart: PosCart }>("/carts", input);
export const getPosCart = (id: string) => request<{ cart: PosCart }>(`/carts/${id}`);
export const addPosCartLine = (id: string, input: Record<string, unknown>) => post<{ cart: PosCart }>(`/carts/${id}/lines`, input);
export const updatePosCartLineQuantity = (id: string, lineId: string, quantity: number, expectedVersion?: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ quantity, expectedVersion }) });
export const removePosCartLine = (id: string, lineId: string, expectedVersion?: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`);
export const applyPosLineDiscount = (id: string, lineId: string, input: Record<string, unknown>) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/discount`, input);
// F295 -- set/change the batch or serial number on a cart line.
export const setPosCartLineTracking = (id: string, lineId: string, input: { batchId?: string | null; serialId?: string | null; expectedVersion?: number }) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/tracking`, input);
export const removePosLineDiscount = (id: string, lineId: string, expectedVersion?: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/discount${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`);
export const setPosCartDiscount = (id: string, input: Record<string, unknown>) => post<{ cart: PosCart }>(`/carts/${id}/discount`, input);
export const setPosCartCustomer = (id: string, customerId: string | null, expectedVersion?: number) =>
  post<{ cart: PosCart }>(`/carts/${id}/customer`, { customerId, expectedVersion });
export const applyPosCoupon = (id: string, code: string, expectedVersion?: number) =>
  post<{ cart: PosCart }>(`/carts/${id}/coupon`, { code, expectedVersion });
export const removePosCoupon = (id: string, expectedVersion?: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/coupon${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`);
export const holdPosCart = (id: string, expectedVersion?: number) => post<{ cart: PosCart }>(`/carts/${id}/hold`, { expectedVersion });
export const resumePosCart = (id: string) => post<{ cart: PosCart }>(`/carts/${id}/resume`, {});
export type PosHeldCart = {
  id: string;
  store_id: string;
  terminal_id: string;
  customer_id: string | null;
  customer_name: string | null;
  grand_total: string;
  held_at: string;
  version: number;
  store_name: string;
  terminal_name: string;
  line_count: number;
};
export const listHeldPosCarts = (search?: string) => request<{ rows: PosHeldCart[] }>(`/carts/held${search ? `?q=${encodeURIComponent(search)}` : ""}`);
export const cancelPosCart = (id: string, reason?: string) => post<{ cart: PosCart }>(`/carts/${id}/cancel`, { reason });
export const completePosCart = (id: string, input: Record<string, unknown>) => post<{ sale: Record<string, unknown> }>(`/carts/${id}/complete`, input);

export type PosProductMatch = {
  itemId: string;
  variantId: string | null;
  name: string;
  code: string;
  barcode: string | null;
  salesPrice: string;
  // F295 -- "none" | "batch" | "serial" (tenant.items.tracking_type). Lets
  // the checkout UI require a serial/batch before completing a sale of a
  // tracked item, instead of only discovering the requirement from the
  // server's hard rejection at checkout.
  trackingType?: "none" | "batch" | "serial";
  availableQuantity: number;
};
export const searchPosProducts = (storeId: string, query: string) =>
  request<{ rows: PosProductMatch[] }>(`/stores/${storeId}/products?q=${encodeURIComponent(query)}`);
export const lookupPosBarcode = (storeId: string, code: string) =>
  request<PosProductMatch>(`/stores/${storeId}/barcode/${encodeURIComponent(code)}`);

// F276: bounded customer search against tenant.business_parties -- see
// services/api/src/modules/point-of-sale/assortment-pricing-customer-and-cart/customers.js.
export type PosCustomerMatch = { id: string; code: string; displayName: string; phone: string | null; email: string | null };
export const searchPosCustomers = (query: string, options: { signal?: AbortSignal } = {}) =>
  request<{ rows: PosCustomerMatch[] }>(`/customers?q=${encodeURIComponent(query)}`, { signal: options.signal });

// F293 -- exchange as linked lineage (see services/api/src/modules/point-of-sale/
// returns-refunds-and-exchanges/exchange.js's completePosExchange). Rung up
// from checkout (arriving via /pos/checkout?exchangeReturnId=), not from
// the returns screen itself, so it lives here rather than in returns-api.ts.
export const completePosExchange = (
  returnId: string,
  input: { cartId: string; idempotencyKey: string; payments: { method: "cash"; amount: number }[]; expectedVersion?: number; expectedGrandTotal?: string },
) => post<{ return: PosReturn; sale: Record<string, unknown> }>(`/returns/${returnId}/exchange`, input);

// F283/F284/F285/F286 payment tender subsystem.
export type PosPaymentLeg =
  | { method: "cash"; amount: number }
  | { method: "card" | "upi" | "wallet" | "bank_transfer"; paymentId: string };
export const initiatePosPayment = (input: { cartId: string; method: "card" | "upi" | "wallet" | "bank_transfer"; amount: number; idempotencyKey: string; outcome?: string }) =>
  post<{ payment: PosPayment }>("/payments/initiate", input);
export const getPosPayment = (id: string) => request<{ payment: PosPayment }>(`/payments/${id}`);
export const refundPosPayment = (id: string, input: { amount: number; idempotencyKey: string; outcome?: string }) =>
  post<{ payment: PosPayment }>(`/payments/${id}/refund`, input);
export const requestPosPaymentOverride = (id: string, reason: string) =>
  post<{ paymentId: string; approvalRequest: { id: string; status: string; version: number } }>(`/payments/${id}/override`, { reason });
