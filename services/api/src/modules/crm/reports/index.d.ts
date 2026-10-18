import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Disclosure = { reportingCurrency: string | null; unconvertedCount: number; unconvertedCurrencies: string[] };

export type ForecastMonth = { month: string; deals: number; committed: number; bestCase: number; pipeline: number; weighted: number; won: number; wonDeals: number };
export function getForecastByMonth(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<{
  currency: Disclosure; months: ForecastMonth[]; overdue: { deals: number; undated: number; value: number; weighted: number };
}>;
export type TrendPoint = { period: string; leadsCreated: number; leadsConverted: number; dealsCreated: number; dealsWon: number; wonValue: number; dealsLost: number };
export function getCrmTrends(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<{
  interval: "week" | "month" | "quarter"; from: string; to: string; currency: string | null; seesLeads: boolean; seesDeals: boolean; series: TrendPoint[];
}>;
export type PivotDefinitions = Record<"deals" | "leads", { dimensions: Array<{ key: string; label: string }>; measures: Array<{ key: string; label: string; money?: boolean }> }>;
export function getPivotDefinitions(): PivotDefinitions;
export type PivotResult = {
  subject: "deals" | "leads"; rows: Array<{ key: string; label: string }>; columns: Array<{ key: string; label: string }>;
  cells: Record<string, Record<string, number>>; rowTotals: Record<string, number>; columnTotals: Record<string, number>; total: number;
  measure: { key: string; label: string; money: boolean }; currency: Disclosure;
};
export function getCrmPivot(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<PivotResult>;
export type ActivityReportRow = {
  userId: string; name: string; calls: number; emails: number; meetings: number; whatsapp: number; sms: number; tasksDone: number; followUpsDone: number;
  overdue: number; leadsTouched: number; dealsTouched: number; total: number;
};
export function getActivityReport(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<{ from: string; to: string; people: ActivityReportRow[]; totals: Record<string, number> }>;
export type TargetMetric = { key: "won_value" | "won_count" | "new_leads" | "activities"; label: string; money?: boolean };
export type TargetAttainment = {
  month: string; metrics: TargetMetric[]; canSet: boolean; currency: string | null;
  people: Array<{ userId: string; name: string; measures: Record<string, { actual: number; target: number | null; attainment: number | null }> }>;
};
export function listTargetMetrics(): TargetMetric[];
export function getTargetAttainment(client: QueryClient, context: CrmContext, input?: Record<string, unknown>): Promise<TargetAttainment>;
export function setSalesTargets(client: QueryClient, context: CrmContext, input: { month: string; targets: Array<{ userId: string; metric: string; target: number | null }> }): Promise<TargetAttainment>;
