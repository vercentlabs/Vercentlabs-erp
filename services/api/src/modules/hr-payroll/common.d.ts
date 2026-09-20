export declare function hrContext(session: Record<string, unknown>): { organizationId: string; companyId: string; userId: string; permissions: readonly string[]; roleSlugs: readonly string[] };
export declare class HrError extends Error { status: number; code: string }
