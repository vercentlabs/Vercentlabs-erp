"use client";

// Browser client for CRM quotes (CRM audit M1): quotations and proformas made from a deal when the organization has no Sales app.
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class QuoteApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(QuoteApiError, "body");

export type QuoteCapabilities = { create: boolean; edit: boolean; upgrade: boolean };
export type CrmQuote = {
  id: string; number: string; kind: "quotation" | "proforma"; kindLabel: string; status: "draft" | "sent" | "accepted" | "declined" | "upgraded"; opportunityId: string;
  quoteDate: string; validUntil: string | null; currencyCode: string; sellerStateCode: string | null; placeOfSupply: string | null; placeOfSupplyName: string | null;
  customerGstin: string | null; notes: string | null; terms: string | null; subtotal: string; discountTotal: string; taxTotal: string; grandTotal: string;
  sentAt: string | null; decidedAt: string | null; salesQuotationId: string | null; salesQuotationNumber: string | null; companyId: string | null; companyName: string | null;
  contactId: string | null; contactName: string | null; contactEmail: string | null; contactMobile: string | null; dealCode: string | null; dealName: string | null; updatedAt?: string;
};
export type CrmQuoteLine = {
  id?: string; itemId: string | null; description: string; hsnSac: string | null; quantity: number | string; unitPrice: number | string; discountPercent: number | string;
  gstRate: number | string; taxable?: string; cgst?: string; sgst?: string; igst?: string; lineTotal?: string;
};
export type CrmQuoteView = { quote: CrmQuote; lines: CrmQuoteLine[]; capabilities: QuoteCapabilities };

export const listDealQuotes = (opportunityId: string) =>
  request<{ quotes: CrmQuote[]; capabilities: QuoteCapabilities }>(`/api/crm/opportunities/${opportunityId}/crm-quotes`);
export const createDealQuote = (opportunityId: string, kind: "quotation" | "proforma") =>
  request<CrmQuoteView>(`/api/crm/opportunities/${opportunityId}/crm-quotes`, { method: "POST", json: { kind } });
export const getDealQuote = (id: string) => request<CrmQuoteView>(`/api/crm/quotes/${id}`);
export const updateDealQuote = (id: string, input: Partial<{ kind: string; validUntil: string | null; placeOfSupply: string | null; notes: string | null; terms: string | null; lines: CrmQuoteLine[] }>) =>
  request<CrmQuoteView>(`/api/crm/quotes/${id}`, { method: "PATCH", json: input });
export const setDealQuoteStatus = (id: string, status: "sent" | "accepted" | "declined") =>
  request<CrmQuoteView>(`/api/crm/quotes/${id}/status`, { method: "POST", json: { status } });
export const dealQuoteShareLink = (id: string) => request<{ url: string }>(`/api/crm/quotes/${id}/share`, { method: "POST", json: {} });
export const emailDealQuote = (id: string, input: { to: string; cc?: string; subject?: string; message?: string }) =>
  request<{ result: { status: string } }>(`/api/crm/quotes/${id}/email`, { method: "POST", json: input });
export const upgradeDealQuote = (id: string) => request<{ result: { quote: CrmQuote } }>(`/api/crm/quotes/${id}/upgrade`, { method: "POST", json: {} });
export const quotePdfUrl = (id: string, inline = false) => `/api/documents/crm.quote/${id}/pdf${inline ? "?disposition=inline" : ""}`;

export function quoteErrorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

export const QUOTE_STATUS: Record<CrmQuote["status"], { label: string; tone: "neutral" | "info" | "success" | "danger" }> = {
  draft: { label: "Draft", tone: "neutral" }, sent: { label: "Sent", tone: "info" }, accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" }, upgraded: { label: "In Sales", tone: "neutral" },
};
// The GST rates Indian supplies are taxed at.
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];
