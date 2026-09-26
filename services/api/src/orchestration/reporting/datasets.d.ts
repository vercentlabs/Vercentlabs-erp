export type ReportDataset = Readonly<{
  key: string;
  moduleKey: string;
  label: string;
  description: string;
  requiredPermissions: readonly string[];
  maxRows: number;
  columns: ReadonlyArray<{ key: string; label: string }>;
  filters: ReadonlyArray<{ key: string; label: string }>;
}>;
export const REPORT_DATASETS: readonly ReportDataset[];
export function getReportDataset(key: string): ReportDataset | null;
