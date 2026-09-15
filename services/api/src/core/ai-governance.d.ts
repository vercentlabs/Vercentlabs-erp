export declare const AI_POLICY_DISABLED: string;
export declare const AI_POLICY_MISSING: string;
export declare const AI_APPROVAL_REQUIRED: string;
export declare const AI_TOOL_DENIED: string;
export declare class AiGovernanceError extends Error {
  status: number;
  code?: string;
}
export declare function assertAiActionPolicy(input: { enabled: boolean; allowRead: boolean; allowPropose: boolean; allowExecute: boolean; requiresApproval: boolean; requestType: "read" | "propose" | "execute" }): void;
export declare function setAiPolicy(client: any, session: any, input: any): Promise<any>;
export declare function listAiPolicies(client: any, organizationId: string): Promise<any[]>;
export declare function recordAiEvaluation(client: any, session: any, input: any): Promise<{ id: string; passed: boolean }>;
export declare function recordAiRequest(client: any, session: any, input: any): Promise<any>;
