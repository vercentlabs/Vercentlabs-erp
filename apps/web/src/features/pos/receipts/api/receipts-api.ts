"use client";

import { request } from "@/features/pos/shared/http";

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
export type PosSaleReceipt = {
  sale: PosReceiptSale;
  lines: PosReceiptLine[];
  payments: PosReceiptPayment[];
  returns: PosReceiptReturn[];
  promotionEvidence: PosReceiptPromotionEvidence[];
};
export const getPosSaleReceipt = (saleId: string) => request<PosSaleReceipt>(`/sales/${saleId}/receipt`);
