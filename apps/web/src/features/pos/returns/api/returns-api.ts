"use client";

import { request, post } from "@/features/pos/shared/http";

// F291/F292 -- cash returns and refunds.
export type PosReturnSaleLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: string;
  returned_quantity: string;
  remaining_quantity: string;
  unit_price: string;
  line_total: string;
};
export type PosReturnSale = { id: string; receipt_number: string; grand_total: string; currency_code: string; status: string; customer_id: string | null };
export const findPosSaleForReturn = (receiptNumber: string) =>
  request<{ sale: PosReturnSale; lines: PosReturnSaleLine[] }>(`/returns/find?receiptNumber=${encodeURIComponent(receiptNumber)}`);

export type PosReturn = {
  id: string;
  return_number: string;
  status: "pending_approval" | "approved" | "completed" | "rejected";
  reason: string;
  refund_total: string;
  sale_id: string;
  requested_by: string;
  approved_by: string | null;
  completed_by: string | null;
  created_at: string;
};
export const listPosReturns = () => request<{ rows: PosReturn[] }>("/returns");
export const createPosReturn = (input: {
  saleId: string;
  lines: { saleLineId: string; quantity: number; restock?: boolean }[];
  reason: string;
  idempotencyKey: string;
}) => post<{ posReturn: PosReturn }>("/returns", input);
export const approvePosReturn = (id: string, input: { reason?: string; idempotencyKey: string }) =>
  post<{ posReturn: PosReturn }>(`/returns/${id}/approve`, input);
export const completePosReturn = (id: string, input: { idempotencyKey: string }) => post<{ posReturn: PosReturn & { saleStatus: string } }>(`/returns/${id}/complete`, input);
