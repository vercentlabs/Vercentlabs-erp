"use client";

import { request } from "@/features/pos/shared/http";

// F276/F287-F290 -- the POS Customers workspace is deliberately thin: it
// reuses the same bounded business_parties search checkout already uses
// (searchPosCustomers, checkout-api.ts), the same real loyalty ledger
// (loyalty-api.ts) and the same invoice list (invoices-api.ts) rather than
// forking a second customer read path. This file only adds what genuinely
// didn't exist yet -- a customer-scoped view of a customer's own past POS
// sales ("purchase history at this POS"), via the existing generic
// listPointOfSaleResource("sales", ...) now accepting a customerId filter
// (services/api/src/modules/point-of-sale/shared/resource-registry.js).
export type PosCustomerSaleRow = {
  id: string;
  receipt_number: string;
  store_id: string;
  terminal_id: string;
  status: string;
  sale_date: string;
  currency_code: string;
  grand_total: string;
  created_at: string;
};

export const listPosCustomerSales = (customerId: string, limit = 50) =>
  request<{ rows: PosCustomerSaleRow[] }>(`/sales?customerId=${encodeURIComponent(customerId)}&limit=${limit}`);
