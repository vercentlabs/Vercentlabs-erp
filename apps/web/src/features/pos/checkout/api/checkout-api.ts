"use client";

import type { PosCart } from "@vercentlabs/api";

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
// Item Discounts: what a proposed discount would do (nothing saved), what this line and cashier allow, and the bill's discounts.
export type { PosLineDiscountPreview, PosLineDiscountEligibility, PosDiscountReason } from "@vercentlabs/api";
import type { PosLineDiscountPreview, PosLineDiscountEligibility } from "@vercentlabs/api";
export const previewPosLineDiscount = (id: string, lineId: string, input: { type: "percent" | "amount"; value: string }) =>
  post<{ preview: PosLineDiscountPreview }>(`/carts/${id}/lines/${lineId}/discount-preview`, input).then((response) => response.preview);
export const getPosLineDiscountEligibility = (id: string, lineId: string) =>
  request<{ eligibility: PosLineDiscountEligibility }>(`/carts/${id}/lines/${lineId}/discount-eligibility`).then((response) => response.eligibility);
// An authorized price for one line (null: back to the list price).
export const overridePosLinePrice = (id: string, lineId: string, input: { unitPrice: string | null; reason?: string; approvalId?: string; expectedVersion: number }) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/price`, { idempotencyKey: actionKey(), ...input });
// Cart Discounts: one discount on the bill (a new one replaces it), a preview that saves nothing, the terms and history, and removal.
export type { PosCartDiscountPreview, PosCartDiscountEligibility } from "@vercentlabs/api";
import type { PosCartDiscountPreview, PosCartDiscountEligibility } from "@vercentlabs/api";
export const setPosCartDiscount = (id: string, input: { type: "percent" | "amount"; value: string; reasonCode?: string | null; note?: string | null; approvalId?: string; expectedVersion: number }) =>
  request<{ cart: PosCart }>(`/carts/${id}/discounts/cart`, { method: "PUT", body: JSON.stringify({ idempotencyKey: actionKey(), ...input }) });
export const removePosCartDiscount = (id: string, expectedVersion: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/discounts/cart?expectedVersion=${expectedVersion}&idempotencyKey=${actionKey()}`);
export const previewPosCartDiscount = (id: string, input: { type: "percent" | "amount"; value: string }) =>
  post<{ preview: PosCartDiscountPreview }>(`/carts/${id}/discounts/preview`, input).then((response) => response.preview);
export const getPosCartDiscountTerms = (id: string) =>
  request<{ cart: PosCartDiscountEligibility }>(`/carts/${id}/discounts`).then((response) => response.cart);
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
export type PosCartIssue = { code: string; message: string; lineId?: string; itemId?: string };
export type PosCheckoutResult = { ready: boolean; issues: PosCartIssue[]; cart: PosCart; snapshot?: Record<string, unknown>; message?: string };
export const validatePosCheckout = (id: string) => request<{ ready: boolean; issues: PosCartIssue[]; version: number }>(`/carts/${id}/checkout`);
export const beginPosCheckout = (id: string, expectedVersion: number) =>
  post<PosCheckoutResult>(`/carts/${id}/checkout`, { action: "begin", expectedVersion, idempotencyKey: actionKey() });
export const releasePosCheckout = (id: string, reason?: string) => post<PosCheckoutResult>(`/carts/${id}/checkout`, { action: "release", reason });
export type PosCartHistoryEntry = { id: string; eventType: string; summary: string; version: number | null; at: string; actor: string | null; terminal: string | null };
export const getPosCartHistory = (id: string) => request<{ events: PosCartHistoryEntry[] }>(`/carts/${id}/history`).then((response) => response.events);
// Named Customer: a customer made at the counter in the shared Customer Master. A likely duplicate comes back as
// POS_CUSTOMER_POSSIBLE_DUPLICATE with the matches in the error's details; confirmNotDuplicate creates anyway.
export type PosQuickCustomerInput = {
  kind: "individual" | "business"; name: string; legalName?: string | null; phone?: string | null; email?: string | null; gstin?: string | null;
  billingAddress?: { line1?: string | null; city?: string | null; stateCode?: string | null; postalCode?: string | null } | null;
  contactPerson?: string | null; cartId?: string | null; idempotencyKey: string; confirmNotDuplicate?: boolean;
};
export type PosDuplicateMatch = { id: string; code: string | null; name: string | null; city: string | null; status: string | null; strength: "strong" | "possible"; reasons: string[]; notCustomer?: boolean };
export const quickCreatePosCustomer = (input: PosQuickCustomerInput) =>
  post<{ customer: PosCustomerMatch; created: boolean; warnings: string[] }>("/customers", input);

// Walk-In Customer: the bill's customer context and its changes.
export type { PosCustomerContext, PosReceiptDelivery } from "@vercentlabs/api";
import type { PosCustomerContext, PosReceiptDelivery } from "@vercentlabs/api";
export const getPosCustomerContext = (id: string) => request<{ context: PosCustomerContext }>(`/carts/${id}/customer/context`).then((response) => response.context);
export const setPosWalkIn = (id: string, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/customer/walk-in`, { method: "PUT", body: JSON.stringify({ expectedVersion, idempotencyKey: actionKey() }) });
export const selectPosRegisteredCustomer = (id: string, customerId: string, expectedVersion: number, billingAddressId?: string | null) =>
  request<{ cart: PosCart }>(`/carts/${id}/customer/registered`, { method: "PUT", body: JSON.stringify({ customerId, billingAddressId: billingAddressId ?? null, expectedVersion, idempotencyKey: actionKey() }) });
export const setPosBillingAddress = (id: string, billingAddressId: string, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/billing-address`, { method: "PUT", body: JSON.stringify({ billingAddressId, expectedVersion, idempotencyKey: actionKey() }) });
export type { PosCustomerPreview, PosCustomerPurchase } from "@vercentlabs/api";
import type { PosCustomerPreview, PosCustomerPurchase } from "@vercentlabs/api";
export const getPosCustomerPreview = (customerId: string, cartId: string) =>
  request<{ customer: PosCustomerPreview }>(`/customers/${customerId}/preview?cartId=${cartId}`).then((response) => response.customer);
export const getPosCustomerPurchases = (customerId: string, cartId: string, offset = 0) =>
  request<{ rows: PosCustomerPurchase[]; total: number; limit: number; offset: number }>(`/customers/${customerId}/sales?cartId=${cartId}&limit=10&offset=${offset}`);
export const updatePosBuyerDetails = (id: string, input: { name: string | null; address: Record<string, string | null> }, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/buyer-details`, { method: "PATCH", body: JSON.stringify({ ...input, expectedVersion, idempotencyKey: actionKey() }) });
export const setPosReceiptContact = (id: string, input: { phone: string | null; email: string | null; consent: boolean }, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/receipt-contact`, { method: "PUT", body: JSON.stringify({ ...input, expectedVersion, idempotencyKey: actionKey() }) });
export const sendPosReceipts = (saleId: string, input: { channel?: "email" | "sms"; destination?: string; consent?: boolean; resend?: boolean } = {}) =>
  post<{ deliveries: PosReceiptDelivery[] }>(`/sales/${saleId}/receipt-delivery`, input).then((response) => response.deliveries);

// POS Taxes: the bill's tax from the shared tax engine (or why it cannot be calculated), and how the goods leave the store.
export type { PosCartTaxes, PosSaleTaxes, PosTaxSummary } from "@vercentlabs/api";
import type { PosCartTaxes, PosSaleTaxes } from "@vercentlabs/api";
export const getPosCartTaxes = (id: string) => request<{ taxes: PosCartTaxes }>(`/carts/${id}/taxes`).then((response) => response.taxes);
export const setPosCartSupply = (id: string, input: { supplyMode: "in_store" | "delivery"; deliveryStateCode?: string | null }, expectedVersion: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/supply`, { method: "PUT", body: JSON.stringify({ ...input, expectedVersion, idempotencyKey: actionKey() }) });
export const getPosSaleTaxes = (saleId: string) => request<{ taxes: PosSaleTaxes }>(`/sales/${saleId}/taxes`).then((response) => response.taxes);

// Named Customer search: name, customer number, phone, email or GSTIN, ranked and paged by the server (never the whole list).
export type { PointOfSaleCustomerMatch as PosCustomerMatch } from "@vercentlabs/api";
import type { PointOfSaleCustomerMatch as PosCustomerMatch } from "@vercentlabs/api";
export const searchPosCustomers = (query: string, options: { cartId: string; offset?: number; signal?: AbortSignal }) =>
  request<{ rows: PosCustomerMatch[]; total: number; limit: number; offset: number }>(
    `/customers?q=${encodeURIComponent(query)}&cartId=${options.cartId}&limit=10&offset=${options.offset ?? 0}`,
    { signal: options.signal },
  );

// POS Cash Payments: the methods and cash options of a checkout (the bill id is the checkout id), a preview that records nothing, the
// cashier's confirmation of cash received (the server works out the change and finalises the sale), retry, handing cash back, flagging for
// a supervisor, and the authoritative payment state after a refresh or a lost connection.
export type { PosCheckoutPaymentMethods, PosCashPreview, PosCashOutcome, PosCheckoutPayments } from "@vercentlabs/api";
import type { PosCheckoutPaymentMethods, PosCashPreview, PosCashOutcome, PosCheckoutPayments } from "@vercentlabs/api";
export const getPosPaymentMethods = (cartId: string) =>
  request<{ paymentMethods: PosCheckoutPaymentMethods }>(`/checkouts/${cartId}/payment-methods`).then((response) => response.paymentMethods);
export const previewPosCash = (cartId: string, cashReceived: string) =>
  post<{ preview: PosCashPreview }>(`/checkouts/${cartId}/cash/preview`, { cashReceived }).then((response) => response.preview);
export const confirmPosCash = (cartId: string, input: { cashReceived: string; changeGiven?: string; split?: boolean; expectedVersion?: number; idempotencyKey: string }) =>
  post<{ cash: PosCashOutcome }>(`/checkouts/${cartId}/cash/confirm`, input).then((response) => response.cash);
export const finalizePosCash = (cartId: string) =>
  post<{ cash: PosCashOutcome }>(`/checkouts/${cartId}/cash/finalize`, { idempotencyKey: actionKey() }).then((response) => response.cash);
export const returnPosCash = (cartId: string, input: { reason?: string; returnedAmount?: string; cashReturned: boolean }) =>
  post<{ cash: PosCashOutcome }>(`/checkouts/${cartId}/cash/return`, { ...input, idempotencyKey: actionKey() }).then((response) => response.cash);
export const flagPosCash = (cartId: string, note: string) =>
  post<{ cash: PosCashOutcome }>(`/checkouts/${cartId}/cash/reconcile`, { action: "flag", note }).then((response) => response.cash);
export const getPosCheckoutPayments = (cartId: string) =>
  request<{ payments: PosCheckoutPayments }>(`/checkouts/${cartId}/payments`).then((response) => response.payments);

// POS Card Payments: the card options of a checkout, sending a payment to a terminal, the authoritative attempt state (polled), cancelling,
// recording a standalone card machine payment, retrying finalisation and refunding a captured card whose sale could not be finalised.
export type { PosCheckoutCardOptions, PosCardAttempt, PosPaymentTerminal } from "@vercentlabs/api";
import type { PosCheckoutCardOptions, PosCardAttempt } from "@vercentlabs/api";
export const getPosCardOptions = (cartId: string) => request<{ card: PosCheckoutCardOptions }>(`/checkouts/${cartId}/card`).then((response) => response.card);
export const startPosCard = (cartId: string, input: { terminalId: string; amount?: string | null; idempotencyKey: string; outcome?: string }) =>
  post<{ attempt: PosCardAttempt }>(`/checkouts/${cartId}/card/attempts`, input).then((response) => response.attempt);
export const getPosCardAttempt = (attemptId: string) => request<{ attempt: PosCardAttempt }>(`/card-attempts/${attemptId}`).then((response) => response.attempt);
export const cancelPosCard = (attemptId: string, reason?: string) =>
  post<{ attempt: PosCardAttempt }>(`/card-attempts/${attemptId}/cancel`, { reason }).then((response) => response.attempt);
export const recordStandaloneCard = (cartId: string, input: { terminalId: string; amount?: string | null; reference: string; attested: boolean; cardLastFour?: string | null; idempotencyKey: string }) =>
  post<{ attempt: PosCardAttempt }>(`/checkouts/${cartId}/card/standalone`, input).then((response) => response.attempt);
export const finalizePosCard = (cartId: string) => post<{ attempt: PosCardAttempt }>(`/checkouts/${cartId}/card/finalize`, {}).then((response) => response.attempt);
export const refundUnfinalizedCard = (attemptId: string, reason: string) =>
  post<{ attempt: PosCardAttempt }>(`/card-attempts/${attemptId}/refund`, { reason, idempotencyKey: actionKey() }).then((response) => response.attempt);

// POS UPI & Digital Payments: the UPI options of a checkout, a dynamic QR or payment link from the provider, the request's authoritative
// state (polled), cancelling it, and recording a payment to the shop's verified static QR with its UTR.
export type { PosCheckoutUpiOptions, PosDigitalAttempt } from "@vercentlabs/api";
import type { PosCheckoutUpiOptions, PosDigitalAttempt } from "@vercentlabs/api";
export const getPosUpiOptions = (cartId: string) => request<{ upi: PosCheckoutUpiOptions }>(`/checkouts/${cartId}/upi`).then((response) => response.upi);
export const startPosUpiQr = (cartId: string, input: { amount?: string | null; idempotencyKey: string; outcome?: string }) =>
  post<{ attempt: PosDigitalAttempt }>(`/checkouts/${cartId}/upi/attempts`, { mode: "dynamic_qr", ...input }).then((response) => response.attempt);
export const createPosPaymentLink = (cartId: string, input: { amount?: string | null; contact?: string | null; consent?: boolean; idempotencyKey: string }) =>
  post<{ attempt: PosDigitalAttempt }>(`/checkouts/${cartId}/digital/payment-links`, input).then((response) => response.attempt);
export const getPosUpiAttempt = (attemptId: string) => request<{ attempt: PosDigitalAttempt }>(`/upi-attempts/${attemptId}`).then((response) => response.attempt);
export const cancelPosUpi = (attemptId: string, reason?: string) =>
  post<{ attempt: PosDigitalAttempt }>(`/upi-attempts/${attemptId}/cancel`, { reason }).then((response) => response.attempt);
export const recordStaticUpi = (cartId: string, input: { utr: string; amount?: string | null; attested: boolean; idempotencyKey: string }) =>
  post<{ attempt: PosDigitalAttempt }>(`/checkouts/${cartId}/upi/static/record`, input).then((response) => response.attempt);

// POS Split Payments: the split plan and each part's authoritative state, saving the plan, collecting one part through its own method,
// finalising, and cancelling with compensation of every collected part.
export type { PosSplitStatus, PosSplitComponent } from "@vercentlabs/api";
import type { PosSplitStatus } from "@vercentlabs/api";
export const getPosSplit = (cartId: string) => request<{ split: PosSplitStatus }>(`/checkouts/${cartId}/split-plan`).then((response) => response.split);
export const savePosSplit = (cartId: string, components: Array<{ method: string; amount: string }>, expectedPlanVersion: number) =>
  post<{ split: PosSplitStatus }>(`/checkouts/${cartId}/split-plan`, { components, expectedPlanVersion, idempotencyKey: actionKey() }).then((response) => response.split);
export const collectPosSplitPart = (cartId: string, method: string, input: { terminalId?: string; cashReceived?: string; idempotencyKey: string; outcome?: string }) =>
  post<{ result: unknown; split: PosSplitStatus }>(`/checkouts/${cartId}/payment-components/${method}/initiate`, input);
export const finalizePosSplit = (cartId: string) => post<{ split: PosSplitStatus }>(`/checkouts/${cartId}/finalize`, {}).then((response) => response.split);
export const cancelPosSplit = (cartId: string, input: { reason?: string; cashReturned?: boolean }) =>
  post<{ status: string; code?: string; message?: string; actions: Array<{ method: string; action: string; status: string }>; split: PosSplitStatus }>(`/checkouts/${cartId}/cancel`,
    { ...input, idempotencyKey: actionKey() });
