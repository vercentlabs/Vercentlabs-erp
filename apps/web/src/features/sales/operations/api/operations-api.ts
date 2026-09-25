"use client";

import { post, request } from "@/features/sales/shared/http";

export type RegisterKind = "advances" | "adjustments" | "drop-ships" | "commission-rules" | "commissions" | "fulfillment-requests" | "invoice-requests" | "returns" | "backorders" | "pricing-rules";

type OrderRef = { sales_order_id: string; sales_order_number?: string; customer_name?: string | null; currency_code?: string };

export type AdvanceRow = { id: string; sales_order_id: string; amount: string; currency_code: string; payment_reference: string; received_at: string; status: string; note: string | null; status_reason?: string | null; applied_invoice_request_id?: string | null };
export type AdjustmentRow = { id: string; sales_order_id: string; adjustment_type: string; amount: string; currency_code: string; reason: string; status: string; created_at: string; decision_note?: string | null };
export type DropShipRow = { id: string; sales_order_id: string; supplier_id: string; quantity: string; status: string; procurement_reference: string | null; created_at: string; carrier?: string | null; tracking_number?: string | null; status_note?: string | null };
export type CommissionRuleRow = { id: string; name: string; rate_percent: string; basis: string; owner_user_id: string | null; valid_from: string | null; valid_to: string | null; status: string };
export type CommissionRow = { id: string; sales_order_id: string; owner_user_id: string; basis_amount: string; rate_percent: string; commission_amount: string; status: string; created_at: string; explanation?: { formula?: string; basisLabel?: string; rule?: string } | null; reversal_reason?: string | null };
export type FulfillmentRegisterRow = OrderRef & { id: string; request_number: string; status: string; retry_count: number; last_error: string | null; requested_at: string; completed_at: string | null; carrier?: string | null; tracking_number?: string | null; shipped_at?: string | null; delivered_at?: string | null; received_by?: string | null };
export type InvoiceRegisterRow = OrderRef & { id: string; request_number: string; status: string; quantity_basis: string; retry_count: number; last_error: string | null; requested_at: string; completed_at: string | null; grand_total: string };
export type ReturnRow = OrderRef & { id: string; request_number: string; status: string; reason: string; lines: Array<{ salesOrderLineId: string; itemCode: string; quantity: string }>; requested_at: string; decided_at: string | null; decision_note: string | null };

export const listRegister = <T,>(kind: RegisterKind) => request<{ rows: T[] }>(`/operations?kind=${kind}`);

export const recordAdvance = (input: { salesOrderId: string; amount: number; paymentReference: string; note?: string }) => post<{ advance: AdvanceRow }>("/operations/advances", input);
export const requestAdjustment = (input: { salesOrderId: string; adjustmentType: "credit_note" | "refund"; amount: number; reason: string }) => post<{ adjustment: AdjustmentRow }>("/operations/adjustments", input);
export const createDropShip = (input: { salesOrderId: string; salesOrderLineId: string; supplierId: string; quantity: number; idempotencyKey: string }) => post<{ dropShip: DropShipRow }>("/operations/drop-ships", input);
export const createCommissionRule = (input: { name: string; ratePercent: number; basis: "net_sales" | "gross_margin"; ownerUserId?: string | null }) => post<{ rule: CommissionRuleRow }>("/operations/commission-rules", input);
export const accrueCommission = (input: { salesOrderId: string; ruleId?: string | null; ownerUserId?: string | null }) => post<{ commission: CommissionRow }>("/operations/commissions", input);
export const createReturn = (orderId: string, input: { idempotencyKey: string; reason: string; lines: Array<{ salesOrderLineId: string; quantity: number }> }) => post<{ returnRequest: { id: string; request_number: string } }>(`/orders/${orderId}/returns`, input);

export type BackorderRow = { id: string; sales_order_id: string; sales_order_number: string; customer_name: string | null; item_code_snapshot: string; item_name_snapshot: string; quantity: string; fulfilled_quantity: string; backordered_quantity: string; requested_delivery_date: string | null; uom_snapshot?: string | null; promised_date?: string | null; promise_note?: string | null };
export type PricingRuleRow = { id: string; code: string; name: string; adjustment_type: string; adjustment_value: string; party_id: string | null; item_id: string | null; minimum_quantity: string; valid_from: string | null; valid_to: string | null; status: string };
export type AvailabilityPromise = {
  basis: "in_stock" | "incoming_supply" | "supplier_lead_time" | "no_supply" | "reserved";
  promisedDate: string | null;
  explanation: string;
  unit: string | null;
  conversionFactor: number;
  availableBase: number;
  requestedBase: number;
  supplierLeadTimeDays: number | null;
  incoming: Array<{ purchaseOrderNumber: string | null; expectedDate: string | null; openQuantity: number }>;
};
export type StockAvailability = {
  line: { lineQuantity: number; reservedQuantity: number; remainingReservableQuantity: number; conversionFactor: number; unit: string | null };
  availability: { canPromise: boolean; requestedQuantity: string | number; onHandQuantity: string; reservedQuantity: string; availableQuantity: string; availableToPromise: string; qualityHeldQuantity: string | null };
  requestedQuantity: number;
  requestedBaseQuantity: number;
  promise: AvailabilityPromise;
};

export const checkLineAvailability = (orderId: string, salesOrderLineId: string, quantity?: number) => post<{ availability: StockAvailability }>(`/orders/${orderId}/availability`, { salesOrderLineId, quantity });
export const reserveLineStock = (orderId: string, salesOrderLineId: string, quantity: number, idempotencyKey: string) => post<{ reservation: unknown }>(`/orders/${orderId}/reserve`, { salesOrderLineId, quantity, idempotencyKey });
export const completeDelivery = (requestId: string, lines: Array<{ salesOrderLineId: string; fulfilledQuantity: number }>) => post<{ detail: unknown }>(`/fulfillment-requests/${requestId}/complete`, { lines });
export const releaseOrderReservations = (orderId: string, reason: string) => post<{ result: { released: number } }>(`/orders/${orderId}/reservations/release`, { reason });
export const promiseOrderLine = (lineId: string, promisedDate: string, note: string) => post<{ promise: unknown }>(`/order-lines/${lineId}/promise`, { promisedDate, note });
export const recordShipment = (requestId: string, input: { carrier: string; trackingNumber?: string }) => post<{ shipment: unknown }>(`/fulfillment-requests/${requestId}/ship`, input);
export const recordDelivery = (requestId: string, input: { receivedBy: string; note?: string }) => post<{ delivery: unknown }>(`/fulfillment-requests/${requestId}/deliver`, input);

// F052–F057 after-sales transitions.
export const decideReturn = (id: string, decision: "approved" | "rejected", note?: string) => post<{ result: unknown }>(`/returns/${id}/decide`, { decision, note });
export const receiveReturn = (id: string, lines: Array<{ salesOrderLineId: string; quantity: number; disposition: "restock" | "scrap" }>) => post<{ result: unknown }>(`/returns/${id}/receive`, { lines });
export const decideAdjustment = (id: string, decision: "approved" | "rejected", note?: string) => post<{ result: unknown }>(`/operations/adjustments/${id}/decide`, { decision, note });
export const updateDropShip = (id: string, input: { status: string; procurementReference?: string; carrier?: string; trackingNumber?: string; note?: string }) => post<{ result: unknown }>(`/operations/drop-ships/${id}/status`, input);
export const cancelAdvance = (id: string, reason: string, refunded: boolean) => post<{ result: unknown }>(`/operations/advances/${id}/cancel`, { reason, refunded });
export const approveCommission = (id: string) => post<{ result: unknown }>(`/operations/commissions/${id}/approve`, {});
