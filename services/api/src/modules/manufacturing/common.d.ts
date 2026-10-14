export declare class MfgError extends Error { status: number; code: string; constructor(status: number, message: string, code?: string); }
export declare function manufacturingContext(session: Record<string, unknown>): { organizationId: string; userId: string; permissions: string[]; roleSlugs: string[] };
