"use client";

import { post, request } from "@/features/sales/shared/http";

export type RegisterKind =
  "adjustments" | "fulfillment-requests" | "invoice-requests" | "pricing-rules";

type OrderRef = {
  sales_order_id: string;
  sales_order_number?: string;
  customer_name?: string | null;
  currency_code?: string;
};

export type AdjustmentRow = {
  id: string;
  sales_order_id: string;
  adjustment_type: string;
  amount: string;
  currency_code: string;
  reason: string;
  status: string;
  created_at: string;
  decision_note?: string | null;
};
// A delivery made from a sales order, with what it carried.
export type DeliveryRegisterRow = OrderRef & {
  id: string;
  request_number: string;
  status: string;
  delivery_date: string | null;
  completed_at: string | null;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  received_by: string | null;
  items: string | null;
};
// An invoice raised from a sales order; Finance owns and posts it.
export type InvoiceRegisterRow = OrderRef & {
  id: string;
  request_number: string;
  requested_at: string;
  invoice_id: string;
  invoice_number: string;
  status: string;
  invoice_date: string | null;
  grand_total: string;
  outstanding_amount: string;
};
export const listRegister = <T>(kind: RegisterKind) =>
  request<{ rows: T[] }>(`/operations?kind=${kind}`);

export const requestAdjustment = (input: {
  salesOrderId: string;
  adjustmentType: "credit_note" | "refund";
  amount: number;
  reason: string;
}) => post<{ adjustment: AdjustmentRow }>("/operations/adjustments", input);
export type PricingRuleRow = {
  id: string;
  code: string;
  name: string;
  adjustment_type: string;
  adjustment_value: string;
  party_id: string | null;
  item_id: string | null;
  minimum_quantity: string;
  valid_from: string | null;
  valid_to: string | null;
  status: string;
};
export const decideAdjustment = (
  id: string,
  decision: "approved" | "rejected",
  note?: string,
) =>
  post<{ result: unknown }>(`/operations/adjustments/${id}/decide`, {
    decision,
    note,
  });
