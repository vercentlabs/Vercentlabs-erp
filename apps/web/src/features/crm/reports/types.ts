// getCrmReport's own return shape (services/api/src/modules/crm/
// pipeline-analytics-and-forecasting/analytics-service.js) — each of the
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

// Matches getCrmReport's exhaustive if/else-if chain exactly — anything not
// in this list throws CRM_REPORT_NOT_FOUND (404) server-side.
export const CRM_REPORT_OPTIONS = [
  { value: "pipeline", label: "Pipeline by stage" },
  { value: "conversion", label: "Lead conversion, by month" },
  { value: "sources", label: "Lead sources" },
  { value: "activities", label: "Activity throughput" },
  { value: "forecast", label: "Forecast, by owner" },
  { value: "win-loss", label: "Won and lost reasons" },
  { value: "campaigns", label: "Campaign performance" },
  { value: "attribution", label: "Multi-touch attribution" },
  { value: "revenue-operations", label: "Revenue operations" },
  { value: "account-health", label: "Account health" },
  { value: "privacy", label: "Privacy requests" },
  { value: "pipeline-intelligence", label: "Pipeline intelligence" },
  { value: "engagement-intelligence", label: "Engagement intelligence" },
  { value: "relationship-coverage", label: "Relationship coverage" },
  { value: "partner-pipeline", label: "Partner pipeline" },
  { value: "ai-governance", label: "AI governance" },
] as const;
