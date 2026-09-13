/**
 * Rewrites an admin/migration connection string to use the least-privilege
 * `erp_runtime` role (see database/migrations/platform/0006_create_runtime_role_and_rls.sql)
 * against the same host/port/database. apps/api and apps/worker must issue
 * every domain query through this role, never the migration/admin role - the
 * admin role can bypass RLS and column-level GRANTs entirely.
 *
 * The dev-only default password below matches the one the migration seeds
 * locally. Production must set `RUNTIME_DATABASE_URL` explicitly (via a
 * secrets manager) rather than relying on this derivation - see
 * docs/security/tenant-isolation.md.
 */
export function toRuntimeConnectionString(
  adminUrl: string,
  credentials: { user: string; password: string } = {
    user: 'erp_runtime',
    password: 'erp_runtime_dev_password',
  },
): string {
  const url = new URL(adminUrl);
  url.username = credentials.user;
  url.password = credentials.password;
  return url.toString();
}
