type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; activeCompanyId?: string | null; activeBranchId?: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };

export type ApprovalInboxRow = {
  id: string;
  label: string;
  moduleKey: string | null;
  moduleLabel: string | null;
  documentLabel: string;
  requestedByName: string | null;
  assignedToName: string | null;
  decidedByName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  version: number;
  isMine: boolean;
  href: string | null;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  rejectionNoteRequired: boolean;
};
export function approvalViewer(session: Session): { organizationId: string; userId: string; oversight: boolean; decidableCommandKeys: string[] };
export function listApprovalInbox(client: Client, session: Session, options?: { status?: string; accessibleModules?: readonly string[] }): Promise<ApprovalInboxRow[]>;
export function getActionablePendingApprovalCount(client: Client, session: Session): Promise<number>;
export function decideApproval(
  client: Client,
  session: Session,
  approvalId: string,
  input: { decision: "approved" | "rejected" | "cancelled"; note?: string | null; expectedVersion?: number | null },
  options?: { accessibleModules?: readonly string[]; env?: any },
): Promise<{ approval: Record<string, unknown>; outcome: unknown }>;
