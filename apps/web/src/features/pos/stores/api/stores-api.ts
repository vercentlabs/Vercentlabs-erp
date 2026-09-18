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

export const listPosStores = () => request<{ rows: PosStore[] }>("/stores");
// F268 -- was `post<{ record: PosStore }>` reading a field the route never
// returns (it returns `{ store }`, per apps/web/src/app/api/pos/stores/
// route.ts) -- a pre-existing bug in previously-dead, never-called code,
// caught while building the first real caller (the store admin screen).
export const createPosStore = (input: Record<string, unknown>) => post<{ store: PosStore }>("/stores", input);
export const updatePosStoreRecord = (id: string, input: Record<string, unknown>) =>
  request<{ store: PosStore }>(`/stores/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const setPosStoreActiveRecord = (id: string, active: boolean) => post<{ store: PosStore }>(`/stores/${id}/active`, { active });
