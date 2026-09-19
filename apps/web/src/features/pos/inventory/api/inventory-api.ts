"use client";

import { request } from "@/features/pos/shared/http";

// F294/F296 -- read-only visibility into Stock's own ledger, scoped to a
// POS store's mapped warehouse. See services/api/src/modules/point-of-sale/
// inventory-and-offline-continuity/inventory-visibility.js for why this
// never becomes a parallel write path.
export type PosStoreRef = { id: string; code: string; name: string; warehouse_id: string };

export type PosStoreInventoryRow = {
  item_id: string;
  item_code: string;
  item_name: string;
  barcode: string | null;
  tracking_type: "none" | "batch" | "serial";
  warehouse_location_id: string | null;
  location_code: string | null;
  batch_id: string | null;
  batch_number: string | null;
  expires_on: string | null;
  on_hand_quantity: string;
  reserved_quantity: string;
  available_quantity: string;
  updated_at: string;
  quality_held: boolean;
};

export const listPosStoreInventory = (params: { storeId: string; search?: string; limit?: number; offset?: number }) => {
  const query = new URLSearchParams({ storeId: params.storeId });
  if (params.search) query.set("search", params.search);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return request<{ store: PosStoreRef; rows: PosStoreInventoryRow[] }>(`/inventory?${query.toString()}`);
};

export type PosStoreStockActivityRow = {
  id: string;
  movement_number: string;
  movement_type: "receipt" | "issue" | "adjustment";
  item_id: string;
  item_code: string;
  item_name: string;
  quantity: string;
  unit_cost: string;
  reference_type: string;
  reference_id: string;
  occurred_at: string;
  sale_id: string | null;
  sale_receipt_number: string | null;
  return_id: string | null;
  return_number: string | null;
};

export const listPosStoreStockActivity = (params: { storeId: string; limit?: number; offset?: number }) => {
  const query = new URLSearchParams({ storeId: params.storeId });
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return request<{ store: PosStoreRef; rows: PosStoreStockActivityRow[] }>(`/inventory/activity?${query.toString()}`);
};
