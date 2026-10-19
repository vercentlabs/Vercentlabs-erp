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
  input: { id?: string | null; organizationId: string; commandKey: string; entityId: string; title: string; requestedBy: string; assignedTo?: string | null; payload: Record<string, string>;
    approverRoleId?: string | null; approvalLevel?: number | null; approvalRuleId?: string | null },
): Promise<{ id: string; status: string; version: number; created: boolean }>;
export function roleMembers(client: Client, organizationId: string, roleId: string): Promise<string[]>;

// Approval rules (Shared Platform plan 6).
type RuleSession = { organizationId: string; userId: string };
export type ApprovalRule = { id: string; documentType: string; name: string; minAmount: string; level: number; approverUserId: string | null; approverRoleId: string | null;
  approverName: string | null; active: boolean; updatedAt: string };
export const APPROVAL_RULE_DOCUMENTS: ReadonlyArray<Readonly<{ key: string; moduleKey: string; label: string; commandKey: string; description: string }>>;
export class ApprovalRuleError extends Error { status: number; code: string }
export function listApprovalRules(client: Client, session: RuleSession): Promise<{ rules: ApprovalRule[]; documents: Array<{ key: string; label: string; description: string }>; roles: Array<{ id: string; name: string }> }>;
export function saveApprovalRule(client: Client, session: RuleSession, input: { id?: string; documentType: string; name: string; minAmount: string | number; level: number; approverUserId?: string | null; approverRoleId?: string | null; active?: boolean }): Promise<ApprovalRule>;
export function deleteApprovalRule(client: Client, session: RuleSession, ruleId: string): Promise<{ deleted: true }>;
export function approvalLevelsFor(client: Client, organizationId: string, documentType: string, amount: string | number): Promise<ApprovalRule[]>;
export function requireRuleApprovals(client: Client, context: RuleSession, input: { documentType: string; documentId: string; amount: string | number; contentKey: string; title: string }): Promise<
  { required: false } | { required: true; approved: true; levels: number } | { required: true; approved: false; pending: { level: number; approver: string | null; levels: number } }>;
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
