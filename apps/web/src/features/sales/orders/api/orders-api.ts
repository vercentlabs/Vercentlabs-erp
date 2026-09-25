"use client";

import { post, request } from "@/features/sales/shared/http";
import type { SalesDocumentEvent, SalesDocumentInput } from "@/features/sales/quotations/api/quotations-api";

// Row shapes mirror listSalesOrders / getSalesOrder in
// services/api/src/modules/sales/index.js. Money arrives as strings and is only
// formatted at the edge -- every figure shown is one the server computed.
export type SalesOrderRow = {
  id: string;
  sales_order_number: string;
  lifecycle_status: string;
  approval_status: string;
  credit_status: string;
  fulfillment_status: string;
  billing_status: string;
  order_date: string | null;
  requested_delivery_date: string | null;
  updated_at: string;
  currency_code: string;
  grand_total: string;
  base_currency_total: string;
  customer_name: string | null;
};

export type SalesOrderLine = {
  id: string;
  sequence: number;
  item_id: string;
  variant_id: string | null;
  variant_sku_snapshot: string | null;
  uom_id: string | null;
  warehouse_id: string | null;
  item_code_snapshot: string;
  item_name_snapshot: string;
  description_snapshot: string | null;
  uom_snapshot: string | null;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  net_amount: string;
  tax_amount: string;
  line_total: string;
  requested_delivery_date: string | null;
  margin_percent?: string;
  confirmed_quantity: string;
  reserved_quantity: string;
  fulfilled_quantity: string;
  invoiced_quantity: string;
  returned_quantity: string;
  cancelled_quantity: string;
  remaining_to_fulfill: string;
  remaining_to_invoice: string;
};

export type SalesOrderHold = { id: string; hold_type: string; reason: string; status: string; placed_at: string; released_at: string | null; release_note: string | null };
export type SalesHandoffRequest = { id: string; request_number: string; status: string; retry_count: number; last_error: string | null; requested_at: string; completed_at: string | null; quantity_basis?: string; carrier?: string | null; tracking_number?: string | null; shipped_at?: string | null; delivered_at?: string | null; received_by?: string | null };
export type SalesOrderVersionSummary = { id: string; version_number: number; amendment_reason: string | null; currency_code: string; grand_total: string; created_at: string; approval_request_id: string | null };

export type SalesOrderDetail = {
  order: {
    sales_order_id: string;
    sales_order_number: string;
    current_version_id: string;
    lifecycle_status: string;
    approval_status: string;
    credit_status: string;
    fulfillment_status: string;
    billing_status: string;
    party_id: string;
    contact_id: string | null;
    billing_address_id: string | null;
    shipping_address_id: string | null;
    company_id: string;
    order_date: string | null;
    requested_delivery_date: string | null;
    source_quotation_id: string | null;
    version_number: number;
    currency_code: string;
    subtotal: string;
    discount_total: string;
    charge_total: string;
    tax_total: string;
    rounding_adjustment: string;
    grand_total: string;
    margin_percent?: string;
    customer_snapshot: { displayName?: string; legalName?: string; gstin?: string } | null;
    payment_term_snapshot: { name?: string } | null;
    customer_po_number: string | null;
    customer_po_date: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    terms_and_conditions: string | null;
    price_list_id: string | null;
    payment_term_id: string | null;
    exchange_rate: string;
  };
  lines: SalesOrderLine[];
  versions: SalesOrderVersionSummary[];
  holds: SalesOrderHold[];
  fulfillmentRequests: SalesHandoffRequest[];
  invoiceRequests: SalesHandoffRequest[];
  events: SalesDocumentEvent[];
};

export type SalesOrderReadiness = { orderId: string; orderNumber: string; versionId: string; health: { readiness?: string; blockers?: Array<{ code?: string; message?: string }>; warnings?: Array<{ code?: string; message?: string }> } & Record<string, unknown> };

export type SalesOrderDocumentInput = SalesDocumentInput & {
  requestedDeliveryDate?: string | null;
  customerPoNumber?: string | null;
  customerPoDate?: string | null;
  amendmentReason?: string;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listSalesOrders = (filters: { status?: string; search?: string; partyId?: string; limit?: number; offset?: number } = {}) => request<{ rows: SalesOrderRow[] }>(`/orders${qs(filters)}`);
export const getSalesOrder = (id: string) => request<{ detail: SalesOrderDetail }>(`/orders/${id}`);
export const createSalesOrder = (input: SalesOrderDocumentInput) => post<{ order: { id: string; sales_order_number: string } }>("/orders", input);
export const amendSalesOrder = (id: string, input: SalesOrderDocumentInput) => post<{ detail: SalesOrderDetail }>(`/orders/${id}/amend`, input);
export const submitSalesOrder = (id: string, assignedTo?: string | null) => post<{ result: { approvalRequired: boolean } }>(`/orders/${id}/submit`, { assignedTo });
export const approveSalesOrder = (id: string, orderVersionId: string) => post<{ result: unknown }>(`/orders/${id}/approve`, { orderVersionId });
export const rejectSalesOrderApproval = (id: string, orderVersionId: string, reason: string) => post<{ result: unknown }>(`/orders/${id}/reject-approval`, { orderVersionId, reason });
export const confirmSalesOrder = (id: string, input: { overrideCredit?: boolean; creditOverrideReason?: string } = {}) => post<{ result: { status: string; creditStatus: string } }>(`/orders/${id}/confirm`, input);
export const placeSalesOrderHold = (id: string, input: { holdType?: string; reason: string }) => post<{ hold: { id: string } }>(`/orders/${id}/hold`, input);
export const releaseSalesOrderHold = (id: string, input: { holdId: string; note?: string }) => post<{ result: unknown }>(`/orders/${id}/hold/release`, input);
export const cancelSalesOrder = (id: string, reason: string) => post<{ result: unknown }>(`/orders/${id}/cancel`, { reason });
export const requestSalesFulfillment = (id: string, idempotencyKey: string) => post<{ request: SalesHandoffRequest }>(`/orders/${id}/fulfillment-request`, { idempotencyKey });
export const requestSalesInvoice = (id: string, idempotencyKey: string, quantityBasis?: "ordered" | "fulfilled") => post<{ request: SalesHandoffRequest }>(`/orders/${id}/invoice-request`, { idempotencyKey, quantityBasis });
export const closeSalesOrder = (id: string) => post<{ result: unknown }>(`/orders/${id}/close`, {});
export const getSalesOrderReadiness = (id: string) => request<{ readiness: SalesOrderReadiness }>(`/orders/${id}/readiness`);

// F044: what an amendment would change and what blocks it.
export type AmendmentImpact = {
  totalBefore: number;
  totalAfter: number;
  totalChange: number;
  creditRecheck: boolean;
  lines: Array<{ item: string; unit: string | null; change: "added" | "removed" | "changed" | "unchanged"; quantityBefore: number; quantityAfter: number; unitPriceBefore: number | null; unitPriceAfter: number | null }>;
  downstream: { active_reservations: number; open_fulfilment_requests: number; open_invoice_requests: number };
  blockers: string[];
};
export const previewAmendmentImpact = (id: string, input: SalesOrderDocumentInput) => post<{ impact: AmendmentImpact }>(`/orders/${id}/amend/impact`, input);
