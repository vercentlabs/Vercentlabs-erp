"use client";

import { post, request } from "@/features/pos/shared/http";

export type PosReceiptSale = {
  id: string;
  receipt_number: string;
  store_name: string;
  terminal_name: string;
  cashier_name: string | null;
  customer_display_name: string | null;
  currency_code: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  rounding_adjustment: string;
  grand_total: string;
  change_total: string;
  coupon_code: string | null;
  completed_at: string;
  created_at: string;
};
export type PosReceiptLine = {
  id: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount_amount: string;
  line_total: string;
};
export type PosReceiptPayment = { id: string; payment_method: string; amount: string };
export type PosReceiptReturn = { id: string; return_number: string; status: string; refund_total: string };
export type PosReceiptPromotionEvidence = { code: string; name: string; discount_amount: string };
export type PosReceiptPrintEvent = {
  id: string;
  print_type: "original" | "reprint";
  requested_at: string;
  requested_by_name: string | null;
};
export type PosSaleReceipt = {
  sale: PosReceiptSale;
  lines: PosReceiptLine[];
  payments: PosReceiptPayment[];
  returns: PosReceiptReturn[];
  promotionEvidence: PosReceiptPromotionEvidence[];
  printEvents: PosReceiptPrintEvent[];
};
export const getPosSaleReceipt = (saleId: string) => request<PosSaleReceipt>(`/sales/${saleId}/receipt`);
// F289 gap closure: records a print was requested and returns the
// server-derived original/reprint classification — never trust a
// `?original=1` URL parameter for this, it proves nothing.
export const recordPosReceiptPrint = (saleId: string) => post<{ printEvent: PosReceiptPrintEvent }>(`/sales/${saleId}/receipt/print`);
