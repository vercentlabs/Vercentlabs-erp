"use client";

import { del, post, request, SalesApiError } from "@/features/sales/shared/http";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

// Shapes returned by the Deliveries module (services/api/src/modules/sales/
// deliveries). Quantities left to deliver are worked out by the server; a
// delivery only ever says what it carries.
export type DeliveryStatusKey = "draft" | "ready" | "dispatched" | "delivered" | "cancelled";
export type DeliveryInvoicingKey = "not_invoiced" | "partially_invoiced" | "fully_invoiced";
type Snapshot = Record<string, string | null | undefined> | null;

export type DeliveryRow = {
  id: string;
  delivery_number: string;
  status: DeliveryStatusKey;
  statusLabel: string;
  shipment: string;
  sales_order_id: string;
  sales_order_number: string;
  party_id: string | null;
  customer_name: string | null;
  warehouse_name: string | null;
  ship_to_city: string | null;
  ship_to_label: string | null;
  dispatch_date: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  customer_po_number: string | null;
  requested_at: string;
  line_count: number;
  total_quantity: string;
  // What the order lines on it ordered: "6 of 10".
  ordered_quantity: string;
};

export type DeliveryCapabilities = Record<"view" | "viewAll" | "create" | "edit" | "dispatch" | "deliver" | "cancel" | "print" | "changeWarehouse" | "invoice", boolean>;
export type DeliveryList = {
  rows: DeliveryRow[];
  total: number;
  limit: number;
  offset: number;
  views: Array<{ key: string; label: string }>;
  capabilities: DeliveryCapabilities;
};

export type DeliveryLine = {
  id: string;
  sales_order_line_id: string;
  sequence: number | null;
  item_id: string;
  item_code_snapshot: string | null;
  item_name_snapshot: string;
  description_snapshot: string | null;
  quantity: number;
  uom_snapshot: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  stock_issued: boolean;
  ordered_quantity: string | null;
  previously_delivered_quantity: string | null;
  invoiced_quantity: number;
  consumed_reservations: Array<{ reservation: string | null; quantity: string }>;
  // The order line as it stands now.
  ordered_now: number;
  cancelled_now: number;
  delivered_now: number;
  reserved_now: number;
  remaining_now: number;
  open_elsewhere: number;
};

export type DeliveryActions = Record<
  "edit" | "editShipment" | "changeAddress" | "changeWarehouse" | "markReady" | "backToDraft" | "dispatch" | "markDelivered" | "cancel" | "print" | "createInvoice" | "uploadProof",
  boolean
>;

export type DeliveryDetail = {
  delivery: {
    id: string;
    request_number: string;
    status: DeliveryStatusKey;
    statusLabel: string;
    shipment: string;
    invoicing: DeliveryInvoicingKey;
    invoicingLabel: string;
    version: number;
    sales_order_id: string;
    sales_order_number: string;
    order_status: string;
    party_id: string | null;
    customer_number: string | null;
    customer_snapshot: Snapshot;
    contact_id: string | null;
    contact_snapshot: Snapshot;
    shipping_address_id: string | null;
    shipping_address_snapshot: Snapshot;
    customer_po_number: string | null;
    warehouse_id: string | null;
    warehouse_name: string | null;
    warehouse_code: string | null;
    dispatch_date: string | null;
    expected_delivery_date: string | null;
    requested_delivery_date: string | null;
    carrier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    vehicle_reference: string | null;
    package_count: number | null;
    package_notes: string | null;
    delivery_instructions: string | null;
    internal_notes: string | null;
    requested_at: string;
    created_by_name: string | null;
    ready_at: string | null;
    ready_by_name: string | null;
    dispatched_at: string | null;
    dispatched_by_name: string | null;
    delivered_at: string | null;
    delivered_by_name: string | null;
    received_by: string | null;
    delivery_note: string | null;
    cancelled_at: string | null;
    cancelled_by_name: string | null;
    cancel_reason_code: string | null;
    cancel_reason: string | null;
    owner_name: string | null;
    source_quotation_id: string | null;
    source_quotation_number: string | null;
    line_count: number;
    total_quantity: number;
  };
  lines: DeliveryLine[];
  invoices: Array<{ id: string; invoice_number: string; status: string; invoice_date: string | null; grand_total: string; currency_code: string }>;
  stockMovements: Array<{ id: string; movement_number: string | null; quantity: string; created_at: string; item_name: string; warehouse_name: string; location_code: string | null }>;
  events: SalesDocumentEvent[];
  cancelReasons: Array<{ code: string; label: string }>;
  actions: DeliveryActions;
};

export type DeliveryProposal = {
  orderId: string;
  canDeliver: boolean;
  lines: Array<{
    salesOrderLineId: string; itemName: string; unit: string | null; ordered: number; delivered: number; cancelled: number; reserved: number; remaining: number;
    openElsewhere: number; assignable: number; suggested: number; stockTracked: boolean; warehouseId: string | null; warehouseName: string | null;
  }>;
  services: Array<{ salesOrderLineId: string; itemName: string; note: string }>;
};

export type DeliveryFilters = {
  view?: string; search?: string; status?: string; partyId?: string; warehouseId?: string; salesOrderId?: string; carrier?: string; ownerUserId?: string;
  dispatchFrom?: string; dispatchTo?: string; expectedFrom?: string; expectedTo?: string; sort?: string; direction?: string; limit?: number; offset?: number;
};
export type DeliveryFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
type QuantityLine = { salesOrderLineId: string; quantity: number };
export type ShipmentInput = {
  carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null; vehicleReference?: string | null; expectedDeliveryDate?: string | null;
  packageCount?: number | null; packageNotes?: string | null;
};

const qs = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const listDeliveries = (filters: DeliveryFilters) => request<DeliveryList>(`/deliveries${qs(filters)}`);
export const getDelivery = (id: string) => request<{ delivery: DeliveryDetail }>(`/deliveries/${id}`);

// From a confirmed order: what a delivery would carry, and a new Draft.
export const getDeliveryProposal = (orderId: string) => request<{ proposal: DeliveryProposal }>(`/orders/${orderId}/deliveries`);
export const createDelivery = (orderId: string, input: { idempotencyKey: string; lines: QuantityLine[]; warehouseId?: string; deliveryInstructions?: string; internalNotes?: string }) =>
  post<{ result: { deliveryId: string; deliveryNumber: string; status: DeliveryStatusKey; replayed: boolean } }>(`/orders/${orderId}/deliveries`, input);

export const updateDraftDelivery = (id: string, input: {
  expectedVersion?: number; lines?: QuantityLine[]; shippingAddressId?: string; addressChangeReason?: string; contactId?: string | null; expectedDeliveryDate?: string | null;
  deliveryInstructions?: string | null; internalNotes?: string | null; packageCount?: number | null; packageNotes?: string | null;
}) => request<{ result: { version: number; changed: boolean } }>(`/deliveries/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const markDeliveryReady = (id: string, expectedVersion?: number) => post<{ result: unknown }>(`/deliveries/${id}/ready`, { expectedVersion });
export const returnDeliveryToDraft = (id: string, expectedVersion?: number) => post<{ result: unknown }>(`/deliveries/${id}/draft`, { expectedVersion });
export const dispatchDelivery = (id: string, input: ShipmentInput & { dispatchDate?: string; expectedVersion?: number }) =>
  post<{ result: { deliveryNumber: string; replayed: boolean } }>(`/deliveries/${id}/dispatch`, input);
export const markDeliveryDelivered = (id: string, input: { deliveredAt?: string; receivedBy?: string; note?: string }) => post<{ result: unknown }>(`/deliveries/${id}/deliver`, input);
export const cancelDelivery = (id: string, input: { reasonCode: string; reason?: string }) => post<{ result: unknown }>(`/deliveries/${id}/cancel`, input);
export const updateShipmentDetails = (id: string, input: ShipmentInput & { expectedVersion?: number }) => post<{ result: { changed: boolean } }>(`/deliveries/${id}/shipment`, input);
export const changeDeliveryWarehouse = (id: string, input: { warehouseId: string; reason?: string }) => post<{ result: unknown }>(`/deliveries/${id}/warehouse`, input);

export const deliveryNotePdfUrl = (id: string, inline = false) => `/api/documents/sales.delivery/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const listDeliveryFiles = (id: string) => request<{ files: DeliveryFile[] }>(`/deliveries/${id}/files`);
export const deliveryFileUrl = (id: string, fileId: string) => `/api/sales/deliveries/${id}/files/${fileId}`;
// Multipart, so the browser sets the content type and boundary itself.
export async function uploadDeliveryFile(id: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/sales/deliveries/${id}/files`, { method: "POST", body, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be uploaded.", response.status, payload.code, payload);
  return payload as { file: DeliveryFile };
}
export const removeDeliveryFile = (id: string, fileId: string) => del<{ result: { removed: boolean } }>(`/deliveries/${id}/files/${fileId}`);
