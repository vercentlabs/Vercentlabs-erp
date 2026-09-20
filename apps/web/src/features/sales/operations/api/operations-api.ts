"use client";

import { post, request } from "@/features/sales/shared/http";

export type RegisterKind = "advances" | "adjustments" | "drop-ships" | "commission-rules" | "commissions" | "fulfillment-requests" | "invoice-requests" | "returns";

type OrderRef = { sales_order_id: string; sales_order_number?: string; customer_name?: string | null; currency_code?: string };

export type AdvanceRow = { id: string; sales_order_id: string; amount: string; currency_code: string; payment_reference: string; received_at: string; status: string; note: string | null };
export type AdjustmentRow = { id: string; sales_order_id: string; adjustment_type: string; amount: string; currency_code: string; reason: string; status: string; created_at: string };
export type DropShipRow = { id: string; sales_order_id: string; supplier_id: string; quantity: string; status: string; procurement_reference: string | null; created_at: string };
export type CommissionRuleRow = { id: string; name: string; rate_percent: string; basis: string; owner_user_id: string | null; valid_from: string | null; valid_to: string | null; status: string };
export type CommissionRow = { id: string; sales_order_id: string; owner_user_id: string; basis_amount: string; rate_percent: string; commission_amount: string; status: string; created_at: string };
export type FulfillmentRegisterRow = OrderRef & { id: string; request_number: string; status: string; retry_count: number; last_error: string | null; requested_at: string; completed_at: string | null };
export type InvoiceRegisterRow = OrderRef & { id: string; request_number: string; status: string; quantity_basis: string; retry_count: number; last_error: string | null; requested_at: string; completed_at: string | null; grand_total: string };
export type ReturnRow = OrderRef & { id: string; request_number: string; status: string; reason: string; lines: Array<{ itemCode: string; quantity: string }>; requested_at: string; decided_at: string | null; decision_note: string | null };

export const listRegister = <T,>(kind: RegisterKind) => request<{ rows: T[] }>(`/operations?kind=${kind}`);

export const recordAdvance = (input: { salesOrderId: string; amount: number; paymentReference: string; note?: string }) => post<{ advance: AdvanceRow }>("/operations/advances", input);
export const requestAdjustment = (input: { salesOrderId: string; adjustmentType: "credit_note" | "refund"; amount: number; reason: string }) => post<{ adjustment: AdjustmentRow }>("/operations/adjustments", input);
export const createDropShip = (input: { salesOrderId: string; salesOrderLineId: string; supplierId: string; quantity: number; idempotencyKey: string }) => post<{ dropShip: DropShipRow }>("/operations/drop-ships", input);
export const createCommissionRule = (input: { name: string; ratePercent: number; basis: "net_sales" | "gross_margin"; ownerUserId?: string | null }) => post<{ rule: CommissionRuleRow }>("/operations/commission-rules", input);
export const accrueCommission = (input: { salesOrderId: string; ruleId?: string | null; ownerUserId?: string | null }) => post<{ commission: CommissionRow }>("/operations/commissions", input);
export const createReturn = (orderId: string, input: { idempotencyKey: string; reason: string; lines: Array<{ salesOrderLineId: string; quantity: number }> }) => post<{ returnRequest: { id: string; request_number: string } }>(`/orders/${orderId}/returns`, input);
