export declare class OrganizationAdministrationError extends Error {
  status: number;
  code?: string;
}
export declare function getOrganizationProfile(client: any, organizationId: string): Promise<any>;
export declare function updateOrganizationProfile(client: any, session: any, updates: { name?: string; timezone?: string; fiscalYearStartMonth?: number }): Promise<any>;
export declare function listOrganizationCompanies(client: any, session: any): Promise<any[]>;
export declare function createCompany(
  client: any,
  session: any,
  input: { name: string; legalName: string; code: string; countryCode: string; baseCurrency: string; taxId?: string; isPrimary?: boolean },
): Promise<any>;
export declare function updateCompany(client: any, session: any, companyId: string, updates: { name?: string; legalName?: string; taxId?: string | null; status?: string }): Promise<any>;
export declare function listOrganizationBranches(client: any, session: any, companyId?: string | null): Promise<any[]>;
export declare function createBranch(
  client: any,
  session: any,
  input: { name: string; code: string; timezone: string; companyId: string; isPrimary?: boolean },
): Promise<any>;
export declare function updateBranch(client: any, session: any, branchId: string, updates: { name?: string; timezone?: string; status?: string }): Promise<any>;
export declare function setUserCompanyAccess(client: any, session: any, targetUserId: string, companyIds: string[]): Promise<{ companyIds: string[] }>;
export declare function setUserBranchAccess(client: any, session: any, targetUserId: string, branchIds: string[]): Promise<{ branchIds: string[] }>;
export declare function listOrganizationRoles(client: any, session: any): Promise<any[]>;
export declare function listOrganizationMembers(client: any, session: any): Promise<any[]>;
export declare function setMemberStatus(client: any, session: any, targetUserId: string, status: "active" | "disabled"): Promise<{ userId: string; status: string }>;
