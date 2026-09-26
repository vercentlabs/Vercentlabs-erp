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
