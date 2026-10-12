"use client";

import { request } from "@/features/pos/shared/http";

type PosReceiptSale = {
  id: string;
  receipt_number: string;
  store_name: string;
  terminal_name: string;
  cashier_name: string | null;
  customer_display_name: string | null;
  currency_code: string;
  subtotal: string;
  discount_total: string;
  // Cart Discounts (0091): the bill discount as charged (its shares are on the lines).
  cart_discount_type?: "percent" | "amount" | null;
  cart_discount_value?: string | null;
  cart_discount_amount?: string | null;
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
  // Item Discounts (0090): the cashier's discount on this line, as given.
  manual_discount_amount?: string | null;
  manual_discount_type?: "percent" | "amount" | null;
  manual_discount_value?: string | null;
  line_total: string;
};
export type PosReceiptPayment = {
  id: string;
  payment_method: string;
  amount: string;
  // Cash Payments (0092): what was handed over and the change given (amount is what the cash settled).
  cash_received_amount?: string | null;
  change_given_amount?: string | null;
  // Card Payments (0093): masked card and safe references only.
  card_network?: string | null;
  card_last_four?: string | null;
  provider_reference?: string | null;
  external_reference?: string | null;
  verification_status?: string | null;
  // UPI & Digital (0094): the UTR / RRN and how the customer actually paid.
  provider_transaction_reference?: string | null;
  instrument?: string | null;
  payment_mode?: string | null;
};
export type PosReceiptReturn = {
  id: string;
  return_number: string;
  status: string;
  refund_total: string;
};
export type PosReceiptPromotionEvidence = {
  code: string;
  name: string;
  discount_amount: string;
};
export type PosReceiptPrintEvent = {
  id: string;
  print_type: "original" | "reprint";
  request_type: "auto" | "manual" | "reprint" | "test";
  status: string;
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
export const getPosSaleReceipt = (saleId: string) =>
  request<PosSaleReceipt>(`/sales/${saleId}/receipt`);
