"use client";

import { del, post, request, SalesApiError } from "@/features/sales/shared/http";

// Shapes returned by the Quotations module (services/api/src/modules/sales/
// quotations). Money arrives as strings (numeric columns) and is formatted at
// the edge, never parsed for arithmetic here -- every total shown is one the
// server computed.
export type QuotationStatusKey =
  | "draft" | "awaiting_approval" | "confirmed" | "sent" | "accepted" | "rejected" | "cancelled" | "superseded" | "expired";

export type SalesQuotationRow = {
  id: string;
  quotation_number: string;
  quotation_date: string;
  valid_until: string | null;
  lifecycle_status: string;
  status: QuotationStatusKey;
  status_label: string;
  is_expired: boolean;
  revision_number: number;
  customer_reference: string | null;
  sent_at: string | null;
  converted_order_id: string | null;
  updated_at: string;
  party_id: string;
  owner_user_id: string | null;
  version_number: number;
  currency_code: string;
  subtotal: string;
  tax_total: string;
  grand_total: string;
  margin_percent?: string;
  customer_name: string | null;
  customer_number: string | null;
  contact_name: string | null;
  opportunity_id: string | null;
  opportunity_name: string | null;
  opportunity_code: string | null;
  owner_name: string | null;
};

export type QuotationView = { key: string; label: string };
export type QuotationCapabilities = Record<string, boolean>;
export type SalesQuotationList = {
  rows: SalesQuotationRow[];
  total: number;
  limit: number;
  offset: number;
  views: QuotationView[];
  capabilities: QuotationCapabilities;
};

export type SalesQuotationLine = {
  id: string;
  sequence: number;
  item_id: string;
  uom_id: string | null;
  warehouse_id: string | null;
  item_code_snapshot: string;
  item_name_snapshot: string;
  description_snapshot: string | null;
  hsn_sac_snapshot: string | null;
  uom_snapshot: string | null;
  quantity: string;
  list_unit_price: string;
  unit_price: string;
  manual_price_override: boolean;
  manual_price_reason: string | null;
  discount_type: "percent" | "amount";
  discount_value: string;
  discount_percent: string;
  discount_amount: string;
  gross_amount: string;
  net_amount: string;
  document_discount_amount: string;
  taxable_amount: string;
  tax_rate: string;
  tax_treatment: string | null;
  tax_category_code: string | null;
  hsn_sac_kind: "hsn" | "sac" | null;
  tax_amount: string;
  line_total: string;
  requested_delivery_date: string | null;
  margin_percent?: string;
};

export type SalesDocumentEvent = {
  id?: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name?: string | null;
};

export type QuotationActions = {
  edit: boolean; confirm: boolean; approve: boolean; rejectApproval: boolean; send: boolean; accept: boolean; reject: boolean; revise: boolean;
  duplicate: boolean; cancel: boolean; createOrder: boolean; print: boolean; expired: boolean;
};

type Snapshot = Record<string, string | null | undefined>;

export type SalesQuotationDetail = {
  quotation: {
    id: string;
    quotation_id: string;
    quotation_number: string;
    quotation_date: string;
    current_version_id: string;
    version_id: string;
    version_number: number;
    lifecycle_status: string;
    status: QuotationStatusKey;
    status_label: string;
    is_expired: boolean;
    approval_status: string;
    acceptance_status: string;
    valid_until: string | null;
    party_id: string;
    contact_id: string | null;
    owner_user_id: string | null;
    owner_name: string | null;
    billing_address_id: string | null;
    shipping_address_id: string | null;
    price_list_id: string | null;
    price_list_code: string | null;
    price_list_name: string | null;
    price_list_tax_inclusive: boolean | null;
    payment_term_id: string | null;
    currency_code: string;
    exchange_rate: string;
    subtotal: string;
    discount_total: string;
    charge_total: string;
    tax_total: string;
    rounding_adjustment: string;
    grand_total: string;
    base_currency_total: string;
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
    tax_treatment: string;
    tax_override_reason: string | null;
    place_of_supply_name: string | null;
    place_of_supply_source: "derived" | "override";
    place_of_supply_reason: string | null;
    supply_nature: "intra_state" | "inter_state" | null;
    margin_percent?: string;
    cost_total?: string;
    customer_snapshot: Snapshot | null;
    contact_snapshot: Snapshot | null;
    billing_address_snapshot: Snapshot | null;
    shipping_address_snapshot: Snapshot | null;
    payment_term_snapshot: Snapshot | null;
    customer_number: string | null;
    customer_reference: string | null;
    customer_notes: string | null;
    internal_notes: string | null;
    terms_and_conditions: string | null;
    delivery_terms: string | null;
    shipping_method: string | null;
    incoterm: string | null;
    supply_type: string | null;
    place_of_supply: string | null;
    source_opportunity_id: string | null;
    source_opportunity_code: string | null;
    source_opportunity_name: string | null;
    source_opportunity_status: string | null;
    revision_number: number;
    revision_of_quotation_id: string | null;
    revision_of_number: string | null;
    revision_root_id: string | null;
    superseded_at: string | null;
    superseded_by_quotation_id: string | null;
    superseded_by_number: string | null;
    converted_order_id: string | null;
    converted_order_number: string | null;
    created_at: string;
    created_by_name: string | null;
    confirmed_at: string | null;
    confirmed_by_name: string | null;
    sent_at: string | null;
    sent_by_name: string | null;
    sent_to: string | null;
    sent_channel: string | null;
    accepted_at: string | null;
    accepted_by_name: string | null;
    rejected_at: string | null;
    rejected_by_name: string | null;
    decision_reference: string | null;
    decision_notes: string | null;
    cancelled_at: string | null;
    cancelled_by_name: string | null;
    cancel_reason: string | null;
  };
  lines: SalesQuotationLine[];
  charges: Array<{ id: string; sequence: number; label: string; calculation_type: string; value: string; amount: string; taxable: boolean }>;
  taxLines: Array<{ tax_type: string; label: string; rate: string; taxable_amount: string; tax_amount: string }>;
  versions: Array<{ id: string; version_number: number; revision_reason: string | null; grand_total: string; currency_code: string; created_at: string; created_by_name: string | null }>;
  events: SalesDocumentEvent[];
  revisions: Array<{ id: string; quotation_number: string; revision_number: number; lifecycle_status: string; valid_until: string | null; grand_total: string; status: { key: string; label: string } }>;
  decisions: Array<{ decision: string; customer_name: string; note: string | null; decided_at: string }>;
  capabilities: QuotationCapabilities;
  actions: QuotationActions;
};

export type QuotationDefaults = {
  quotationDate: string;
  validUntil: string;
  termsAndConditions: string;
  canChangeDate: boolean;
  currencyCode?: string | null;
  contactId?: string | null;
  billingAddressId?: string | null;
  shippingAddressId?: string | null;
  paymentTermId?: string | null;
  priceListId?: string | null;
};

export type QuotationFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };

export type SalesOptions = {
  parties: Array<{
    id: string;
    code: string;
    party_type: string;
    display_name: string;
    currency_code: string | null;
    payment_term_id: string | null;
    credit_limit: string | null;
    default_price_list_id?: string | null;
    tax_treatment?: string | null;
    default_shipping_method?: string | null;
    default_delivery_terms?: string | null;
    default_incoterm?: string | null;
    sales_block?: string;
    sales_block_reason?: string | null;
  }>;
  contacts: Array<{
    id: string;
    party_id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    is_primary: boolean;
    designation: string | null;
    role: string | null;
    is_billing_contact: boolean;
    is_shipping_contact: boolean;
  }>;
  addresses: Array<{
    id: string;
    party_id: string;
    address_type: string;
    line1: string;
    city: string | null;
    is_primary: boolean;
    label: string | null;
    is_default_billing: boolean;
    is_default_shipping: boolean;
  }>;
  items: Array<{
    id: string;
    code: string;
    name: string;
    item_type: string;
    uom_id: string | null;
    sales_uom_id: string | null;
    sales_description: string | null;
    description: string | null;
    track_inventory: boolean;
    standard_cost?: string | null;
    parent_item_id: string | null;
    variant_attributes: Record<string, string> | null;
  }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  itemUomConversions: Array<{
    item_id: string;
    from_uom_id: string;
    to_uom_id: string;
    conversion_factor: string;
  }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  priceLists: Array<{
    id: string;
    code: string;
    name: string;
    currency_code: string;
    tax_inclusive: boolean;
    is_default: boolean;
  }>;
  // The active terms offered for Sales; is_default marks the company default.
  paymentTerms: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    calculation_type: "due_on_receipt" | "net_days" | "custom";
    days: number | null;
    default_due_days: number;
    is_default: boolean;
  }>;
  currencies: Array<{
    code: string;
    name: string;
    symbol: string | null;
    is_base: boolean;
  }>;
  users: Array<{ id: string; full_name: string }>;
  settings?: {
    default_quote_validity_days: number;
    allow_direct_orders: boolean;
  };
  tax: {
    enabled: boolean;
    registrations: Array<{ id: string; code: string; name: string; registrationNumber: string | null; stateCode: string | null; isDefault: boolean }>;
    states: Array<{ code: string; name: string }>;
    supplyTypes: Array<{ code: string; label: string }>;
    canOverrideTreatment: boolean; canOverridePlaceOfSupply: boolean;
  };
  discounts: {
    allowLine: boolean; allowDocument: boolean; allowPercent: boolean; allowAmount: boolean;
    canApplyLine: boolean; canApplyDocument: boolean; limitPercent: number | null; reasonAbovePercent: number | null;
    reasons: Array<{ code: string; label: string }>;
  };
};

type SalesDocumentLineInput = {
  itemId: string;
  quantity: number;
  discountType?: "percent" | "amount";
  discountValue?: number;
  unitPrice?: number;
  uomId?: string | null;
  warehouseId?: string | null;
  description?: string;
  requestedDeliveryDate?: string | null;
  manualPriceReason?: string;
};
export type SalesDocumentInput = {
  partyId: string;
  contactId?: string | null;
  ownerUserId?: string;
  quotationDate?: string | null;
  customerReference?: string | null;
  expectedVersionNumber?: number;
  opportunityId?: string | null;
  billingAddressId?: string | null;
  shippingAddressId?: string | null;
  currencyCode: string;
  priceListId?: string | null;
  paymentTermId?: string | null;
  validUntil?: string | null;
  documentDiscountType?: "percent" | "amount";
  documentDiscountValue?: number;
  discountReasonCode?: string | null;
  discountReasonText?: string | null;
  customerNotes?: string;
  internalNotes?: string;
  termsAndConditions?: string | null;
  deliveryTerms?: string;
  revisionReason?: string;
  shippingMethod?: string;
  incoterm?: string;
  supplyType?: string;
  sellerRegistrationId?: string;
  placeOfSupply?: string;
  placeOfSupplyReason?: string;
  taxOverrideReason?: string;
  idempotencyKey?: string;
  lines: SalesDocumentLineInput[];
  charges?: Array<{
    label: string;
    calculationType: "fixed" | "percentage";
    value: number;
    taxable?: boolean;
  }>;
};

export type SalesDocumentPreview = {
  // The price list the document is priced from, and why (chosen, the customer's, or the default).
  priceList: { id: string; code: string; name: string; currencyCode: string; taxInclusive: boolean; basis: "chosen" | "customer" | "default" } | null;
  totals: {
    subtotal: string;
    grossTotal: string;
    lineDiscountTotal: string;
    documentDiscountType: "percent" | "amount";
    documentDiscountValue: string;
    documentDiscountPercent: string;
    documentDiscountAmount: string;
    taxableTotal: string;
    discountTotal: string;
    chargeTotal: string;
    taxTotal: string;
    roundingAdjustment: string;
    grandTotal: string;
    marginPercent?: string;
  };
  // The tax the server worked out, and why.
  tax: {
    enabled: boolean;
    seller: { id: string; name: string; gstin: string | null; stateCode: string | null; stateName: string | null } | null;
    supplyType: string; derivedSupplyType: string; treatment: string;
    placeOfSupply: { code: string; name: string | null; basis: string; source: "derived" | "override" } | null;
    supplyNature: "intra_state" | "inter_state" | null;
    summary: Array<{ taxType: string; label: string; rate: string; taxableAmount: string; taxAmount: string }>;
  };
  // What the discount rules say about this document; saving enforces them.
  discount: { requestedPercent: string; limitPercent: string | null; limitExceeded: boolean; reasonRequired: boolean; message: string | null };
  lines: Array<{
    sequence: number;
    itemNameSnapshot: string;
    quantity: string;
    unitPrice: string;
    listUnitPrice: string;
    manualPriceOverride: boolean;
    priceMissing: boolean;
    priceMessage: string | null;
    priceSource: string | null;
    discountType: "percent" | "amount";
    discountValue: string;
    discountPercent: string;
    discountAmount: string;
    grossAmount: string;
    netAmount: string;
    documentDiscountAmount: string;
    taxableAmount: string;
    taxRate: string;
    taxTreatment: string;
    taxAmount: string;
    lineTotal: string;
  }>;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type QuotationFilters = {
  view?: string; search?: string; status?: string; partyId?: string; ownerUserId?: string; opportunityId?: string; currencyCode?: string; priceListId?: string;
  dateFrom?: string; dateTo?: string; validFrom?: string; validTo?: string; amountMin?: string; amountMax?: string; sort?: string; direction?: string;
  limit?: number; offset?: number;
};

export const listSalesQuotations = (filters: QuotationFilters = {}) => request<SalesQuotationList>(`/quotations${qs(filters)}`);
export const quotationExportUrl = (filters: QuotationFilters = {}) => `/api/sales/quotations/export${qs({ ...filters, limit: undefined, offset: undefined })}`;
export const getSalesQuotation = (id: string) => request<{ quotation: SalesQuotationDetail }>(`/quotations/${id}`);
export const getQuotationDefaults = (partyId?: string) => request<{ defaults: QuotationDefaults }>(`/quotations/defaults${qs({ partyId })}`);
export const createSalesQuotation = (input: SalesDocumentInput) =>
  post<{ quotation: { id: string; quotation_number: string } }>("/quotations", input);
// Saves changes to a Draft; expectedVersionNumber is the version the editor opened.
export const updateSalesQuotation = (id: string, input: SalesDocumentInput) =>
  request<{ quotation: { id: string; versionNumber: number } }>(`/quotations/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const confirmSalesQuotation = (id: string, expectedVersionNumber?: number) =>
  post<{ result: { status: string; approvalRequired: boolean } }>(`/quotations/${id}/confirm`, { expectedVersionNumber });
export const approveSalesQuotation = (id: string, quotationVersionId?: string) =>
  post<{ result: unknown }>(`/quotations/${id}/approve`, { quotationVersionId });
export const rejectSalesQuotationApproval = (id: string, reason: string) =>
  post<{ result: unknown }>(`/quotations/${id}/reject-approval`, { reason });
// The quotation went out another way (WhatsApp, the customer's email, in person).
export const markSalesQuotationSent = (id: string, input: { recipient?: string; note?: string }) =>
  post<{ result: { status: string } }>(`/quotations/${id}/mark-sent`, input);
// Emails the quotation with its PDF attached.
export const emailSalesQuotation = (id: string, input: { to: string; cc?: string; subject?: string; message?: string }) =>
  post<{ result: { status: string } }>(`/quotations/${id}/email`, input);
// The customer's answer, recorded by staff.
export const recordSalesQuotationDecision = (id: string, input: { decision: "accepted" | "rejected"; reference?: string; notes?: string }) =>
  post<{ result: { decision: string } }>(`/quotations/${id}/decision`, input);
export const cancelSalesQuotation = (id: string, reason: string) =>
  post<{ result: { status: string } }>(`/quotations/${id}/cancel`, { reason });
export const reviseSalesQuotation = (id: string, reason: string, idempotencyKey?: string) =>
  post<{ result: { id: string; quotationNumber: string } }>(`/quotations/${id}/revise`, { reason, idempotencyKey });
export const duplicateSalesQuotation = (id: string, idempotencyKey?: string) =>
  post<{ result: { id: string; quotationNumber: string } }>(`/quotations/${id}/duplicate`, { idempotencyKey });
export const createOrderFromQuotation = (id: string) =>
  post<{ result: { orderId: string; orderNumber: string | null; idempotent: boolean } }>(`/quotations/${id}/sales-order`, {});
export const addSalesQuotationNote = (id: string, note: string) => post<{ result: { added: boolean } }>(`/quotations/${id}/notes`, { note });
export const listSalesQuotationFiles = (id: string) => request<{ files: QuotationFile[] }>(`/quotations/${id}/files`);
// Multipart, so the browser sets the content type and boundary itself.
export async function uploadSalesQuotationFile(id: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch(`/api/sales/quotations/${id}/files`, { method: "POST", body, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be uploaded.", response.status, payload.code, payload);
  return payload as { file: QuotationFile };
}
export const removeSalesQuotationFile = (id: string, fileId: string) => del<{ result: { removed: boolean } }>(`/quotations/${id}/files/${fileId}`);
export const previewSalesDocument = (input: SalesDocumentInput) =>
  post<{ preview: SalesDocumentPreview }>("/documents/preview", input);
export const getSalesOptions = (partyId?: string) =>
  request<{ options: SalesOptions }>(`/options${qs({ partyId })}`);
