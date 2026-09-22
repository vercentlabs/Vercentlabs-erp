"use client";

import { post, request } from "@/features/sales/shared/http";

// Row shapes mirror the SELECTs in services/api/src/modules/sales/index.js
// (listQuotations / getQuotation / getSalesOptions). Money arrives as strings
// (numeric columns) and is formatted at the edge, never parsed for arithmetic
// here -- every total shown is one the server computed.
export type SalesQuotationRow = {
  id: string;
  quotation_number: string;
  lifecycle_status: string;
  approval_status: string;
  acceptance_status: string;
  valid_until: string | null;
  updated_at: string;
  version_number: number;
  currency_code: string;
  grand_total: string;
  base_currency_total: string;
  customer_name: string | null;
  owner_user_id: string | null;
};

export type SalesQuotationLine = {
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
  list_unit_price: string;
  unit_price: string;
  discount_percent: string;
  discount_amount: string;
  net_amount: string;
  tax_amount: string;
  line_total: string;
  requested_delivery_date: string | null;
  margin_percent?: string;
};

export type SalesQuotationVersionSummary = { id: string; version_number: number; revision_reason: string | null; grand_total: string; currency_code: string; created_at: string; created_by: string | null };
export type SalesDocumentEvent = { event_type: string; from_status: string | null; to_status: string | null; metadata: Record<string, unknown> | null; occurred_at: string; actor_user_id: string | null };

export type SalesQuotationDetail = {
  quotation: {
    quotation_id: string;
    quotation_number: string;
    current_version_id: string;
    lifecycle_status: string;
    approval_status: string;
    acceptance_status: string;
    valid_until: string | null;
    converted_order_id: string | null;
    party_id: string;
    contact_id: string | null;
    billing_address_id: string | null;
    shipping_address_id: string | null;
    owner_user_id: string | null;
    currency_code: string;
    subtotal: string;
    discount_total: string;
    charge_total: string;
    tax_total: string;
    rounding_adjustment: string;
    grand_total: string;
    margin_percent?: string;
    version_number: number;
    customer_snapshot: { displayName?: string; legalName?: string; gstin?: string } | null;
    payment_term_snapshot: { name?: string } | null;
    customer_notes: string | null;
    internal_notes: string | null;
    terms_and_conditions: string | null;
    delivery_terms: string | null;
    price_list_id: string | null;
    payment_term_id: string | null;
    exchange_rate: string;
  };
  lines: SalesQuotationLine[];
  charges: Array<{ id: string; sequence: number; label: string; calculation_type: string; value: string; amount: string; taxable: boolean }>;
  versions: SalesQuotationVersionSummary[];
  events: SalesDocumentEvent[];
};

export type SalesOptions = {
  companies: Array<{ id: string; name: string; base_currency: string }>;
  parties: Array<{ id: string; code: string; party_type: string; display_name: string; currency_code: string | null; payment_term_id: string | null; credit_limit: string | null }>;
  contacts: Array<{ id: string; party_id: string; first_name: string; last_name: string | null; email: string | null; is_primary: boolean }>;
  addresses: Array<{ id: string; party_id: string; address_type: string; line1: string; city: string | null; is_primary: boolean }>;
  items: Array<{ id: string; code: string; name: string; item_type: string; uom_id: string | null; sales_price: string | null; standard_cost?: string | null }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  itemUomConversions: Array<{ item_id: string; from_uom_id: string; to_uom_id: string; conversion_factor: string }>;
  itemVariants: Array<{ id: string; item_id: string; sku: string; name: string; sales_price: string | null; standard_cost?: string | null }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  priceLists: Array<{ id: string; code: string; name: string; currency_code: string; tax_inclusive: boolean }>;
  paymentTerms: Array<{ id: string; code: string; name: string; default_due_days: number }>;
  currencies: Array<{ code: string; name: string; symbol: string | null; is_base: boolean }>;
  users: Array<{ id: string; full_name: string }>;
  settings?: { default_quote_validity_days: number; allow_direct_orders: boolean };
};

export type SalesDocumentLineInput = { itemId: string; variantId?: string | null; quantity: number; discountPercent?: number; unitPrice?: number; uomId?: string | null; warehouseId?: string | null; description?: string; requestedDeliveryDate?: string | null; manualPriceReason?: string };
export type SalesDocumentInput = {
  partyId: string;
  contactId?: string | null;
  billingAddressId?: string | null;
  shippingAddressId?: string | null;
  currencyCode: string;
  priceListId?: string | null;
  paymentTermId?: string | null;
  validUntil?: string | null;
  headerDiscountPercent?: number;
  customerNotes?: string;
  internalNotes?: string;
  termsAndConditions?: string;
  deliveryTerms?: string;
  revisionReason?: string;
  idempotencyKey?: string;
  lines: SalesDocumentLineInput[];
  charges?: Array<{ label: string; calculationType: "fixed" | "percentage"; value: number; taxable?: boolean }>;
};

export type SalesDocumentPreview = {
  totals: { subtotal: string; discountTotal: string; chargeTotal: string; taxTotal: string; roundingAdjustment: string; grandTotal: string; marginPercent?: string };
  lines: Array<{ sequence: number; itemNameSnapshot: string; quantity: string; unitPrice: string; discountPercent: string; netAmount: string; taxAmount: string; lineTotal: string }>;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listSalesQuotations = (filters: { status?: string; search?: string; partyId?: string; limit?: number; offset?: number } = {}) =>
  request<{ rows: SalesQuotationRow[] }>(`/quotations${qs(filters)}`);
export const getSalesQuotation = (id: string) => request<{ quotation: SalesQuotationDetail }>(`/quotations/${id}`);
export const createSalesQuotation = (input: SalesDocumentInput) => post<{ quotation: { id: string; quotation_number: string } }>("/quotations", input);
export const reviseSalesQuotation = (id: string, input: SalesDocumentInput) => post<{ version: { id: string; version_number: number } }>(`/quotations/${id}/revise`, input);
export const submitSalesQuotation = (id: string, assignedTo?: string | null) => post<{ result: unknown }>(`/quotations/${id}/submit`, { assignedTo });
export const approveSalesQuotation = (id: string, quotationVersionId: string) => post<{ result: unknown }>(`/quotations/${id}/approve`, { quotationVersionId });
export const rejectSalesQuotationApproval = (id: string) => post<{ result: unknown }>(`/quotations/${id}/reject-approval`, {});
export const sendSalesQuotation = (id: string, expiresInDays?: number) => post<{ result: { token: string; expiresAt: string; quotationNumber: string } }>(`/quotations/${id}/send`, { expiresInDays });
export const convertSalesQuotation = (id: string) => post<{ result: { orderId: string; idempotent?: boolean } }>(`/quotations/${id}/convert`, {});
export const compareSalesQuotationVersions = (id: string, left: string, right: string) => request<{ comparison: unknown }>(`/quotations/${id}/compare${qs({ left, right })}`);
export const previewSalesDocument = (input: SalesDocumentInput) => post<{ preview: SalesDocumentPreview }>("/documents/preview", input);
export const getSalesOptions = (partyId?: string) => request<{ options: SalesOptions }>(`/options${qs({ partyId })}`);
