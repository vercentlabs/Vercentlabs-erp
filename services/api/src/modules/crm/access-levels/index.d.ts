type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Session = { organizationId: string; userId: string; roleSlugs: string[]; permissions: string[] };
export type CrmAccessLevelKey = "none" | "salesperson" | "manager" | "admin";
export const CRM_ACCESS_LEVELS: ReadonlyArray<{ key: CrmAccessLevelKey; label: string; slug: string | null; description: string }>;
export type CrmAccessMember = { userId: string; name: string; email: string; level: CrmAccessLevelKey; isOwner: boolean; otherRoles: string[] };
export function listCrmAccess(client: QueryClient, session: Session): Promise<{ levels: Array<{ key: CrmAccessLevelKey; label: string; description: string; available: boolean }>; members: CrmAccessMember[] }>;
export function setCrmAccessLevel(client: QueryClient, session: Session, userId: string, level: string): Promise<CrmAccessMember | undefined>;
