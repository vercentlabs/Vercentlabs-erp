export declare const SALES_QUOTATION_STATUSES: readonly string[];
export declare const SALES_ORDER_STATUSES: readonly string[];
export declare const SALES_APPROVAL_STATUSES: readonly string[];
export declare const SALES_CREDIT_STATUSES: readonly string[];
export declare const SALES_FULFILLMENT_STATUSES: readonly string[];
export declare const SALES_BILLING_STATUSES: readonly string[];
export declare const SALES_REPORT_KEYS: readonly string[];
export declare const SALES_COMMAND_KEYS: Readonly<{
  approveQuotation: "sales.quotation.approve";
  approveOrder: "sales.order.approve";
  approveOrderAmendment: "sales.order.amendment.approve";
}>;

export type SalesDocumentLineInput = {
  itemId: string;
  uomId?: string | null;
  warehouseId?: string | null;
  description?: string | null;
  quantity: string | number;
  unitPrice?: string | number | null;
  discountPercent?: string | number;
  requestedDeliveryDate?: string | null;
  manualPriceReason?: string | null;
};

export type SalesChargeInput = {
  chargeType: "freight" | "handling" | "insurance" | "packing" | "other";
  label: string;
  calculationType: "fixed" | "percentage";
  value: string | number;
  taxable?: boolean;
};

export type SalesDocumentInput = {
  companyId: string;
  branchId?: string | null;
  partyId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  ownerUserId?: string | null;
  currencyCode: string;
  exchangeRate?: string | number;
  priceListId?: string | null;
  paymentTermId?: string | null;
  billingAddressId?: string | null;
  shippingAddressId?: string | null;
  validUntil?: string;
  requestedDeliveryDate?: string | null;
  customerPoNumber?: string | null;
  customerPoDate?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  deliveryTerms?: string | null;
  shippingMethod?: string | null;
  incoterm?: string | null;
  placeOfSupply?: string | null;
  supplyType?: "domestic" | "export" | "sez" | "exempt" | "non_gst";
  internalNotes?: string | null;
  customerNotes?: string | null;
  termsAndConditions?: string | null;
  revisionReason?: string | null;
  lines: SalesDocumentLineInput[];
  charges?: SalesChargeInput[];
};
