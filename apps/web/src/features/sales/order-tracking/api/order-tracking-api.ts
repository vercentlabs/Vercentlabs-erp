"use client";

import { post, request } from "@/features/sales/shared/http";

// What the order tracking service returns (services/api/src/modules/sales/
// order-tracking): where one sales order stands, derived from its own
// documents. Nothing here is typed by a user: each dimension is worked out
// by the server, the same way for the order page, the list and the reports.
export type ReservationStatus = "not_required" | "not_reserved" | "partially_reserved" | "fully_reserved";
export type FulfillmentStatus = "not_required" | "not_delivered" | "partially_delivered" | "delivered" | "complete" | "cancelled";
export type InvoiceStatus = "not_invoiced" | "partially_invoiced" | "fully_invoiced";
export type PaymentStatus = "not_invoiced" | "unpaid" | "partially_paid" | "paid" | "overdue";

export type TrackingLine = {
  lineId: string; sequence: number; itemName: string; unit: string | null; kind: "stock" | "goods" | "service"; ordered: number; reserved: number | null; delivered: number | null;
  returned: number | null; cancelled: number; invoiced: number; remainingToReserve: number | null; remainingToDeliver: number | null; invoiceableNow: number; remainingToInvoice: number;
  netWithCustomer: number | null; returnable: number | null;
};
export type TimelineEvent = { id: string; at: string; kind: "order" | "reservation" | "delivery" | "invoice" | "payment" | "return" | "credit" | "refund"; type: string; text: string; actor: string | null; documentId: string | null };
export type OrderTracking = {
  order: {
    id: string; number: string; customerName: string | null; partyId: string; status: string; statusLabel: string; orderDate: string | null; requestedDeliveryDate: string | null;
    currencyCode: string; orderValue: number; outcome: "cancelled_before_execution" | "closed_manually" | "closed_with_cancellations" | "completed" | null; closedManually: boolean;
    closeReason: string | null; cancelReason: string | null;
  };
  applies: { inventory: boolean; fulfillment: boolean; invoicing: boolean; payment: boolean };
  reservation: { status: ReservationStatus; label: string; applies: boolean; required: number; reserved: number; remainingToReserve: number; percent: number };
  fulfillment: {
    status: FulfillmentStatus; label: string; applies: boolean; ordered: number; delivered: number; cancelled: number; remaining: number; returned: number; netWithCustomer: number;
    percent: number; overdue: boolean;
  };
  invoicing: {
    status: InvoiceStatus; label: string; basis: "ordered" | "delivered"; ordered: number; cancelled: number; invoiced: number; remaining: number; invoiceableNow: number; pendingDelivery: number;
    percent: number; remainingValue: number; invoiceableNowValue: number; orderValue: number;
  };
  // Finance figures are present only for those allowed to see an invoice's payments.
  payment: { status: PaymentStatus; label: string; invoiced?: number; credits?: number; netBilled?: number; paid?: number; balanceDue?: number; overdueBalance?: number; percent?: number };
  returns: { delivered: number; returned: number; netWithCustomer: number; count: number; awaitingCredit: number };
  credits: { invoiced?: number; credited?: number; netBilled?: number; count: number };
  refunds: { credits: number; refunded: number; remainingCustomerCredit: number; count: number } | null;
  lines: TrackingLine[];
  flags: { deliveryOverdue: boolean; readyToDeliver: boolean; readyToInvoice: boolean; readyToClose: boolean };
  warnings: Array<{ code: string; label: string; detail: string }>;
  milestones: Record<"createdAt" | "confirmedAt" | "firstReservedAt" | "firstDeliveryAt" | "lastDeliveryAt" | "firstInvoiceAt" | "fullyInvoicedAt" | "closedAt" | "cancelledAt", string | null>;
  documents: {
    quotation: { id: string; number: string } | null;
    reservations: { active: number; total: number };
    deliveries: Array<{ id: string; number: string; status: string; dispatch_date: string | null; dispatched_at: string | null; delivered_at: string | null; quantity: number }>;
    invoices: Array<{ id: string; number: string; status: string; invoice_date: string; due_date: string; overdue: boolean; grand_total: number | null; outstanding_amount: number | null; paymentState: string }>;
    receipts: Array<{ id: string; receipt_id: string; number: string; receipt_date: string; amount: number; invoice_number: string }>;
    returns: Array<{ id: string; number: string; status: string; return_date: string; quantity: number; awaiting_credit: boolean }>;
    creditNotes: Array<{ id: string; number: string; status: string; invoice_date: string; invoice_number: string; grand_total: number | null; applied: number | null; refunded: number | null; remaining: number | null }>;
    refunds: Array<{ id: string; number: string; status: string; refund_date: string; amount: number; credit_note_number: string }>;
    counts: Record<"deliveries" | "invoices" | "receipts" | "returns" | "creditNotes" | "refunds", number>;
  };
  timeline: TimelineEvent[];
  actions: { close: boolean; reopenClosed: boolean; viewMoney: boolean; openRefunds: boolean; viewReservations: boolean };
};

export const getOrderTracking = (orderId: string) => request<{ tracking: OrderTracking }>(`/orders/${orderId}/tracking`);
export const closeOrder = (orderId: string, reason: string) => post<{ result: { status: string; uninvoiced?: Array<{ item: string; quantity: number; unit: string | null }> } }>(`/orders/${orderId}/close`, { reason });
export const reopenClosedOrder = (orderId: string, reason: string) => post<{ result: { status: string } }>(`/orders/${orderId}/reopen-closed`, { reason });
