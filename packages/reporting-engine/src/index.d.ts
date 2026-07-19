export type ReportColumn = { key: string; label: string };
export function csvCell(value: unknown): string;
export function rowsToCsv(columns: readonly ReportColumn[], rows: readonly Record<string, unknown>[]): string;
export function normalizePage(input?: Record<string, unknown>): Readonly<{ limit: number; offset: number }>;
export function createReportRegistry(definitions: readonly { key: string; columns: readonly ReportColumn[]; execute(context: unknown, filters: unknown): Promise<Record<string, unknown>> }[]): Readonly<{ keys(): readonly string[]; get(key: string): unknown; execute(key: string, context: unknown, filters?: unknown): Promise<unknown> }>;
