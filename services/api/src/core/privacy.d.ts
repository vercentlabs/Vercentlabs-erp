export declare class PrivacyError extends Error {
  status: number;
}
export declare function assertPrivacyTransition(current: string, next: string): void;
export declare function createPrivacyRequest(client: any, session: any, input: any): Promise<any>;
export declare function transitionPrivacyRequest(client: any, session: any, id: string, next: string, resultPayload?: unknown): Promise<any>;
export declare function listPrivacyRequests(client: any, organizationId: string): Promise<any[]>;
export declare function writeRetentionPolicy(client: any, session: any, input: any): Promise<any>;
export declare function listRetentionPolicies(client: any, organizationId: string): Promise<any[]>;
