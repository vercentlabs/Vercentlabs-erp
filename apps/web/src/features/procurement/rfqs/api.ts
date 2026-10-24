"use client";

import { patch, post, request } from "@/features/procurement/shared/http";

// RFQs, the comparison and the award (Procurement plan Phase 2).
const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type RfqRow = { id: string; number: string; status: string; statusLabel: string; title: string | null; responseDueDate: string | null; lineCount: number; supplierCount: number;
  responded: number; createdAt: string; sentAt: string | null };
export type RfqDetail = {
  rfq: { id: string; number: string; status: string; statusLabel: string; title: string | null; responseDueDate: string | null; currencyCode: string; warehouseId: string | null;
    notes: string | null; sentAt: string | null; awardedAt: string | null; createdAt: string };
  lines: Array<{ id: string; lineNumber: number; productId: string; productCode: string; productName: string; description: string | null; quantity: string; uomId: string | null;
    uomCode: string | null; requiredBy: string | null; indentLineId: string | null; indentId: string | null; indentNumber: string | null; awardedQuotationLineId: string | null;
    oneOff?: boolean; oneOffType?: "service" | "non_stock" | null; expenseAccountId?: string | null; taxCategoryId?: string | null; noTax?: boolean }>;
  suppliers: Array<{ id: string; supplierId: string; supplierName: string; supplierNumber: string; gstin: string | null; msme: boolean; email: string | null; phone: string | null;
    status: string; sentAt: string | null; declinedReason: string | null; quotation: { id: string; number: string; status: string; convertedPurchaseOrderId: string | null } | null }>;
  orders: Array<{ id: string; number: string; status: string; href: string }>;
  actions: Record<"edit" | "send" | "recordQuote" | "award" | "cancel" | "close", boolean>;
};
export type Offer = {
  quotationId: string; quotationNumber: string; quotationLineId: string; supplierId: string; supplierName: string | null; msme: boolean; quantity: string; unitPrice: string;
  discountType: string | null; discountValue: string; netRate: string; gstRate: string; gstClaimable: boolean; freightPerUnit: string; landedRate: string; landedValue: string; leadDays: number | null;
  paymentTerms: string | null; validUntil: string | null; expired: boolean; awarded: boolean; lowest: boolean;
};
export type Comparison = {
  rfq: RfqDetail["rfq"]; actions: RfqDetail["actions"];
  suppliers: Array<{ quotationId: string; quotationNumber: string; supplierId: string; supplierName: string | null; msme: boolean; freight: string; leadDays: number | null;
    paymentTerms: string | null; landedTotal: string; linesQuoted: number }>;
  lines: Array<RfqDetail["lines"][number] & { offers: Offer[]; lastPrice: { unitPrice: string; date: string; supplierName: string } | null }>;
};
export type RfqInput = { title?: string | null; responseDueDate?: string | null; notes?: string | null; supplierIds?: string[]; indentLineIds?: string[];
  lines?: Array<{ productId?: string; description?: string; oneOffType?: string; quantity: string; uomId?: string; requiredBy?: string | null }> };

export const listRfqs = (filters: Record<string, string | undefined>) => request<{ rows: RfqRow[]; total: number }>(`/rfqs${qs(filters)}`);
export const getRfq = (id: string) => request<RfqDetail>(`/rfqs/${id}`);
export const getComparison = (id: string) => request<Comparison>(`/rfqs/${id}/comparison`);
export const createRfq = (input: RfqInput) => post<{ result: { id: string; number: string } }>("/rfqs", input).then((result) => result.result);
export const updateRfq = (id: string, input: RfqInput) => patch<{ result: { id: string } }>(`/rfqs/${id}`, input).then((result) => result.result);
export const rfqAction = (id: string, action: "send" | "quotation" | "decline" | "award" | "cancel" | "close", input: Record<string, unknown> = {}) =>
  post<{ result: Record<string, unknown> }>(`/rfqs/${id}/${action}`, input).then((result) => result.result);
export const rfqPdfUrl = (id: string, supplierId?: string, inline = false) =>
  `/api/documents/procurement.rfq/${id}/pdf${qs({ supplierId, disposition: inline ? "inline" : undefined })}`;
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
