// Procurement Home and reports.
export interface ProcurementMetric { key: string; label: string; value: number; href: string }
export interface ProcurementAttentionItem { kind: string; title: string; detail: string; href: string }
export interface ProcurementReportColumn { key: string; label: string; type: "text" | "number" | "money" | "date" }
export interface ProcurementReport {
  key: string; title: string; description: string; columns: ProcurementReportColumn[]; rows: Array<Record<string, any> & { href: string }>;
  filters: { supplierId: string | null; buyingRegistrationId: string | null; from: string | null; to: string | null; status: string | null };
}
export declare function getProcurementOverview(client: any, context: any): Promise<{ today: string; metrics: ProcurementMetric[]; attention: ProcurementAttentionItem[] }>;
export declare function getProcurementReportCatalog(context: any): Array<{ key: string; title: string; description: string }>;
export declare function getProcurementReport(client: any, context: any, name: string, filters?: Record<string, unknown>): Promise<ProcurementReport>;
