export type QueryableClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount?: number | null;
  }>;
};

export function setTenantContext(
  client: QueryableClient,
  organizationId: string,
): Promise<void>;

export function setUserContext(client: QueryableClient, userId: string): Promise<void>;

export function runTenantTransaction<T, C extends QueryableClient = QueryableClient>(
  client: C,
  organizationId: string,
  work: (client: C) => Promise<T>,
): Promise<T>;

export class RuntimeCheckError extends Error {
  readonly code: string;
}
export function restrictedRoleRequired(environment?: Record<string, string | undefined>): boolean;
export function verifyRestrictedRuntimeRole(queryable: QueryableClient, label?: string): Promise<string>;
export type ExpectedMigrations = {
  readonly platform: readonly string[];
  readonly tenant: readonly string[];
  readonly contracts: { readonly platform: readonly string[]; readonly tenant: readonly string[] };
};
export const EXPECTED_MIGRATIONS: ExpectedMigrations;
export function readMigrationStatus(
  queryable: QueryableClient,
  expected?: ExpectedMigrations,
): Promise<{ ready: boolean; missing: string[]; latest: { platform: string | null; tenant: string | null } }>;
export type DbSslConfig = { rejectUnauthorized: boolean; ca?: string } | undefined;
export function resolveDbSsl(env?: Record<string, string | undefined>): DbSslConfig;
export type TableClassEntry = { class: string; reason: string | null; [key: string]: unknown };
export const TABLE_CLASSES: readonly string[];
export const PUBLIC_TABLES: Readonly<Record<string, TableClassEntry>>;
export const DEFINER_FUNCTIONS: Readonly<Record<string, { web?: boolean; worker?: boolean; trigger?: boolean; retired?: boolean; reason: string }>>;
export function classifyPublicTable(name: string): TableClassEntry | null;
export function organizationScopedTables(): string[];
export function runtimePrivileges(role: "web" | "worker", table: string, entry: TableClassEntry | null): readonly string[];
