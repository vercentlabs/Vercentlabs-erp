export declare class OrganizationAdministrationError extends Error {
  status: number;
  code?: string;
}
export declare function getOrganizationProfile(client: any, organizationId: string): Promise<any>;
export declare function updateOrganizationProfile(client: any, session: any, updates: { name?: string; timezone?: string; fiscalYearStartMonth?: number }): Promise<any>;
export declare function listOrganizationRoles(client: any, session: any): Promise<any[]>;
export declare function listOrganizationMembers(client: any, session: any): Promise<any[]>;
export declare function setMemberStatus(client: any, session: any, targetUserId: string, status: "active" | "disabled"): Promise<{ userId: string; status: string }>;
