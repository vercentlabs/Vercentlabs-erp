"use client";

import { request } from "@/features/pos/shared/http";

// The outlets a POS screen picks from (checkout, shifts, terminals, reports), filtered server-side to the outlets the person may work at.
// Outlets themselves are maintained in Stores & Outlets (features/pos/outlets).
export type PosStore = {
  id: string;
  code: string;
  name: string;
  warehouseId?: string;
  warehouse_id?: string;
  priceListId?: string;
  price_list_id?: string;
  currencyCode?: string;
  currency_code?: string;
  timezone?: string;
  active: boolean;
};

// 200 is the API's page ceiling; the admin screens say so when they hit it rather than silently truncating.
export const POS_ADMIN_LIST_LIMIT = 200;
export const listPosStores = () => request<{ rows: PosStore[] }>(`/stores?limit=${POS_ADMIN_LIST_LIMIT}`);
