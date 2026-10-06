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

export type ProcOptions = {
  // From the Supplier Master; only active (selectable) suppliers start a new document.
  suppliers: Array<{ id: string; label: string; status: string; supplier_number: string; name: string; gstin: string | null; city: string | null; selectable: boolean }>;
  paymentTerms: Array<{ id: string; code: string; name: string }>;
  purchaseOrders: Array<{ id: string; label: string; status: string }>;
  receipts: Array<{ id: string; label: string; status: string }>;
  items: Array<{ id: string; code: string; name: string }>;
  warehouses: Array<{ id: string; code: string; name: string }>;
  sourcingEvents: Array<{ id: string; label: string; status: string }>;
  uoms: Array<{ id: string; code: string; name: string }>;
  categories: Array<{ id: string; label: string; status: string }>;
  agreements: Array<{ id: string; label: string; status: string }>;
  requisitions: Array<{ id: string; label: string; status: string }>;
  // Active locations and people of active suppliers, for the order's supplier contact and locations.
  supplierAddresses?: Array<{ id: string; supplier_id: string; label: string; city: string; state: string | null; gstin: string | null; purposes: string[] }>;
  supplierContacts?: Array<{ id: string; supplier_id: string; name: string; designation: string | null; email: string | null; roles: string[] }>;
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
export const actOn = (
  resource: string,
  id: string,
  action: string,
  input: Record<string, unknown> = {},
) =>
  post<{ record: ProcRecord }>(`/${resource}/${id}/${action}`, input).then(
    (r) => r.record,
  );
export const getOptions = () =>
  request<{ options: ProcOptions }>("/options").then((r) => r.options);
export const getDashboard = () =>
  request<{ dashboard: Record<string, string | number> }>("/dashboard").then(
    (r) => r.dashboard,
  );
export const listOperations = <T>(kind: string) =>
  request<{ rows: T[] }>(`/operations?kind=${kind}`).then((r) => r.rows);
export const runMatch = (input: Record<string, unknown>) =>
  post<{ result: Record<string, any> }>("/match", input).then((r) => r.result); // eslint-disable-line @typescript-eslint/no-explicit-any
