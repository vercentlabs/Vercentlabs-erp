// getCrmReport's own return shape (services/api/src/modules/crm/
// analytics/analytics-service.js) — each of the
// 14 report kinds has its own hand-written SQL and its own row shape, so
// this stays a generic bag of camelized columns rather than 14 bespoke
// types; the screen renders whatever columns the backend actually returns.
export type CrmReportRow = Record<string, string | number | null>;

export type CrmReportResult = {
  report: string;
  rows: CrmReportRow[];
  filters: { from: string | null; to: string | null };
  // F030 — when it ran, and a fingerprint of report + filters + rows (same data, same fingerprint).
  generatedAt?: string;
  fingerprint?: string;
};

export type CrmReportFilters = { from?: string; to?: string };
