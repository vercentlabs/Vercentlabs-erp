"use client";

import { patch, post, request } from "@/features/procurement/shared/http";

// Purchase indents (Procurement plan Phase 2).
const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type IndentRow = {
  id: string; number: string; status: string; statusLabel: string; source: string; requiredBy: string | null; purpose: string | null; requestedBy: string | null;
  warehouseName: string | null; lineCount: number; items: string | null; toOrder: boolean; createdAt: string;
};
export type IndentLine = {
  id: string; lineNumber: number; productId: string; productCode: string; productName: string; description: string | null; quantity: string; uomId: string | null; uomCode: string | null;
  requiredBy: string | null; warehouseId: string | null; warehouseName: string | null; status: string; ordered: string; remaining: string; notes: string | null;
  contract: { rate: string; contractNumber: string; supplierName: string; supplierId: string } | null;
};
export type IndentDetail = {
  indent: { id: string; number: string; status: string; statusLabel: string; source: string; requiredBy: string | null; purpose: string | null; notes: string | null; warehouseId: string | null;
    departmentId: string | null; costCenterId: string | null; requestedById: string | null; requestedBy: string | null; submittedAt: string | null; decidedAt: string | null;
    decidedBy: string | null; decisionNote: string | null; createdAt: string };
  lines: IndentLine[];
  orders: Array<{ id: string; number: string; status: string; href: string }>;
  rfqs: Array<{ id: string; number: string; status: string; href: string }>;
  actions: Record<"edit" | "submit" | "approve" | "reject" | "order" | "rfq" | "close" | "cancel", boolean>;
};
export type IndentLineToOrder = {
  id: string; indentId: string; indentNumber: string; productId: string; productCode: string; productName: string; quantity: string; ordered: string; remaining: string;
  uomId: string | null; uomCode: string | null; requiredBy: string | null; warehouseId: string | null; purchasePrice: string | null;
};
export type IndentInput = {
  requiredBy?: string | null; warehouseId?: string | null; purpose?: string | null; notes?: string | null; submit?: boolean;
  lines: Array<{ productId: string; quantity: string; uomId?: string; requiredBy?: string | null; notes?: string | null }>;
};

export const listIndents = (filters: Record<string, string | undefined>) => request<{ rows: IndentRow[]; total: number }>(`/indents${qs(filters)}`);
export const getIndent = (id: string) => request<IndentDetail>(`/indents/${id}`);
export const createIndent = (input: IndentInput) => post<{ result: { id: string; number: string; status: string } }>("/indents", input).then((result) => result.result);
export const updateIndent = (id: string, input: Partial<IndentInput>) => patch<{ result: { id: string } }>(`/indents/${id}`, input).then((result) => result.result);
export const indentAction = (id: string, action: "submit" | "approve" | "reject" | "close" | "cancel", input: Record<string, unknown> = {}) =>
  post<{ result: { id: string; status: string } }>(`/indents/${id}/${action}`, input).then((result) => result.result);
export const listIndentLinesToOrder = (filters: Record<string, string | undefined> = {}) => request<{ lines: IndentLineToOrder[] }>(`/indents/lines${qs(filters)}`).then((result) => result.lines);
export const orderFromIndents = (input: { supplierId: string; lines: Array<{ indentLineId: string; quantity?: string; unitPrice?: string }>; expectedDeliveryDate?: string }) =>
  post<{ result: { id: string; purchaseOrderNumber: string } }>("/indents/order", input).then((result) => result.result);
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
