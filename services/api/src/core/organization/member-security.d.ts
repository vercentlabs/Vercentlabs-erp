type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; sessionId?: string; roleSlugs?: readonly string[]; permissions?: readonly string[] };
export declare class MemberSecurityError extends Error { status: number; code: string }
export function resetMemberMfa(client: Queryable, session: Session, targetUserId: string, options?: { reason?: string }, env?: any): Promise<{ reset: boolean; sessionsSignedOut: number }>;
export function signOutMember(client: Queryable, session: Session, targetUserId: string, env?: any): Promise<{ sessionsSignedOut: number }>;
export function transferOwnership(client: Queryable, session: Session, input: { targetUserId: string; password: string }, env?: any): Promise<{ ownerUserId: string; previousOwnerUserId: string }>;
