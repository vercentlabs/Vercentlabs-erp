"use client";

// Browser client for Sales price lists under /api/sales/price-lists.
import { SalesApiError, post, request } from "@/features/sales/shared/http";

export type PriceListCapabilities = Record<"view" | "create" | "edit" | "managePrices" | "activate" | "setDefault" | "changeTaxMode" | "import" | "export" | "overridePrice", boolean>;
export type PriceList = {
  id: string; code: string; name: string; description: string | null; currencyCode: string; taxInclusive: boolean; taxModeLabel: string; validFrom: string | null; validTo: string | null;
  isCurrent: boolean; isDefault: boolean; status: "active" | "inactive"; isActive: boolean; entryCount: number; productCount: number; customerCount: number;
  createdByName: string | null; createdAt: string; updatedByName: string | null; updatedAt: string; capabilities?: PriceListCapabilities;
};
export type PriceListInput = Partial<{ code: string; name: string; description: string | null; currencyCode: string; taxInclusive: boolean; validFrom: string | null; validTo: string | null }>;
export type PriceEntry = {
  id: string; productId: string; productCode: string; productName: string; sku: string | null; isService: boolean; productActive: boolean; categoryName: string | null;
  uomId: string; uomCode: string; uomName: string; isBaseUnit: boolean; unitPrice: number; validFrom: string | null; validTo: string | null;
  state: "current" | "future" | "expired" | "inactive"; isActive: boolean; updatedByName: string | null; updatedAt: string;
};
export type PriceInput = { productId?: string; uomId?: string | null; unitPrice?: number; validFrom?: string | null; validTo?: string | null };
export type HistoryEntry = { id: string; eventType: string; summary: string; changes: Record<string, unknown>; itemCode: string | null; createdAt: string; actorName: string | null };
export type ImportAnalysis = { fileName: string; headers: string[]; rowCount: number; sampleRows: Array<Record<string, string>>; suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string }> };
export type ImportRow = { rowNumber: number; name: string | null; outcome: "added" | "updated" | "unchanged" | "failed"; message: string };
export type ImportResult = { dryRun: boolean; total: number; added: number; updated: number; unchanged: number; failed: number; results: ImportRow[] };

const BASE = "/price-lists";
const query = (params: object) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });

export const listPriceLists = (filters: { search?: string; status?: string; currencyCode?: string } = {}) =>
  request<{ priceLists: PriceList[]; currencies: Array<{ code: string; name: string }>; capabilities: PriceListCapabilities }>(`${BASE}${query(filters)}`);
export const getPriceList = (id: string) => request<{ priceList: PriceList }>(`${BASE}/${id}`).then((response) => response.priceList);
export const createPriceList = (input: PriceListInput) => post<{ priceList: PriceList }>(BASE, input).then((response) => response.priceList);
export const updatePriceList = (id: string, input: PriceListInput) => patch<{ priceList: PriceList }>(`${BASE}/${id}`, input).then((response) => response.priceList);
export const deletePriceList = (id: string) => request<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE", body: "{}" });
export const changePriceListStatus = (id: string, action: "activate" | "deactivate" | "make_default", reason?: string) =>
  post<{ priceList: PriceList }>(`${BASE}/${id}/status`, { action, reason }).then((response) => response.priceList);
export const copyPriceList = (id: string, input: PriceListInput) => post<{ priceList: PriceList }>(`${BASE}/${id}/copy`, input).then((response) => response.priceList);
export const getPriceListHistory = (id: string) => request<{ history: HistoryEntry[] }>(`${BASE}/${id}/history`).then((response) => response.history);

export const listPriceEntries = (id: string, filters: { search?: string; state?: string; limit?: number; offset?: number }) =>
  request<{ entries: PriceEntry[]; total: number }>(`${BASE}/${id}/entries${query(filters)}`);
export const addPrice = (id: string, input: PriceInput) => post<{ entry: PriceEntry }>(`${BASE}/${id}/entries`, input).then((response) => response.entry);
export const updatePrice = (id: string, entryId: string, input: PriceInput) => patch<{ entry: PriceEntry }>(`${BASE}/${id}/entries/${entryId}`, input).then((response) => response.entry);
export const expirePrice = (id: string, entryId: string, validTo?: string) => patch<{ entry: PriceEntry }>(`${BASE}/${id}/entries/${entryId}`, { action: "expire", validTo }).then((response) => response.entry);
export const removePrice = (id: string, entryId: string) => request<{ entry: PriceEntry }>(`${BASE}/${id}/entries/${entryId}`, { method: "DELETE", body: "{}" });
export const getProductPrices = (id: string, productId: string) => request<{ entries: PriceEntry[] }>(`${BASE}/${id}/products/${productId}`).then((response) => response.entries);

export const priceExportUrl = (id: string, state = "active") => `/api/sales${BASE}/${id}/export${query({ state })}`;
export const priceImportTemplateUrl = `/api/sales${BASE}/import/template`;
async function upload<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`/api/sales${path}`, { method: "POST", body: form, credentials: "same-origin", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new SalesApiError(payload.message || "The file could not be processed.", response.status, payload.code, payload);
  return payload;
}
export function analyzePriceImport(id: string, file: File) {
  const form = new FormData();
  form.set("file", file);
  return upload<{ analysis: ImportAnalysis }>(`${BASE}/${id}/import/analyze`, form).then((response) => response.analysis);
}
export function importPrices(id: string, file: File, options: { mapping: Record<string, string>; dryRun: boolean }) {
  const form = new FormData();
  form.set("file", file);
  form.set("mapping", JSON.stringify(options.mapping));
  form.set("dryRun", String(options.dryRun));
  return upload<{ result: ImportResult; errorFile: string | null }>(`${BASE}/${id}/import`, form);
}

type Issue = { field: string; message: string };
export const errorMessage = (error: unknown, fallback = "Something went wrong. Try again.") => (error instanceof Error && error.message ? error.message : fallback);
export const errorCode = (error: unknown) => (error instanceof SalesApiError ? error.code : undefined);
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = error instanceof SalesApiError ? (error.payload?.issues as Issue[] | undefined) : undefined;
  return Object.fromEntries((issues ?? []).map((issue) => [issue.field, issue.message]));
}
