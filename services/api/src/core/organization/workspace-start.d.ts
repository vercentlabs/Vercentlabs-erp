type Q = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type S = { organizationId: string; userId: string; sessionId?: string | null; email?: string; fullName?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class WorkspaceStartError extends Error { status: number; code: string; details?: unknown }
export type GstDetailsStatus = { needed: boolean; taxEnabled: boolean; gstin: string | null; stateCode: string | null; canEdit: boolean };
export declare function getGstDetailsStatus(client: Q, session: S): Promise<GstDetailsStatus>;
export declare function saveGstDetails(client: Q, session: S, input: { registered: boolean; gstin?: string; stateCode?: string }): Promise<GstDetailsStatus>;
export declare function startingModule(client: Q, session: S, accessible: string[]): Promise<string | null>;
export declare function rememberLastModule(client: Q, session: S, moduleKey: string): Promise<void>;
export type WorkspaceGuide =
  | { kind: "get_started"; moduleKey: string; title: string; tasks: Array<{ label: string; href: string | null; action: string | null; done: boolean }>; done: number }
  | { kind: "welcome"; title: string; line: string; metrics: Array<{ label: string; count: number; href: string; mine?: boolean }> };
export declare function getWorkspaceGuide(client: Q, session: S, moduleKey: string, accessible?: string[]): Promise<WorkspaceGuide | null>;
export declare function dismissWorkspaceGuide(client: Q, session: S, input: { guide: string; moduleKey?: string }): Promise<{ dismissed: true }>;
export declare function reopenWorkspaceGuide(client: Q, session: S, moduleKey: string): Promise<{ reopened: true }>;
