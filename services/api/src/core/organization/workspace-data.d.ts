type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; sessionId?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class WorkspaceDataError extends Error { status: number; code: string }
export const WORKSPACE_EXPORT_JOB_TYPE: string;
export const CLOSURE_WAITING_DAYS: number;
export function requestWorkspaceExport(client: Queryable, session: Session): Promise<{ jobId: string; alreadyRunning: boolean }>;
export function buildWorkspaceExport(client: Queryable, input: { organizationId: string; requestedBy?: string | null }, options?: any): Promise<{ fileId: string; tables: number; files: number; bytes: number }>;
export function listWorkspaceExports(client: Queryable, organizationId: string): Promise<Array<{ id: string; fileName: string; sizeBytes: number; createdAt: string; expiresAt: string | null }>>;
export function readWorkspaceExport(client: Queryable, session: Session, fileId: string, options?: any): Promise<{ body: Buffer; fileName?: string; mimeType?: string }>;
export type WorkspaceClosure = { requestedAt: string | null; closesOn: string | null; closedAt: string | null; waitingDays: number };
export function getWorkspaceClosure(client: Queryable, organizationId: string): Promise<WorkspaceClosure>;
export function requestWorkspaceClosure(client: Queryable, session: Session, input: { password: string; confirmName: string }, env?: any): Promise<WorkspaceClosure>;
export function cancelWorkspaceClosure(client: Queryable, session: Session): Promise<WorkspaceClosure>;
export function closeDueWorkspaces(client: Queryable, options?: { limit?: number }): Promise<number>;
