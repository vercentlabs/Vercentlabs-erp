"use client";

import { del, post, request, SalesApiError } from "@/features/sales/shared/http";
import type { SalesDocumentEvent, SalesDocumentInput, SalesDocumentPreview } from "@/features/sales/quotations/api/quotations-api";

// Shapes returned by the Sales Orders module (services/api/src/modules/sales/
// orders). Money arrives as strings and is formatted at the edge; quantities
// ordered, reserved, delivered, invoiced and remaining are worked out by the
// server from the reservations, deliveries and invoices themselves.
export type OrderStatusKey = "draft" | "confirmed" | "cancelled" | "closed";
// Delivery only: reservation has its own status.
export type FulfillmentKey = "not_delivered" | "partially_delivered" | "delivered" | "cancelled" | "not_required";
export type InvoicingKey = "not_invoiced" | "partially_invoiced" | "fully_invoiced";
// Whether the current order confirmation went out; separate from the order's status.
export type ConfirmationKey = "none" | "not_sent" | "sent" | "acknowledged" | "superseded";
type DisplayStatuses = {
  status: OrderStatusKey; statusLabel: string;
  confirmation: ConfirmationKey; confirmationLabel: string;
  fulfillment: FulfillmentKey; fulfillmentLabel: string;
  invoicing: InvoicingKey; invoicingLabel: string;
};

export type SalesOrderRow = DisplayStatuses & {
  id: string;
  sales_order_number: string;
  order_date: string | null;
  requested_delivery_date: string | null;
  party_id: string;
  owner_user_id: string | null;
  source_quotation_id: string | null;
  source_quotation_number: string | null;
  updated_at: string;
  version_number: number;
  currency_code: string;
  grand_total: string;
  customer_po_number: string | null;
  customer_name: string | null;
  // The requested delivery date has passed with goods still to deliver.
  delivery_overdue: boolean;
  customer_number: string | null;
  owner_name: string | null;
};

export type SalesOrderCapabilities = Record<string, boolean>;
export type SalesOrderList = {
  rows: SalesOrderRow[];
  total: number;
  limit: number;
  offset: number;
  views: Array<{ key: string; label: string }>;
  capabilities: SalesOrderCapabilities;
};

export type SalesOrderLine = {
  id: string;
  sequence: number;
  item_id: string;
  variant_id: string | null;
  uom_id: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  item_code_snapshot: string;
  item_name_snapshot: string;
  description_snapshot: string | null;
  hsn_sac_snapshot: string | null;
  hsn_sac_kind: "hsn" | "sac" | null;
  uom_snapshot: string | null;
  quantity: string;
  list_unit_price: string;
  unit_price: string;
  manual_price_override: boolean;
  manual_price_reason: string | null;
  discount_type: "percent" | "amount";
  discount_value: string;
  discount_amount: string;
  gross_amount: string;
  net_amount: string;
  document_discount_amount: string;
  taxable_amount: string;
  tax_rate: string;
  tax_treatment: string | null;
  tax_amount: string;
  line_total: string;
  source_quotation_line_id: string | null;
  margin_percent?: string;
  // A service is invoiced but never delivered or reserved.
  is_service: boolean;
  is_stock_tracked: boolean;
  // Came from the quotation: its price, discount and tax are the agreed ones.
  is_quoted: boolean;
  ordered_quantity: number;
  cancelled_quantity: number;
  reserved_quantity: number;
  delivered_quantity: number;
  invoiced_quantity: number;
  returned_quantity: number;
  remaining_to_deliver: number;
  remaining_to_invoice: number;
  // On the company's invoicing basis: what can be invoiced now, what waits for delivery, and what draft invoices bill (not yet invoiced).
  invoiceable_now: number;
  pending_delivery_to_invoice: number;
  on_draft_invoices: number;
};

// Every delivery of the order, whatever its state; only dispatched and delivered ones count as delivered.
export type SalesOrderDelivery = {
  id: string;
  delivery_number: string;
  delivery_status: "draft" | "ready" | "dispatched" | "delivered" | "cancelled";
  statusLabel: string;
  dispatch_date: string | null;
  expected_delivery_date: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  delivered_at: string | null;
  received_by: string | null;
  warehouse_name: string | null;
  created_by_name: string | null;
  lines: Array<{ sales_order_line_id: string; quantity: string; uom_snapshot: string | null; item_name_snapshot: string }>;
};
export type SalesOrderInvoice = {
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  invoice_date: string | null;
  grand_total: string;
  tax_total: string;
  outstanding_amount: string;
  currency_code: string;
};

export type SalesOrderActions = {
  edit: boolean; confirm: boolean; reopen: boolean; reserve: boolean; release: boolean; deliver: boolean; invoice: boolean; cancel: boolean;
  cancelRemaining: boolean; print: boolean; viewConfirmation: boolean; sendConfirmation: boolean; markConfirmationSent: boolean; acknowledgeConfirmation: boolean;
};

// One revision of the order's confirmation: what was confirmed is kept unchanged; its PDF is built from it.
export type OrderConfirmation = {
  id: string;
  version: number;
  current: boolean;
  status: ConfirmationKey;
  statusLabel: string;
  confirmed_at: string;
  confirmed_by_name: string | null;
  sent_at: string | null;
  sent_to: string | null;
  sent_by_name: string | null;
  acknowledged_at: string | null;
  acknowledgement_reference: string | null;
  acknowledgement_note: string | null;
  acknowledged_by_name: string | null;
  superseded_at: string | null;
  superseded_reason: string | null;
  superseded_by_name: string | null;
  variance_reason: string | null;
  quotation_variance: ConfirmationCheck["quotation"];
  grand_total: string | null;
  sends: Array<{ id: string; channel: string; channelLabel: string; recipients: string | null; subject: string | null; note: string | null; pdf_kept: boolean; sent_at: string; sent_by_name: string | null }>;
};

// What confirming a draft would find; nothing is changed by asking.
export type ConfirmationCheck = {
  orderId: string; orderNumber: string; status: string; versionNumber: number; ready: boolean; problems: string[]; warnings: string[];
  totals: { saved: string | null; recalculated: string | null; currencyCode: string };
  quotation: null | {
    quotationId: string; quotationNumber: string; quotationTotal: string; orderTotal: string; stillAccepted: boolean; differs: boolean;
    changes: Array<{ item: string; change: "removed" | "quantity" | "added"; from: number; to: number; unit: string | null }>;
  };
  varianceNeedsPermission: boolean;
  shortages: Array<{ itemName: string; unit: string | null; required: number; available: number | null; shortage: number | null; problem: string | null }>;
  availabilitySummary: string | null;
  availabilityCheckedAt: string | null;
  reservesOnConfirm: boolean;
  nextConfirmationVersion: number;
};
export type ConfirmResult = {
  orderId: string; confirmed: boolean; status: string; changed: boolean; problems?: string[]; warnings?: string[]; confirmationVersion?: number | null;
  reservation?: ReservationOutcome[];
};
export type DuplicatePurchaseOrder = { id: string; number: string; status: string; orderDate: string | null };

type Snapshot = Record<string, string | null | undefined>;

export type SalesOrderDetail = {
  order: DisplayStatuses & {
    id: string;
    sales_order_number: string;
    current_version_id: string;
    version_number: number;
    lifecycle_status: string;
    party_id: string;
    contact_id: string | null;
    owner_user_id: string | null;
    owner_name: string | null;
    billing_address_id: string | null;
    shipping_address_id: string | null;
    order_date: string | null;
    requested_delivery_date: string | null;
    default_warehouse_id: string | null;
    default_warehouse_name: string | null;
    source_quotation_id: string | null;
    source_quotation_number: string | null;
    source_opportunity_id: string | null;
    source_opportunity_code: string | null;
    source_opportunity_name: string | null;
    price_list_id: string | null;
    price_list_name: string | null;
    price_list_tax_inclusive: boolean | null;
    payment_term_id: string | null;
    currency_code: string;
    exchange_rate: string;
    subtotal: string;
    discount_total: string;
    gross_total: string;
    line_discount_total: string;
    document_discount_type: "percent" | "amount";
    document_discount_value: string;
    document_discount_amount: string;
    taxable_total: string;
    discount_reason_code: string | null;
    discount_reason_text: string | null;
    seller_registration_id: string | null;
    seller_snapshot: { name?: string; gstin?: string | null; stateCode?: string | null; stateName?: string | null } | null;
    supply_type: string | null;
    tax_treatment: string;
    tax_override_reason: string | null;
    place_of_supply: string | null;
    place_of_supply_name: string | null;
    place_of_supply_source: "derived" | "override";
    place_of_supply_reason: string | null;
    supply_nature: "intra_state" | "inter_state" | null;
    charge_total: string;
    tax_total: string;
    rounding_adjustment: string;
    grand_total: string;
    margin_percent?: string;
    customer_snapshot: Snapshot | null;
    contact_snapshot: Snapshot | null;
    billing_address_snapshot: Snapshot | null;
    shipping_address_snapshot: Snapshot | null;
    payment_term_snapshot: Snapshot | null;
    customer_number: string | null;
    customer_status: string | null;
    sales_block: string | null;
    sales_block_reason: string | null;
    customer_po_number: string | null;
    customer_po_date: string | null;
    customer_reference: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    terms_and_conditions: string | null;
    created_at: string;
    created_by_name: string | null;
    confirmed_at: string | null;
    confirmed_by_name: string | null;
    cancelled_at: string | null;
    cancelled_by_name: string | null;
    cancel_reason_code: string | null;
    cancel_reason: string | null;
    closed_at: string | null;
    confirmation_version: number;
    reservation: ReservationStatusKey;
    reservationLabel: string;
  };
  lines: SalesOrderLine[];
  taxLines: Array<{ tax_type: string; label: string; rate: string; taxable_amount: string; tax_amount: string }>;
  deliveries: SalesOrderDelivery[];
  invoices: SalesOrderInvoice[];
  // The physical lines together: ordered, dispatched, cancelled, returned and left to deliver, and the share of what is still ordered that went out.
  delivery: { deliverable: boolean; ordered: number; delivered: number; cancelled: number; returned: number; remaining: number; percent: number; overdue: boolean };
  invoicing: { basis: "ordered" | "delivered"; orderedValue: number; invoicedValue: number; remainingValue: number; invoiceableNowValue: number };
  versions: Array<{ id: string; version_number: number; change_note: string | null; grand_total: string; currency_code: string; created_at: string; created_by_name: string | null }>;
  confirmations: OrderConfirmation[];
  events: SalesDocumentEvent[];
  duplicatePurchaseOrders: DuplicatePurchaseOrder[];
  cancelReasons: Array<{ code: string; label: string }>;
  capabilities: SalesOrderCapabilities;
  actions: SalesOrderActions;
};

export type SalesOrderDefaults = {
  orderDate: string;
  directOrdersAllowed: boolean;
  reservesOnConfirm: boolean;
  currencyCode?: string | null;
  contactId?: string | null;
  billingAddressId?: string | null;
  shippingAddressId?: string | null;
  ownerUserId?: string | null;
  paymentTermId?: string | null;
  priceListId?: string | null;
  // Why an order cannot be placed for this customer, when it cannot.
  blocked?: string | null;
};

// Stock availability now, worked out from Inventory: never stored, never a promise. Only a reservation commits stock.
export type AvailabilityResultKey = "available" | "partially_available" | "unavailable" | "not_required" | "not_tracked" | "no_warehouse";
export type AlternativeWarehouse = { warehouseId: string; warehouseCode: string; warehouseName: string; available: number; onHand?: number };
export type LineAvailability = {
  lineId: string; sequence: number; itemId: string; itemName: string; unit: string | null; isService: boolean; stockTracked: boolean;
  ordered: number; delivered: number; cancelled: number; reserved: number;
  remaining?: number; unreservedDemand?: number; baseUnit?: string | null; conversionFactor?: number;
  warehouseId?: string | null; warehouseName?: string | null; warehouseSource?: "line" | "order_default" | null;
  onHand?: number; reservedByOthers?: number; unusable?: number; available?: number; reservable?: number; shortage?: number;
  baseRequired?: number; baseAvailable?: number;
  result: AvailabilityResultKey; resultLabel: string; problem?: string | null; alternatives?: AlternativeWarehouse[];
};
export type SalesOrderAvailability = {
  orderId: string; orderNumber: string; status: string; checkedAt: string; informational: boolean;
  summary: "fully_available" | "partially_available" | "unavailable" | "not_required"; summaryLabel: string; lines: LineAvailability[]; shortages: number;
};
export type ReservationOutcome = {
  lineId: string; itemName: string; unit?: string | null; wanted: number; reserved: number; shortage?: number; reservations?: string[]; warehouseName?: string; problem: string | null;
};
export type ReservationStatusKey = "not_required" | "not_reserved" | "partially_reserved" | "fully_reserved";
export type ReservationResult = { orderId: string; lines: ReservationOutcome[]; reservedLines: number; reservationStatus: ReservationStatusKey; replayed: boolean };
// One reservation record: what it reserved, still holds, consumed (by which delivery) and released, in the line's unit.
export type StockReservationRecord = {
  id: string; reservationNumber: string | null; status: "active" | "consumed" | "released" | "cancelled"; statusLabel: string; lineId: string; itemName: string; unit: string | null;
  reserved: number; active: number; consumed: number; released: number; warehouseName: string; location: string | null; batch: string | null;
  reservedAt: string; reservedByName: string | null; releasedAt: string | null; releasedByName: string | null; releaseReason: string | null; daysHeld: number | null; stale: boolean;
  consumptions: Array<{ deliveryNumber: string | null; quantity: number; consumedAt: string }>;
};
export const RELEASE_REASONS = [
  { code: "customer_delay", label: "Customer delay" }, { code: "warehouse_reassignment", label: "Warehouse reassignment" }, { code: "order_amendment", label: "Order amendment" },
  { code: "reservation_correction", label: "Reservation correction" }, { code: "other", label: "Other" },
];

export type OrderFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };

export type SalesOrderDocumentInput = Omit<SalesDocumentInput, "lines"> & {
  orderDate?: string | null;
  requestedDeliveryDate?: string | null;
  customerPoNumber?: string | null;
  customerPoDate?: string | null;
  defaultWarehouseId?: string | null;
  // An existing line of the order carries its id, so a quoted line keeps its quoted price.
  lines: Array<SalesDocumentInput["lines"][number] & { salesOrderLineId?: string }>;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type OrderFilters = {
  view?: string; search?: string; status?: string; confirmation?: string; fulfillment?: string; invoicing?: string; partyId?: string; ownerUserId?: string; warehouseId?: string;
  currencyCode?: string; quotationId?: string; opportunityId?: string; productId?: string; source?: string; dateFrom?: string; dateTo?: string;
  deliveryFrom?: string; deliveryTo?: string; sort?: string; direction?: string; limit?: number; offset?: number;
};
type QuantityLine = { salesOrderLineId: string; quantity: number };

export const listSalesOrders = (filters: OrderFilters = {}) => request<SalesOrderList>(`/orders${qs(filters)}`);
export const salesOrderExportUrl = (filters: OrderFilters = {}) => `/api/sales/orders/export${qs({ ...filters, limit: undefined, offset: undefined })}`;
export const getSalesOrder = (id: string) => request<{ order: SalesOrderDetail }>(`/orders/${id}`);
export const getSalesOrderDefaults = (partyId?: string) => request<{ defaults: SalesOrderDefaults }>(`/orders/defaults${qs({ partyId })}`);
export const createSalesOrder = (input: SalesOrderDocumentInput) =>
  post<{ order: { id: string; sales_order_number: string; duplicatePurchaseOrders: DuplicatePurchaseOrder[] } }>("/orders", input);
// Saves changes to a Draft; expectedVersionNumber is the version the editor opened.
export const updateSalesOrder = (id: string, input: SalesOrderDocumentInput) =>
  request<{ order: { id: string; versionNumber: number; duplicatePurchaseOrders: DuplicatePurchaseOrder[] } }>(`/orders/${id}`, { method: "PATCH", body: JSON.stringify(input) });
// The totals a save of the draft would store; quoted lines keep their quoted price.
export const previewSalesOrder = (id: string, input: SalesOrderDocumentInput) => post<{ preview: SalesDocumentPreview }>(`/orders/${id}/preview`, input);

// Confirming: checked first (nothing changes), then confirmed against the version reviewed.
export const getConfirmationCheck = (id: string) => request<{ check: ConfirmationCheck }>(`/orders/${id}/confirmation/check`);
export const confirmSalesOrder = (id: string, input: { expectedVersionNumber: number; quotationVarianceReason?: string }) =>
  post<{ result: ConfirmResult }>(`/orders/${id}/confirm`, input);
export const reopenSalesOrder = (id: string, reason: string) => post<{ result: { status: string } }>(`/orders/${id}/reopen`, { reason });
export const cancelSalesOrder = (id: string, input: { reasonCode?: string; reason?: string }) => post<{ result: { status: string } }>(`/orders/${id}/cancel`, input);
export const cancelSalesOrderRemaining = (id: string, input: { lines?: QuantityLine[]; reasonCode?: string; reason?: string }) =>
  post<{ result: unknown }>(`/orders/${id}/cancel-remaining`, input);

export const getSalesOrderAvailability = (id: string) => request<{ availability: SalesOrderAvailability }>(`/orders/${id}/availability`);
// The warehouse a confirmed line ships from; what it held in the old one is released.
export const changeLineWarehouse = (id: string, lineId: string, input: { warehouseId: string; reason?: string }) =>
  post<{ result: { changed: boolean; reservationsReleased: number } }>(`/orders/${id}/lines/${lineId}/warehouse`, input);
// Reserve Available / Remaining for the order (or lines), a chosen quantity of one line, and releases with a reason.
export const reserveSalesOrderStock = (id: string, input: { lineIds?: string[]; idempotencyKey?: string } = {}) => post<{ result: ReservationResult }>(`/orders/${id}/reserve`, input);
export const reserveSalesOrderLine = (id: string, lineId: string, input: { quantity?: number; idempotencyKey?: string }) =>
  post<{ result: ReservationResult }>(`/orders/${id}/lines/${lineId}/reserve`, input);
export const releaseSalesOrderReservation = (id: string, input: { lineId?: string; quantity?: number; reasonCode: string; reason?: string }) =>
  post<{ result: { released: number } }>(`/orders/${id}/release`, input);
export const listSalesOrderReservations = (id: string) => request<{ reservations: StockReservationRecord[] }>(`/orders/${id}/reservations`);


// The current confirmation: emailed with its PDF, marked as sent another way, acknowledged by the customer.
export const sendOrderConfirmation = (id: string, input: { to: string; cc?: string; subject?: string; message?: string; idempotencyKey: string }) =>
  post<{ result: { sentTo: string; version: number } }>(`/orders/${id}/confirmation/send`, input);
export const markConfirmationSent = (id: string, input: { channel: string; recipient?: string; note?: string; idempotencyKey?: string }) =>
  post<{ result: unknown }>(`/orders/${id}/confirmation/mark-sent`, input);
export const recordConfirmationAcknowledgement = (id: string, input: { reference?: string; note?: string; acknowledgedAt?: string }) =>
  post<{ result: { changed: boolean } }>(`/orders/${id}/confirmation/acknowledge`, input);
// PDFs: the order's current confirmation (or a draft), and any single revision.
export const orderPdfUrl = (id: string, inline = false) => `/api/documents/sales.order/${id}/pdf${inline ? "?disposition=inline" : ""}`;
export const confirmationPdfUrl = (confirmationId: string, inline = false) => `/api/documents/sales.order.confirmation/${confirmationId}/pdf${inline ? "?disposition=inline" : ""}`;
export const addSalesOrderNote = (id: string, note: string) => post<{ result: { added: boolean } }>(`/orders/${id}/notes`, { note });
export const listSalesOrderFiles = (id: string) => request<{ files: OrderFile[] }>(`/orders/${id}/files`);
// Multipart, so the browser sets the content type and boundary itself.
export async function uploadSalesOrderFile(id: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/sales/orders/${id}/files`, { method: "POST", body, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be uploaded.", response.status, payload.code, payload);
  return payload as { file: OrderFile };
}
export const removeSalesOrderFile = (id: string, fileId: string) => del<{ result: { removed: boolean } }>(`/orders/${id}/files/${fileId}`);
