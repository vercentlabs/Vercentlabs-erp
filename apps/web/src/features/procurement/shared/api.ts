"use client";

import { patch, post, request } from "@/features/procurement/shared/http";

// A Procurement record as the API returns it: the document's own columns
// (id, status, version, created_by, ...) merged with its JSON data (title,
// supplierId, lines, totals, ...). The shape varies by resource, so fields are
// read defensively at the edge; nothing here does arithmetic on money.
export type ProcRecord = {
  id: string;
  status: string;
  version: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} & Record<string, any>;

// Master data for the configuration forms (categories, policies, source rules).
export type ProcOptions = {
  suppliers: Array<{ id: string; label: string; status: string; selectable: boolean }>;
  paymentTerms: Array<{ id: string; code: string; name: string }>;
  items: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  categories: Array<{ id: string; label: string; status: string }>;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listRecords = (
  resource: string,
  filters: {
    status?: string;
    search?: string;
    parentId?: string;
    limit?: number;
  } = {},
) =>
  request<{ rows: ProcRecord[]; total: number }>(`/${resource}${qs(filters)}`);
export const getRecord = (resource: string, id: string) =>
  request<{ record: ProcRecord }>(`/${resource}/${id}`).then((r) => r.record);
export const createRecord = (
  resource: string,
  input: Record<string, unknown>,
) => post<{ record: ProcRecord }>(`/${resource}`, input).then((r) => r.record);
export const updateRecord = (
  resource: string,
  id: string,
  input: Record<string, unknown>,
) =>
  patch<{ record: ProcRecord }>(`/${resource}/${id}`, input).then(
    (r) => r.record,
  );
// Suppliers and items are a first page plus the ones asked for; the rest are found by typing (ProcurementSearchPicker).
export const getOptions = (include: { supplierIds?: string[]; itemIds?: string[] } = {}) =>
  request<{ options: ProcOptions }>(`/options${qs({ supplierIds: include.supplierIds?.filter(Boolean).join(","), itemIds: include.itemIds?.filter(Boolean).join(",") })}`).then((r) => r.options);

// A supplier or purchasable item as the pickers show it (services/api/src/modules/procurement/options.js): one shape for every screen.
export type ProcurementPickRow = {
  id: string; label: string; name: string; status?: string; selectable?: boolean;
  // suppliers
  supplier_number?: string; display_name?: string; currency_code?: string | null; payment_term_id?: string | null; withholding_section_id?: string | null;
  gstin?: string | null; msme?: boolean;
  // products
  code?: string; item_type?: string; track_inventory?: boolean; purchase_uom_id?: string | null; uom_id?: string | null; tax_category_id?: string | null;
  last_purchase_price?: string | null; contract_rate?: string | null; contract_number?: string | null;
};
export const searchProcurementOptions = (input: { kind: "suppliers" | "products"; search?: string; ids?: string[]; supplierId?: string | null; activeOnly?: boolean }) =>
  request<{ suppliers?: ProcurementPickRow[]; products?: ProcurementPickRow[] }>(`/options/search${qs({
    kind: input.kind, search: input.search, ids: input.ids?.join(","), supplierId: input.supplierId ?? undefined, activeOnly: input.activeOnly ? "true" : undefined,
  })}`);
