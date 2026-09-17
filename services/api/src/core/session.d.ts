export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword(password: string, stored: string): Promise<boolean>;
export declare function verifyPasswordOrDummy(password: string, stored?: string | null): Promise<boolean>;
export declare function createOpaqueToken(): string;
export declare function tokenHash(token: string): string;
export declare function createSession(client: any, options: { userId: string; ipAddress?: string | null; userAgent?: string | null; organizationId?: string | null; env?: any }): Promise<{ sessionId: string; token: string; expiresAt: Date }>;
export declare function setSessionOrganization(client: any, sessionId: string, userId: string, organizationId: string): Promise<boolean>;
export declare function revokeSessionByTokenHash(client: any, hash: string, reason?: string): Promise<void>;
export declare function listSessionsForUser(client: any, userId: string): Promise<Array<{
  id: string;
  deviceName: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionType: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}>>;
export declare function revokeSessionById(client: any, userId: string, sessionId: string, reason?: string): Promise<boolean>;
export declare function revokeOtherSessions(client: any, userId: string, currentSessionId: string, reason?: string): Promise<number>;
export declare function resolveSessionContext(client: any, token: string, sessionType: "browser" | "mobile", env?: any): Promise<any | null>;

export declare class ContextSwitchError extends Error {
  status: number;
  code?: string;
}
export declare function listAccessibleCompanies(client: any, organizationId: string, userId: string): Promise<Array<{ id: string; name: string; branches: Array<{ id: string; company_id: string; name: string }> }>>;
export declare function switchActiveCompany(client: any, session: any, companyId: string, branchId?: string | null): Promise<{ companyId: string; branchId: string | null }>;
