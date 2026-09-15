export declare class AccessAdministrationError extends Error {
  status: number;
  code: string;
}
export declare function validateRoleSelection(client: any, input: any): Promise<any>;
export declare function hasUnrestrictedAccessAdministration(roleSlugs: readonly string[]): boolean;
export declare function assertUserWithinAdministrationScope(client: any, input: any): Promise<void>;
export declare function assertInvitationWithinAdministrationScope(client: any, input: any): Promise<void>;
export declare function validateScopeGrantCeiling(client: any, input: any): Promise<void>;
export declare function validateInvitationRolesForAcceptance(client: any, input: any): Promise<any[]>;
export declare function recordRoleSnapshot(client: any, input: any): Promise<void>;
export declare function getUserAccessState(client: any, organizationId: string, userId: string): Promise<any>;
