"use client";

import { patch, post, request } from "@/features/procurement/shared/http";

// Supplier Rates (Procurement report H1): each supplier's price list.
const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export type SupplierRate = {
  id: string; supplierId: string; supplierName: string; supplierNumber: string; productId: string; productCode: string; productName: string; uomId: string | null; uomCode: string | null;
  rate: string; minimumQuantity: string; currencyCode: string; validFrom: string; validTo: string | null; supplierItemCode: string | null; leadTimeDays: number | null;
  preferred: boolean; notes: string | null; status: "active" | "inactive"; state: "current" | "scheduled" | "ended" | "inactive"; updatedAt: string;
};
export type SupplierRateInput = {
  supplierId: string; productId: string; uomId?: string; rate: string; minimumQuantity?: string; currencyCode?: string; validFrom?: string; validTo?: string | null;
  leadTimeDays?: number | null; supplierItemCode?: string | null; preferred?: boolean; notes?: string | null;
};
export type SupplierRateImport = { rows: number; created: number; updated: number; errors: Array<{ row: number; message: string }>; dryRun: boolean };

export const listSupplierRates = (filters: Record<string, string | undefined>) => request<{ rows: SupplierRate[]; total: number }>(`/supplier-rates${qs(filters)}`);
export const getSupplierRate = (id: string) => request<{ rate: SupplierRate; actions: { edit: boolean } }>(`/supplier-rates/${id}`);
export const createSupplierRate = (input: SupplierRateInput) => post<{ result: { id: string } }>("/supplier-rates", input).then((result) => result.result);
export const updateSupplierRate = (id: string, input: Partial<SupplierRateInput>) => patch<{ result: { id: string } }>(`/supplier-rates/${id}`, input).then((result) => result.result);
export const setSupplierRateActive = (id: string, active: boolean) =>
  post<{ result: { id: string; status: string } }>(`/supplier-rates/${id}/${active ? "activate" : "deactivate"}`, {}).then((result) => result.result);
export const fillSupplierRates = () => post<{ result: { created: number } }>("/supplier-rates/fill", {}).then((result) => result.result);

export async function importSupplierRates(file: File, dryRun: boolean): Promise<SupplierRateImport> {
  const form = new FormData();
  form.set("file", file);
  form.set("dryRun", dryRun ? "true" : "false");
  const response = await fetch("/api/procurement/supplier-rates/import", { method: "POST", body: form, credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message ?? "The file could not be read.");
  return payload.result as SupplierRateImport;
}
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
