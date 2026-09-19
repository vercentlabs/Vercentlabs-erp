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
export declare function listOrganizationRolesDetailed(client: any, session: any): Promise<any[]>;
export declare function listPermissionCatalog(client: any, session: any): Promise<any[]>;
export declare function createRole(client: any, session: any, input: any): Promise<any>;
export declare function updateRole(client: any, session: any, roleId: string, input: any): Promise<any>;
export declare function archiveRole(client: any, session: any, roleId: string): Promise<void>;
export declare function setUserRoles(client: any, session: any, input: any): Promise<any>;
