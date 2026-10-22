"use client";

import { patch, post, request } from "@/features/procurement/shared/http";

// Rate contracts (Procurement plan Phase 3).
const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type RateContractRow = { id: string; number: string; status: string; statusLabel: string; validFrom: string; validTo: string; supplierId: string; supplierName: string;
  currencyCode: string; supplierReference: string | null; items: string | null };
export type RateContractDetail = {
  contract: { id: string; number: string; status: string; statusLabel: string; supplierId: string; supplierName: string | null; validFrom: string; validTo: string; currencyCode: string;
    supplierReference: string | null; notes: string | null; activatedAt: string | null };
  lines: Array<{ id: string; lineNumber: number; productId: string; productCode: string; productName: string; uomId: string | null; uomCode: string | null; rate: string;
    maxQuantity: string | null; maxValue: string | null; drawnQuantity: string; drawnValue: string; remainingQuantity: string | null; remainingValue: string | null }>;
  orders: Array<{ id: string; number: string; status: string; date: string; href: string }>;
  actions: Record<"edit" | "activate" | "cancel", boolean>;
};
export type RateContractInput = { supplierId: string; validFrom: string; validTo: string; supplierReference?: string | null; notes?: string | null; activate?: boolean;
  lines: Array<{ productId: string; uomId?: string; rate: string; maxQuantity?: string | null; maxValue?: string | null }> };

export const listRateContracts = (filters: Record<string, string | undefined>) => request<{ rows: RateContractRow[]; total: number }>(`/rate-contracts${qs(filters)}`);
export const getRateContract = (id: string) => request<RateContractDetail>(`/rate-contracts/${id}`);
export const createRateContract = (input: RateContractInput) => post<{ result: { id: string; number: string } }>("/rate-contracts", input).then((result) => result.result);
export const updateRateContract = (id: string, input: Partial<RateContractInput>) => patch<{ result: { id: string } }>(`/rate-contracts/${id}`, input).then((result) => result.result);
export const rateContractAction = (id: string, action: "activate" | "cancel") => post<{ result: { id: string; status: string } }>(`/rate-contracts/${id}/${action}`).then((result) => result.result);
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
