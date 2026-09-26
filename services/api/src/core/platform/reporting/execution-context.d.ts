export function resolveMemberExecutionContext(
  client: { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> },
  organizationId: string,
  input: { userId: string; activeCompanyId?: string | null; activeBranchId?: string | null },
): Promise<Readonly<{ organizationId: string; userId: string; activeCompanyId: string | null; activeBranchId: string | null; companyId: string | null; allowAllCompanies: boolean; permissions: string[]; roleSlugs: string[]; emailVerified: boolean }> | null>;
