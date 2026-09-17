"use client";

import type { PosCart, PosCoupon, PosPromotion } from "@vercentlabs/api";

export class PosApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new PosApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload.details);
  }
  return payload;
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return fetch(`/api/pos${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
    ...init,
  }).then(parseResponse<T>);
}
const post = <T,>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const del = <T,>(path: string) => request<T>(path, { method: "DELETE" });

export type PosStore = {
  id: string;
  code: string;
  name: string;
  branch_id?: string;
  warehouseId?: string;
  warehouse_id?: string;
  priceListId?: string;
  price_list_id?: string;
  currencyCode?: string;
  currency_code?: string;
  timezone?: string;
  active: boolean;
};
export type PosTerminal = { id: string; code: string; name: string; storeId?: string; store_id?: string; status: string };
export type PosShift = { id: string; storeId?: string; store_id?: string; terminalId?: string; terminal_id?: string; status: string; shiftNumber?: string; shift_number?: string; openingCash?: string; opening_cash?: string };
export type PosProductMatch = { itemId: string; variantId: string | null; name: string; code: string; barcode: string | null; salesPrice: string; availableQuantity: number };

export type PosDashboard = { sales_today: number; revenue_today: string; open_shifts: number; returns_today: number };
export const getPosDashboard = () => request<PosDashboard>("/dashboard");

export type PosStoreSetupOptions = {
  branches: { id: string; name: string; code: string }[];
  warehouses: { id: string; name: string; code: string }[];
  priceLists: { id: string; name: string; code: string; currency_code: string }[];
};
export const getPosStoreSetupOptions = () => request<PosStoreSetupOptions>("/stores/setup-options");

export const listPosStores = () => request<{ rows: PosStore[] }>("/stores");
// F268 -- was `post<{ record: PosStore }>` reading a field the route never
// returns (it returns `{ store }`, per apps/web/src/app/api/pos/stores/
// route.ts) -- a pre-existing bug in previously-dead, never-called code,
// caught while building the first real caller (the store admin screen).
export const createPosStore = (input: Record<string, unknown>) => post<{ store: PosStore }>("/stores", input);
export const updatePosStoreRecord = (id: string, input: Record<string, unknown>) =>
  request<{ store: PosStore }>(`/stores/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosStoreActiveRecord = (id: string, active: boolean) => post<{ store: PosStore }>(`/stores/${id}/active`, { active });

export const listPosTerminals = () => request<{ rows: PosTerminal[] }>("/terminals");
export const createPosTerminal = (input: Record<string, unknown>) => post<{ terminal: PosTerminal }>("/terminals", input);
export const updatePosTerminalRecord = (id: string, input: Record<string, unknown>) =>
  request<{ terminal: PosTerminal }>(`/terminals/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosTerminalStatusRecord = (id: string, status: "active" | "inactive" | "maintenance") =>
  post<{ terminal: PosTerminal }>(`/terminals/${id}/status`, { status });

export type PosEligibleCashier = { id: string; fullName: string; email: string; roleSlugs: string[]; assignedStoreIds: string[] };
export const listPosEligibleCashiers = () => request<{ rows: PosEligibleCashier[] }>("/cashiers");
export type PosStoreAccessGrant = { id: string; userId: string; storeId: string; fullName: string; email: string; createdAt: string };
export const listPosStoreAccess = (storeId?: string) => request<{ rows: PosStoreAccessGrant[] }>(`/store-access${storeId ? `?storeId=${storeId}` : ""}`);
export const grantPosStoreAccess = (userId: string, storeId: string) => post<{ grant: PosStoreAccessGrant }>("/store-access", { userId, storeId });
export const revokePosStoreAccess = (userId: string, storeId: string) =>
  request<{ revoked: true }>(`/store-access?userId=${userId}&storeId=${storeId}`, { method: "DELETE" });

export const openPosShift = (input: Record<string, unknown>) => post<{ shift: PosShift }>("/shifts", input);
export const closePosShift = (id: string, input: Record<string, unknown>) => post<{ shift: PosShift }>(`/shifts/${id}/close`, input);
export const listPosShifts = (query: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
  return request<{ rows: PosShift[] }>(`/shifts${params.size ? `?${params}` : ""}`);
};

export const searchPosProducts = (storeId: string, query: string) =>
  request<{ rows: PosProductMatch[] }>(`/stores/${storeId}/products?q=${encodeURIComponent(query)}`);
export const lookupPosBarcode = (storeId: string, code: string) =>
  request<PosProductMatch>(`/stores/${storeId}/barcode/${encodeURIComponent(code)}`);

// F276: bounded customer search against tenant.business_parties -- see
// services/api/src/modules/point-of-sale/features/customers.js.
export type PosCustomerMatch = { id: string; code: string; displayName: string; phone: string | null; email: string | null };
export const searchPosCustomers = (query: string, options: { signal?: AbortSignal } = {}) =>
  request<{ rows: PosCustomerMatch[] }>(`/customers?q=${encodeURIComponent(query)}`, { signal: options.signal });

export const createPosCart = (input: Record<string, unknown>) => post<{ cart: PosCart }>("/carts", input);
export const getPosCart = (id: string) => request<{ cart: PosCart }>(`/carts/${id}`);
export const addPosCartLine = (id: string, input: Record<string, unknown>) => post<{ cart: PosCart }>(`/carts/${id}/lines`, input);
export const updatePosCartLineQuantity = (id: string, lineId: string, quantity: number, expectedVersion?: number) =>
  request<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify({ quantity, expectedVersion }) });
export const removePosCartLine = (id: string, lineId: string, expectedVersion?: number) =>
  del<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`);
export const applyPosLineDiscount = (id: string, lineId: string, input: Record<string, unknown>) =>
  post<{ cart: PosCart }>(`/carts/${id}/lines/${lineId}/discount`, input);
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

export const listPosPromotions = (status?: string) => request<{ rows: PosPromotion[] }>(`/promotions${status ? `?status=${status}` : ""}`);
export const listPosCoupons = (status?: string) => request<{ rows: PosCoupon[] }>(`/coupons${status ? `?status=${status}` : ""}`);
export const createPosPromotion = (input: Record<string, unknown>) => post<{ record: PosPromotion }>("/promotions", input);
export const createPosCoupon = (input: Record<string, unknown>) => post<{ record: PosCoupon }>("/coupons", input);
export const updatePosPromotion = (id: string, input: Record<string, unknown>) =>
  request<{ record: PosPromotion }>(`/promotions/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const updatePosCoupon = (id: string, input: Record<string, unknown>) =>
  request<{ record: PosCoupon }>(`/coupons/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosPromotionActive = (id: string, active: boolean) => post<{ record: PosPromotion }>(`/promotions/${id}/active`, { active });
export const setPosCouponActive = (id: string, active: boolean) => post<{ record: PosCoupon }>(`/coupons/${id}/active`, { active });
