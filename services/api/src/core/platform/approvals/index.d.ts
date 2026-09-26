type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export type ApprovalCommand = {
  key: string;
  moduleKey: string;
  entityType: string;
  label: string;
  entityLabel: string;
  requiredPermission: string;
  payload: readonly string[];
  dedupeKey: (payload: Record<string, string>) => string;
};
export const APPROVAL_COMMANDS: readonly ApprovalCommand[];
export function getApprovalCommand(key: string): ApprovalCommand | null;

export class ApprovalError extends Error {
  status: number;
  code: string;
}
export type ApprovalRequestRow = Record<string, any> & { id: string; status: string; version: number };

export function createApprovalRequest(
  client: Client,
  input: { id?: string | null; organizationId: string; commandKey: string; entityId: string; title: string; requestedBy: string; assignedTo?: string | null; payload: Record<string, string> },
): Promise<{ id: string; status: string; version: number; created: boolean }>;
export function finalizeApprovalRequest(
  client: Client,
  input: { organizationId: string; commandKey: string; entityId: string; approvalRequestId?: string | null; decision: "approved" | "rejected" | "cancelled"; actorUserId: string | null; note?: string | null },
): Promise<Array<{ id: string; status: string; version: number }>>;
export function lockApprovalRequest(client: Client, organizationId: string, approvalId: string): Promise<ApprovalRequestRow>;
export function validateApprovalDecision(
  request: ApprovalRequestRow,
  input: { decision: string; note?: string | null; expectedVersion?: number | null; actorUserId: string },
): { decision: "approved" | "rejected" | "cancelled"; note: string | null; expectedVersion: number };
export function recordApprovalDecision(client: Client, request: ApprovalRequestRow, input: { decision: string; actorUserId: string; note: string | null }): Promise<Record<string, any>>;
export type ApprovalViewer = { organizationId: string; userId: string; oversight: boolean; decidableCommandKeys: string[] };
export function listApprovalRequestsForViewer(client: Client, viewer: ApprovalViewer, options?: { status?: string; limit?: number }): Promise<ApprovalRequestRow[]>;
export function countPendingApprovalsForViewer(client: Client, viewer: ApprovalViewer): Promise<number>;
