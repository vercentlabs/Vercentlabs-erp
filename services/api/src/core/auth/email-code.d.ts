type Q = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
export declare const CODE_RULES: Readonly<{ length: number; minutes: number; tries: number; resendSeconds: number; perHour: number }>;
export declare class EmailCodeError extends Error { status: number; code: string; details?: unknown }
export declare function codeError(reason: string): EmailCodeError;
export declare function issueEmailCode(client: Q, input: { email: string; purpose: "signup" | "sign_in" | "reauth"; signupId?: string | null; userId?: string | null; firstName?: string | null; mail?: "code" | "no_account" }, env?: Record<string, string | undefined>): Promise<{ resendAfterSeconds: number; expiresInMinutes: number }>;
export declare function checkEmailCode(client: Q, input: { email: string; purpose: string; code: string }): Promise<{ ok: true; row: Record<string, any> } | { ok: false; reason: "wrong" | "expired" | "locked"; row?: Record<string, any> }>;
export declare function pruneEmailCodes(client: Q): Promise<void>;
