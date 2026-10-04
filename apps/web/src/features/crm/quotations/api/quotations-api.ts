"use client";

// Browser client for Opportunity-to-Quotation Conversion. Creating the
// quotation is one request: the server resolves the customer, builds the
// lines and creates the Draft through Sales in one transaction.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class QuotationApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(QuotationApiError, "body");
const BASE = "/api/crm/opportunities";

export type QuotationCapabilities = Record<
  "createFromOpportunity" | "viewSales" | "overridePrice" | "applyDiscount" | "createCustomer" | "send" | "revise" | "accept" | "reject" | "cancel" | "createOrder",
  boolean
>;
export type QuotationCheck = { key: string; label: string; met: boolean; blocking?: boolean; value: string | null };
export type CustomerMatch = {
  id: string; code: string | null; name: string; legalName?: string | null; customerNumber?: string | null; website?: string | null; city?: string | null;
  ownerName?: string | null; strength: string; signals: string[]; canOpen: boolean;
};
export type QuotationReadiness = {
  opportunity: {
    id: string; code: string; name: string; status: string; stageName: string | null; amount: number; currencyCode: string | null; expectedCloseDate: string | null;
    productInterest: string | null; ownerUserId: string | null; ownerName: string | null; quotationCount: number; internalContext: string | null;
  };
  account: {
    id: string; code: string; name: string; legalName: string | null; isCustomer: boolean; customerNumber: string | null; gstin: string | null; pan: string | null;
    website: string | null; phone: string | null; email: string | null; paymentTermId: string | null; currencyCode: string | null; hasBillingAddress: boolean;
  } | null;
  customerMatches: CustomerMatch[];
  capabilities: QuotationCapabilities;
  checks: QuotationCheck[];
  recommended: QuotationCheck[];
  canCreate: boolean;
  contacts: Array<{ id: string; name: string; jobTitle: string | null; email: string | null; phone: string | null }>;
  addresses: Array<{ id: string; type: string; label: string; stateCode: string | null; isDefaultBilling: boolean; isDefaultShipping: boolean }>;
  lines: Array<{
    id: string; itemId: string; itemCode: string; itemName: string; active: boolean; uom: string | null; description: string | null; quantity: number;
    estimatedUnitPrice: number; estimatedDiscountPercent: number;
  }>;
  priceLists: Array<{ id: string; code: string; name: string; currencyCode: string; taxInclusive: boolean }>;
  paymentTerms: Array<{ id: string; code: string; name: string }>;
  currencies: string[];
  sellerStateCode: string | null;
  stageSuggestion: { stageId: string; stageName: string } | null;
  defaults: {
    contactId: string | null; billingAddressId: string | null; shippingAddressId: string | null; quotationDate: string; validUntil: string;
    currencyCode: string; priceListId: string | null; paymentTermId: string | null;
  };
};
export type QuotationLineInput = { itemId: string; description?: string; quantity: number; discountPercent?: number; unitPrice?: number; manualPriceReason?: string };
export type BillingAddressInput = { line1: string; line2?: string; city: string; state: string; stateCode?: string; postalCode: string; countryCode: string };
export type CreateQuotationInput = {
  idempotencyKey: string;
  customer?: { mode: "create"; gstin?: string; paymentTermId?: string; currencyCode?: string; billingAddress?: BillingAddressInput; confirmNoMatch?: boolean } | { mode: "link"; customerId: string };
  contactId?: string; billingAddressId?: string; shippingAddressId?: string;
  validUntil: string; currencyCode: string; priceListId?: string; paymentTermId?: string; customerReference?: string;
  customerNotes?: string; termsAndConditions?: string; internalNotes?: string;
  lines: QuotationLineInput[];
};
export type CreateQuotationResult = {
  quotationId: string; quotationNumber: string; opportunityId: string; partyId: string; customerDecision: "existing" | "created" | "linked";
  primary: boolean; stageSuggestion: { stageId: string; stageName: string } | null; replayed: boolean;
};
export type OpportunityQuotation = {
  id: string; number: string; revision: number; revisionCount: number; revisionReason: string | null; status: string; statusLabel: string; isExpired: boolean;
  validUntil: string; total: number | null; currencyCode: string | null; ownerName: string | null; createdAt: string;
  sentAt: string | null; sentTo: string | null; sentChannel: string | null; acceptedAt: string | null; rejectedAt: string | null; cancelledAt: string | null;
  customerReference: string | null; decisionReference: string | null; decisionNotes: string | null; cancelReason: string | null;
  salesOrderId: string | null; salesOrderNumber: string | null; isLatest: boolean; isPrimary: boolean; isWinning: boolean;
};

export const getQuotationReadiness = (opportunityId: string) =>
  request<{ readiness: QuotationReadiness }>(`${BASE}/${opportunityId}/quotations/readiness`).then((result) => result.readiness);
export const createQuotationFromOpportunity = (opportunityId: string, input: CreateQuotationInput) =>
  request<{ result: CreateQuotationResult }>(`${BASE}/${opportunityId}/quotations`, { method: "POST", json: input }).then((result) => result.result);
export const listOpportunityQuotations = (opportunityId: string) =>
  request<{ quotations: OpportunityQuotation[]; visible: boolean; capabilities: QuotationCapabilities }>(`${BASE}/${opportunityId}/quotations`);
export const setPrimaryOpportunityQuotation = (opportunityId: string, quotationId: string | null) =>
  request<{ primaryQuotationId: string | null }>(`${BASE}/${opportunityId}/quotations`, { method: "PATCH", json: { quotationId } });

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
