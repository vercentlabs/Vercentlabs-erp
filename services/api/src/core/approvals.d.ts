export declare class ApprovalError extends Error {
  status: number;
  code?: string;
}
export declare function listApprovals(client: any, session: any, options?: { status?: string; limit?: number }): Promise<any[]>;
export declare function getPendingApprovalCount(client: any, organizationId: string): Promise<number>;
export declare function decideApproval(client: any, session: any, approvalId: string, input: { decision: string; note?: string | null }): Promise<{ approval: any; outcome: any }>;
