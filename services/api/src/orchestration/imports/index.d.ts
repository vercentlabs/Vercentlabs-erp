type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; permissions?: readonly string[]; roleSlugs?: readonly string[] };

export type ImporterSummary = { key: string; moduleKey: string; label: string; description: string; groupBy: string | null; fields: Array<{ key: string; label: string; required: boolean }> };
export type ImportResult = { rows: number[]; label: string | null; outcome: "created" | "duplicate" | "failed"; reference?: string | null; message: string; field?: string | null };
export const IMPORTERS: readonly unknown[];
export const IMPORT_ROW_LIMIT: number;
export class ImportError extends Error { status: number; code: string }
export class ImportRowError extends Error { status: number; code: string }
export function importDate(value: unknown, label: string, field: string): string | null;
export function listImporters(session: Session, accessibleModules: readonly string[]): ImporterSummary[];
export function buildImportTemplate(importerKey: string): string;
export function analyzeImport(session: Session, accessibleModules: readonly string[], importerKey: string, input: { bytes: Uint8Array; fileName: string }): {
  importer: string; fileName: string; headers: string[]; rowCount: number; sampleRows: Record<string, string>[]; suggestedMapping: Record<string, string>; fields: Array<{ key: string; label: string; required: boolean }>;
};
export function runImport(client: Client, session: Session, accessibleModules: readonly string[], importerKey: string, input: { bytes: Uint8Array; fileName: string; mapping?: Record<string, string> | null; dryRun?: boolean }): Promise<{
  importer: string; dryRun: boolean; total: number; created: number; duplicates: number; failed: number; results: ImportResult[];
}>;
export function buildImportErrorFile(results: ImportResult[]): string;
export type DataChecklist = { cutoverDate: string | null; done: number; total: number; steps: Array<{ key: string; stage: string; label: string; count: number; done: boolean; href: string; allowed: boolean }> };
export function getDataChecklist(client: Client, session: Session, accessibleModules: readonly string[]): Promise<DataChecklist>;
export function setDataCutoverDate(client: Client, session: Session, value: string | null): Promise<{ cutoverDate: string | null }>;
