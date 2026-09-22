"use client";

import { post, request } from "@/features/sales/shared/http";

// Rows from the shared business-data engine arrive camelCased.
export type CustomerRecord = {
  id: string;
  code: string;
  partyType: "customer" | "prospect" | "both";
  displayName: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  currencyCode: string | null;
  creditLimit: string | null;
  paymentTermId: string | null;
  status: "active" | "inactive";
  updatedAt: string;
};
export type ItemRecord = { id: string; code: string; name: string; description: string | null; itemType: string; hsnSacCode: string | null; barcode: string | null; salesPrice: string | null; standardCost?: string | null; trackInventory: boolean; status: string };
export type CustomerInput = Partial<Pick<CustomerRecord, "code" | "partyType" | "displayName" | "legalName" | "gstin" | "pan" | "currencyCode" | "paymentTermId">> & { creditLimit?: number; expectedUpdatedAt?: string; duplicateOverrideReason?: string };
export type ContactInput = { partyId?: string; firstName: string; lastName?: string; designation?: string; email?: string; phone?: string; mobile?: string; isPrimary?: boolean };
export type AddressInput = { partyId?: string; addressType: string; line1: string; line2?: string; city?: string; district?: string; state?: string; stateCode?: string; postalCode?: string; countryCode?: string; gstin?: string; isPrimary?: boolean };
export type CustomerCreditSummary = {
  creditLimit: number;
  arOutstanding: number;
  unappliedAdvances: number;
  netExposure: number;
  availableCredit: number | null;
  overLimit: boolean;
  currencyCode: string | null;
};

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const listCustomers = (filters: { search?: string; status?: string }) => request<{ rows: CustomerRecord[]; total: number }>(`/master/parties${qs({ ...filters, limit: 200 })}`);
export const listItems = (filters: { search?: string; status?: string }) => request<{ rows: ItemRecord[]; total: number }>(`/master/items${qs({ ...filters, limit: 200 })}`);
export const getCustomer = (id: string) => request<{ record: CustomerRecord }>(`/master/parties/${id}`);
export const getCustomerCredit = (id: string) => request<{ credit: CustomerCreditSummary }>(`/customers/${id}/credit`);
export const createRecord = <T,>(resource: "parties" | "contacts" | "addresses", input: unknown) => post<{ record: T }>(`/master/${resource}`, input);
export const updateRecord = <T,>(resource: "parties" | "contacts" | "addresses", id: string, input: unknown) => request<{ record: T }>(`/master/${resource}/${id}`, { method: "PATCH", body: JSON.stringify(input) });
export const archiveRecord = (resource: "parties" | "contacts" | "addresses", id: string, expectedUpdatedAt?: string) =>
  request<{ record: unknown }>(`/master/${resource}/${id}${qs({ expectedUpdatedAt })}`, { method: "DELETE" });
