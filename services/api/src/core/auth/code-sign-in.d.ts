type Q = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type S = { organizationId?: string | null; userId: string; sessionId?: string | null; email?: string; fullName?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare const REAUTH_MINUTES: number;
export declare const CONFIRM_WITH_CODE: string;
export declare function requestSignInCode(client: Q, email: string, env?: Record<string, string | undefined>): Promise<{ message: string }>;
export declare function verifySignInCode(client: Q, email: string, code: string, env?: Record<string, string | undefined>): Promise<{ ok: true; userId: string } | { ok: false; reason: "wrong" | "expired" | "locked" }>;
export declare function requestReauthCode(client: Q, session: S, env?: Record<string, string | undefined>): Promise<{ resendAfterSeconds: number; expiresInMinutes: number }>;
export declare function verifyReauthCode(client: Q, session: S, code: string): Promise<{ ok: true } | { ok: false; reason: "wrong" | "expired" | "locked" }>;
export declare function identityConfirmed(client: Q, input: { userId: string; sessionId?: string | null; password?: string }): Promise<{ ok: boolean; needsCode: boolean }>;
