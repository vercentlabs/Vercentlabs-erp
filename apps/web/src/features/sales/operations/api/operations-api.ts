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
export type FulfillmentRegisterRow = OrderRef & {
  id: string;
  request_number: string;
  status: string;
  retry_count: number;
  last_error: string | null;
  requested_at: string;
  completed_at: string | null;
  carrier?: string | null;
  tracking_number?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  received_by?: string | null;
};
export type InvoiceRegisterRow = OrderRef & {
  id: string;
  request_number: string;
  status: string;
  quantity_basis: string;
  retry_count: number;
  last_error: string | null;
  requested_at: string;
  completed_at: string | null;
  grand_total: string;
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
export type AvailabilityPromise = {
  basis:
    | "in_stock"
    | "incoming_supply"
    | "supplier_lead_time"
    | "no_supply"
    | "reserved";
  promisedDate: string | null;
  explanation: string;
  unit: string | null;
  conversionFactor: number;
  availableBase: number;
  requestedBase: number;
  supplierLeadTimeDays: number | null;
  incoming: Array<{
    purchaseOrderNumber: string | null;
    expectedDate: string | null;
    openQuantity: number;
  }>;
};
export type StockAvailability = {
  line: {
    lineQuantity: number;
    reservedQuantity: number;
    remainingReservableQuantity: number;
    conversionFactor: number;
    unit: string | null;
  };
  availability: {
    canPromise: boolean;
    requestedQuantity: string | number;
    onHandQuantity: string;
    reservedQuantity: string;
    availableQuantity: string;
    availableToPromise: string;
    qualityHeldQuantity: string | null;
  };
  requestedQuantity: number;
  requestedBaseQuantity: number;
  promise: AvailabilityPromise;
};

export const checkLineAvailability = (
  orderId: string,
  salesOrderLineId: string,
  quantity?: number,
) =>
  post<{ availability: StockAvailability }>(`/orders/${orderId}/availability`, {
    salesOrderLineId,
    quantity,
  });
export const reserveLineStock = (
  orderId: string,
  salesOrderLineId: string,
  quantity: number,
  idempotencyKey: string,
) =>
  post<{ reservation: unknown }>(`/orders/${orderId}/reserve`, {
    salesOrderLineId,
    quantity,
    idempotencyKey,
  });
export const completeDelivery = (
  requestId: string,
  lines: Array<{ salesOrderLineId: string; fulfilledQuantity: number }>,
) =>
  post<{ detail: unknown }>(`/fulfillment-requests/${requestId}/complete`, {
    lines,
  });
export const releaseOrderReservations = (orderId: string, reason: string) =>
  post<{ result: { released: number } }>(
    `/orders/${orderId}/reservations/release`,
    { reason },
  );
export const recordShipment = (
  requestId: string,
  input: { carrier: string; trackingNumber?: string },
) =>
  post<{ shipment: unknown }>(`/fulfillment-requests/${requestId}/ship`, input);
export const recordDelivery = (
  requestId: string,
  input: { receivedBy: string; note?: string },
) =>
  post<{ delivery: unknown }>(
    `/fulfillment-requests/${requestId}/deliver`,
    input,
  );

export const decideAdjustment = (
  id: string,
  decision: "approved" | "rejected",
  note?: string,
) =>
  post<{ result: unknown }>(`/operations/adjustments/${id}/decide`, {
    decision,
    note,
  });
