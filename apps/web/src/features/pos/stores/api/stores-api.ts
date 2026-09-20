"use client";

import { request, post } from "@/features/pos/shared/http";

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
export type PosStoreSetupOptions = {
  branches: { id: string; name: string; code: string }[];
  warehouses: { id: string; name: string; code: string }[];
  priceLists: { id: string; name: string; code: string; currency_code: string }[];
};
export const getPosStoreSetupOptions = () => request<PosStoreSetupOptions>("/stores/setup-options");

// 200 is the API's page ceiling; the admin screens say so when they hit it rather than silently truncating.
export const POS_ADMIN_LIST_LIMIT = 200;
export const listPosStores = () => request<{ rows: PosStore[] }>(`/stores?limit=${POS_ADMIN_LIST_LIMIT}`);
// F268 -- was `post<{ record: PosStore }>` reading a field the route never
// returns (it returns `{ store }`, per apps/web/src/app/api/pos/stores/
// route.ts) -- a pre-existing bug in previously-dead, never-called code,
// caught while building the first real caller (the store admin screen).
export const createPosStore = (input: Record<string, unknown>) => post<{ store: PosStore }>("/stores", input);
export const updatePosStoreRecord = (id: string, input: Record<string, unknown>) =>
  request<{ store: PosStore }>(`/stores/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosStoreActiveRecord = (id: string, active: boolean) => post<{ store: PosStore }>(`/stores/${id}/active`, { active });

// F282-F286 -- which payment methods a store offers and which provider backs
// each non-cash one. Both halves are required before checkout will take a card
// or UPI payment (see tender-and-payment-execution/payments.js).
export type PosPaymentConfigStore = { id: string; name: string };
export type PosStorePaymentConfig = {
  storeId: string;
  storeName: string;
  allowedMethods: string[];
  providers: Array<{ payment_method: string; provider_key: string; credential_env_var: string | null; active: boolean }>;
  availableProviders: string[];
};
export const getPosStorePaymentConfig = (storeId: string) => request<{ config: PosStorePaymentConfig }>(`/stores/${storeId}/payment-config`);
export const setPosStorePaymentConfig = (
  storeId: string,
  input: { allowedMethods: string[]; providers: Record<string, { providerKey: string; credentialEnvVar: string | null }> },
) => request<{ config: PosStorePaymentConfig }>(`/stores/${storeId}/payment-config`, { method: "PUT", body: JSON.stringify(input) });
