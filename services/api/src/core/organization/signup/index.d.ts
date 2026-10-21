type Q = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type R = Record<string, any>;
export declare const READING_DEADLINE_MS: number;
export declare class SignupError extends Error { status: number; code: string; details?: unknown }
export declare class WebsiteReadError extends Error { reason: string }
export declare const SIGNUP_APPS: Readonly<Record<string, { name: string; line: string }>>;
export declare const SUGGESTER_MODEL: string;
export type SignupState = { next: "code" | "wait" | "describe" | "apps" | "done"; email: string; fullName: string; companyName: string; website: string | null; websiteFailed: boolean;
  profile: { description: string; confidence: string; sells: string | null; channels: string | null } | null;
  apps: { suggested: Array<{ key: string; name: string; reason: string; suggested: boolean }>; others: Array<{ key: string; name: string; reason: string; suggested: boolean }> };
  suggestionsLeft: number };
export declare function startSignup(client: Q, input: R, options?: { ipAddress?: string | null; env?: Record<string, string | undefined> }): Promise<{ token: string; signupId: string; email: string; website: string | null }>;
export declare function resendSignupCode(client: Q, token: string, env?: Record<string, string | undefined>): Promise<{ resendAfterSeconds: number; expiresInMinutes: number }>;
export declare function verifySignupCode(client: Q, token: string, code: string, env?: Record<string, string | undefined>): Promise<{ ok: true; existingUserId?: string | null; already?: boolean } | { ok: false; reason: "wrong" | "expired" | "locked" }>;
export declare function readSignupWebsite(transaction: <T>(fn: (client: Q) => Promise<T>) => Promise<T>, signupId: string, options?: { env?: Record<string, string | undefined>; allowPrivate?: boolean }): Promise<void>;
export declare function getSignupState(client: Q, token: string): Promise<SignupState>;
export declare function describeSignupBusiness(client: Q, token: string, text: string, options?: { env?: Record<string, string | undefined> }): Promise<SignupState>;
export declare function completeSignup(client: Q, token: string, input: { apps: string[] }, options?: { request?: Request | null; env?: Record<string, string | undefined> }): Promise<{ userId: string; organizationId: string; firstApp: string; apps: string[] }>;
export declare function suggestApps(input: { companyName: string; text: string; source: string }, options?: R): Promise<R | null>;
export declare function checkAppSuggestion(answer: unknown): R | null;
export declare function keywordSuggestion(companyName: string, text: string): R | null;
export declare function normalizeWebsite(value: unknown): string | null;
export declare function readWebsite(website: string, options?: { signal?: AbortSignal; allowPrivate?: boolean }): Promise<{ title: string; text: string; pages: string[] }>;
