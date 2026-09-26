import type { ObjectStorage } from "@vercentlabs/document-engine";

type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; activeCompanyId?: string | null; activeBranchId?: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };
type Env = Record<string, string | undefined>;

export const REPORT_RUN_JOB_TYPE: string;
export class ReportError extends Error {
  status: number;
  code: string;
}
export function listReportDatasets(session: Session, accessibleModules: readonly string[]): Array<{ key: string; moduleKey: string; label: string; description: string; columns: ReadonlyArray<{ key: string; label: string }>; filters: ReadonlyArray<{ key: string; label: string }>; maxRows: number }>;
export function listReportDefinitions(client: Client, session: Session, accessibleModules: readonly string[]): Promise<Array<{ id: string; name: string; datasetKey: string; datasetLabel: string; columns: string[]; filters: Record<string, string>; status: string; createdByName: string | null; isMine: boolean; updatedAt: string }>>;
export function createReportDefinition(client: Client, session: Session, accessibleModules: readonly string[], input: { name: string; datasetKey: string; columns?: string[]; filters?: Record<string, string>; schedule?: unknown }): Promise<{ id: string }>;
export function setReportDefinitionStatus(client: Client, session: Session, definitionId: string, status: "active" | "inactive"): Promise<{ id: string; status: string }>;
export function requestReportRun(client: Client, session: Session, accessibleModules: readonly string[], input: { definitionId?: string; datasetKey?: string; columns?: string[]; filters?: Record<string, string> }): Promise<{ id: string; status: string; jobId: string }>;
export function listReportRuns(client: Client, session: Session): Promise<
  Array<{ id: string; datasetKey: string; datasetLabel: string; definitionName: string | null; status: string; rowCount: number | null; error: string | null; requestedByName: string | null; requestedAt: string; completedAt: string | null; downloadable: boolean; outputExpiresAt: string | null }>
>;
export function executeReportRun(client: Client, organizationId: string, payload: { reportRunId: string; activeCompanyId?: string | null; activeBranchId?: string | null }, options?: { env?: Env; storage?: ObjectStorage }): Promise<{ rowCount?: number; fileId?: string; skipped?: boolean }>;
export function failReportRun(client: Client, organizationId: string, reportRunId: string, error: unknown): Promise<void>;
export function readReportRunOutput(client: Client, session: Session, runId: string, options?: { storage?: ObjectStorage }): Promise<{ id: string; fileName: string; mimeType: string; sizeBytes: number; contentSha256: string | null; body: Buffer }>;
