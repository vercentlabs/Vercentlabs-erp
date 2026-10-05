"use client";

import { post, request } from "@/features/sales/shared/http";

export type RegisterKind =
  "adjustments" | "pricing-rules";

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
