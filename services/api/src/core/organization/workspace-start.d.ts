type Q = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type S = { organizationId: string; userId: string; sessionId?: string | null; email?: string; fullName?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class WorkspaceStartError extends Error { status: number; code: string; details?: unknown }
export type GstDetailsStatus = { needed: boolean; taxEnabled: boolean; gstin: string | null; stateCode: string | null; canEdit: boolean };
export declare function getGstDetailsStatus(client: Q, session: S): Promise<GstDetailsStatus>;
export declare function saveGstDetails(client: Q, session: S, input: { registered: boolean; gstin?: string; stateCode?: string }): Promise<GstDetailsStatus>;
