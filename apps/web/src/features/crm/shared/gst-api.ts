"use client";

// Browser client for the GST register (GSTIN status check and company lookup) and the organization's holidays (CRM plan 5.6).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class GstApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(GstApiError, "body");

export type GstinCheck = {
  gstin: string; status: string; statusLabel: string; legalName: string | null; tradeName: string | null; registeredOn: string | null; cancelledOn: string | null;
  taxpayerType: string | null; address: Record<string, string | null>; checkedAt: string;
};
export type CompanyFromGstin = {
  gstin: string; configured: boolean; status: string; statusLabel: string; displayName: string | null; legalName: string | null; pan: string | null;
  address: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; stateCode?: string | null; postalCode?: string | null };
};

export const lookupGstin = (gstin: string) => request<{ company: CompanyFromGstin }>(`/api/crm/gstin/${encodeURIComponent(gstin)}`).then((result) => result.company);
export const getAccountGstinCheck = (accountId: string) => request<{ check: GstinCheck | null; configured: boolean }>(`/api/crm/accounts/${accountId}/gstin-check`);
export const verifyAccountGstin = (accountId: string) =>
  request<{ check: GstinCheck | null; configured: boolean; warnings: Array<{ code: string; message: string }> }>(`/api/crm/accounts/${accountId}/gstin-check`, { method: "POST", json: {} });

export type Holiday = { id: string; date: string; name: string };
export const listHolidays = (year?: number) => request<{ holidays: Holiday[] }>(`/api/crm/holidays${year ? `?year=${year}` : ""}`).then((result) => result.holidays);
export const addHoliday = (input: { date: string; name: string }) => request<{ holiday: Holiday }>("/api/crm/holidays", { method: "POST", json: input });
export const addNationalHolidays = (year: number) => request<{ added: number }>("/api/crm/holidays/national", { method: "POST", json: { year } });
export const removeHoliday = (id: string) => request<{ removed: true }>(`/api/crm/holidays/${id}`, { method: "DELETE" });

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
