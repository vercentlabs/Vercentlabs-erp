export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, stored: string): Promise<boolean>;
export declare function verifyPasswordOrDummy(password: string, stored?: string | null): Promise<boolean>;
export declare function createOpaqueToken(): string;
export declare function tokenHash(token: string): string;
export declare function createSession(client: any, options: { userId: string; ipAddress?: string | null; userAgent?: string | null; organizationId?: string | null; env?: any }): Promise<{ sessionId: string; token: string; expiresAt: Date }>;
export declare function setSessionOrganization(client: any, sessionId: string, userId: string, organizationId: string): Promise<boolean>;
export declare function revokeSessionByTokenHash(client: any, hash: string, reason?: string): Promise<void>;
export declare function resolveSessionContext(client: any, token: string, sessionType: "browser" | "mobile", env?: any): Promise<any | null>;
