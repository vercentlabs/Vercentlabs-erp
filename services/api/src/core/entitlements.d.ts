export declare class EntitlementError extends Error {
  status: number;
  code: string;
}
export declare function billingEnforcementMode(env?: any): "observe" | "enforce";
export declare function getBillingSummary(client: any, organizationId: string, env?: any): Promise<any>;
export declare function requireBillingWriteAccess(client: any, organizationId: string, env?: any): Promise<any>;
export declare function incrementBillingUsage(client: any, organizationId: string, metric: string, quantity?: number, options?: { idempotencyKey?: string; source?: string; env?: any }): Promise<{ replayed: boolean; quantity: number | null }>;
export declare function assertModuleEntitlement(client: any, organizationId: string, moduleKey: string, env?: any): Promise<any>;
export declare function assertOrganizationLimit(client: any, organizationId: string, limitKey: "companies" | "branches", env?: any): Promise<void>;
