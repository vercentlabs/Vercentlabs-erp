type Client = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };
type Session = { organizationId: string; userId: string; activeCompanyId?: string | null; activeBranchId?: string | null; permissions: readonly string[]; roleSlugs: readonly string[] };

export const SEARCH_LIMITS: Readonly<{ minLength: number; maxLength: number; perProvider: number; total: number }>;
export class SearchError extends Error {
  status: number;
  code: string;
}
export type SearchHit = { sourceKey: string; sourceLabel: string; moduleKey: string; recordId: string; title: string; detail: string | null; href: string };
export type SearchProvider = { key: string; label: string; moduleKey: string; requiredPermission: string; execute(client: Client, context: Record<string, unknown>, term: string, limit: number): Promise<Array<{ recordId: string; title: string; detail: string | null; href: string }>> };
export type SearchGroup = { sourceKey: string; sourceLabel: string; moduleKey: string; status: "ok" | "unavailable"; results: SearchHit[] };
export function normalizeSearchQuery(raw: unknown): string | null;
export function searchableProviders(session: Session, accessibleModules: readonly string[], providers?: readonly SearchProvider[]): SearchProvider[];
export function searchRecords(client: Client, session: Session, input: { query: string; accessibleModules?: readonly string[]; providers?: readonly SearchProvider[] }): Promise<{ query: string; groups: SearchGroup[] }>;
