"use client";

import type { PosCart, PosPayment } from "@vercentlabs/api";

import { request, post, del } from "@/features/pos/shared/http";

export const createPosCart = (input: Record<string, unknown>) =>
  post<{ cart: PosCart }>("/carts", input);
export const getPosCart = (id: string) =>
  request<{ cart: PosCart }>(`/carts/${id}`);
// Every change carries the version the cashier saw (a stale tab cannot overwrite a newer bill) and its own request key (a retry is applied
// once). The server answers with the whole bill as it now stands.
const actionKey = () => crypto.randomUUID();
export const updatePosCartLineQuantity = (id: string, lineId: string, quantity: number, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ quantity, expectedVersion, idempotencyKey: actionKey() }) });
export const removePosCartLine = (id: string, lineId: string, expectedVersion: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}?expectedVersion=${expectedVersion}&idempotencyKey=${actionKey()}`);
export const applyPosLineDiscount = (id: string, lineId: string, input: Record<string, unknown>) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/discount`, { idempotencyKey: actionKey(), ...input });
// The batch or serial number of a tracked cart line, as scanned or typed; Inventory checks it before it is recorded.
export const setPosCartLineTracking = (id: string, lineId: string, input: { serialNumber?: string | null; batchNumber?: string | null; expectedVersion?: number }) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/tracking`, input);
export const removePosLineDiscount = (id: string, lineId: string, expectedVersion?: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/discount${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`);
// An authorized price for one line (null: back to the list price).
export const overridePosLinePrice = (id: string, lineId: string, input: { unitPrice: string | null; reason?: string; approvalId?: string; expectedVersion: number }) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/price`, { idempotencyKey: actionKey(), ...input });
export const setPosCartDiscount = (id: string, input: Record<string, unknown>) => post<{ cart: PosCart }>(`/carts/${id}/discount`, { idempotencyKey: actionKey(), ...input });
export const setPosCartCustomer = (id: string, customerId: string | null, expectedVersion: number) =>
  post<{ cart: PosCart }>(`/carts/${id}/customer`, { customerId, expectedVersion, idempotencyKey: actionKey() });
export const setPosCartNotes = (id: string, notes: string | null, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/notes`, { method: "PUT", body: JSON.stringify({ notes, expectedVersion, idempotencyKey: actionKey() }) });
export const holdPosCart = (id: string, expectedVersion: number, note?: string | null) =>
  post<{ cart: PosCart }>(`/carts/${id}/hold`, { expectedVersion, note: note || null, idempotencyKey: actionKey() });
export const resumePosCart = (id: string) => post<{ cart: PosCart }>(`/carts/${id}/resume`, { idempotencyKey: actionKey() });
export type PosHeldCart = {
  id: string; cart_reference: string | null; store_id: string; terminal_id: string; customer_id: string | null; customer_name: string | null; grand_total: string;
  currency_code: string; held_at: string; created_at: string; version: number; store_name: string; terminal_name: string; line_count: number; hold_note: string | null;
  cashier_name: string | null; own: boolean;
};
export const listHeldPosCarts = (filters: { search?: string; scope?: "mine" | "all"; from?: string; to?: string } = {}) => {
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const text = params.toString();
  return request<{ rows: PosHeldCart[] }>(`/carts/held${text ? `?${text}` : ""}`);
};
export const cancelPosCart = (id: string, reason?: string) => post<{ cart: PosCart }>(`/carts/${id}/cancel`, { reason, idempotencyKey: actionKey() });
export const completePosCart = (id: string, input: Record<string, unknown>) => post<{ sale: Record<string, unknown> }>(`/carts/${id}/complete`, input);
export type PosCartIssue = { code: string; message: string; lineId?: string; itemId?: string };
export type PosCheckoutResult = { ready: boolean; issues: PosCartIssue[]; cart: PosCart; snapshot?: Record<string, unknown>; message?: string };
export const validatePosCheckout = (id: string) => request<{ ready: boolean; issues: PosCartIssue[]; version: number }>(`/carts/${id}/checkout`);
export const beginPosCheckout = (id: string, expectedVersion: number) =>
  post<PosCheckoutResult>(`/carts/${id}/checkout`, { action: "begin", expectedVersion, idempotencyKey: actionKey() });
export const releasePosCheckout = (id: string, reason?: string) => post<PosCheckoutResult>(`/carts/${id}/checkout`, { action: "release", reason });
export type PosCartHistoryEntry = { id: string; eventType: string; summary: string; version: number | null; at: string; actor: string | null; terminal: string | null };
export const getPosCartHistory = (id: string) => request<{ events: PosCartHistoryEntry[] }>(`/carts/${id}/history`).then((response) => response.events);
export const quickCreatePosCustomer = (input: { name: string; phone?: string | null; gstin?: string | null; cartId?: string | null }) =>
  post<{ customer: { id: string; code: string | null; displayName: string; phone: string | null; email: string | null } }>("/customers", input).then((response) => response.customer);

// Walk-In Customer: the bill's customer context and its changes.
export type { PosCustomerContext, PosReceiptDelivery } from "@vercentlabs/api";
import type { PosCustomerContext, PosReceiptDelivery } from "@vercentlabs/api";
export const getPosCustomerContext = (id: string) => request<{ context: PosCustomerContext }>(`/carts/${id}/customer/context`).then((response) => response.context);
export const setPosWalkIn = (id: string, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/customer/walk-in`, { method: "PUT", body: JSON.stringify({ expectedVersion, idempotencyKey: actionKey() }) });
export const selectPosRegisteredCustomer = (id: string, customerId: string, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/customer/registered`, { method: "PUT", body: JSON.stringify({ customerId, expectedVersion, idempotencyKey: actionKey() }) });
export const updatePosBuyerDetails = (id: string, input: { name: string | null; address: Record<string, string | null> }, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/buyer-details`, { method: "PATCH", body: JSON.stringify({ ...input, expectedVersion, idempotencyKey: actionKey() }) });
export const setPosReceiptContact = (id: string, input: { phone: string | null; email: string | null; consent: boolean }, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/receipt-contact`, { method: "PUT", body: JSON.stringify({ ...input, expectedVersion, idempotencyKey: actionKey() }) });
export const sendPosReceipts = (saleId: string, input: { channel?: "email" | "sms"; destination?: string; consent?: boolean; resend?: boolean } = {}) =>
  post<{ deliveries: PosReceiptDelivery[] }>(`/sales/${saleId}/receipt-delivery`, input).then((response) => response.deliveries);

// F276: bounded customer search against tenant.business_parties -- see
// services/api/src/modules/point-of-sale/assortment-pricing-customer-and-cart/customers.js.
export type PosCustomerMatch = {
  id: string;
  code: string;
  displayName: string;
  phone: string | null;
  email: string | null;
};
export const searchPosCustomers = (
  query: string,
  options: { signal?: AbortSignal } = {},
) =>
  request<{ rows: PosCustomerMatch[] }>(
    `/customers?q=${encodeURIComponent(query)}`,
    { signal: options.signal },
  );

// F283/F284/F285/F286 payment tender subsystem.
export type PosPaymentLeg =
  | { method: "cash"; amount: number }
  | { method: "card" | "upi" | "wallet" | "bank_transfer"; paymentId: string };
export const initiatePosPayment = (input: {
  cartId: string;
  method: "card" | "upi" | "wallet" | "bank_transfer";
  amount: number;
  idempotencyKey: string;
  outcome?: string;
}) => post<{ payment: PosPayment }>("/payments/initiate", input);
export const getPosPayment = (id: string) =>
  request<{ payment: PosPayment }>(`/payments/${id}`);
