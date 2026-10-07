"use client";

// Procurement Home and reports: the shapes the screens read. Counts and figures are the server's; nothing here calculates.
import { request } from "@/features/procurement/shared/http";

export type ProcurementMetric = { key: string; label: string; value: number; href: string };
export type AttentionItem = { kind: string; title: string; detail: string; href: string };
export type ProcurementOverview = { today: string; metrics: ProcurementMetric[]; attention: AttentionItem[] };
export type ReportSummary = { key: string; title: string; description: string };
export type ReportColumn = { key: string; label: string; type: "text" | "number" | "money" | "date" };
export type ReportRow = Record<string, string | number | null> & { href: string; currency?: string };
export type ProcurementReport = ReportSummary & { columns: ReportColumn[]; rows: ReportRow[] };
export type ReportFilters = { supplierId?: string; buyingRegistrationId?: string; from?: string; to?: string; status?: string };

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const getProcurementOverview = () => request<{ overview: ProcurementOverview }>("/overview").then((result) => result.overview);
export const getReportCatalog = () => request<{ reports: ReportSummary[] }>("/reports").then((result) => result.reports);
export const getReport = (key: string, filters: ReportFilters) =>
  request<{ report: ProcurementReport }>(`/reports/${encodeURIComponent(key)}${qs(filters)}`).then((result) => result.report);
