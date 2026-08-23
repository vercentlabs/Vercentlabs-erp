import pg from "pg";
import { validateRuntimeEnvironment } from "@vercentlabs/config";
import { setTenantContext } from "@vercentlabs/database";
import { createLogger } from "@vercentlabs/observability";

const { Pool } = pg;
const logger = createLogger("worker-db");

let pool;
let roleVerified;

// Mirrors apps/web/src/core/db.ts's own verifyRuntimeRole() check
// independently rather than importing it, because the worker is a
// genuinely separate deployable process with its own DATABASE_URL/
// credential in production — trusting apps/web to have already checked
// its own connection tells us nothing about the worker's. A worker
// running with a superuser/BYPASSRLS credential is exactly as dangerous
// as apps/web running with one.
async function verifyRuntimeRole(runtimePool) {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.ENFORCE_RESTRICTED_DB_ROLE !== "true"
  ) {
    return;
  }

  const { rows } = await runtimePool.query(`
    SELECT
      current_user AS role_name,
      role.rolsuper AS is_superuser,
      role.rolbypassrls AS bypasses_rls,
      role.rolinherit AS inherits_roles,
      role.rolcreatedb AS can_create_database,
      role.rolcreaterole AS can_create_roles,
      role.rolreplication AS can_replicate,

      EXISTS (
        SELECT 1
        FROM pg_class relation
        JOIN pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        WHERE relation.relowner = role.oid
          AND namespace.nspname IN ('public', 'tenant')
      ) AS owns_relations,

      EXISTS (
        SELECT 1
        FROM pg_namespace namespace
        WHERE namespace.nspname IN ('public', 'tenant')
          AND has_schema_privilege(
            current_user,
            namespace.oid,
            'CREATE'
          )
      ) AS can_create_schema_objects,

      EXISTS (
        SELECT 1
        FROM pg_auth_members membership
        JOIN pg_roles granted_role
          ON granted_role.oid = membership.roleid
        WHERE membership.member = role.oid
          AND (
            granted_role.rolsuper
            OR granted_role.rolbypassrls
            OR granted_role.rolcreatedb
            OR granted_role.rolcreaterole
            OR granted_role.rolreplication
          )
      ) AS has_dangerous_membership

    FROM pg_roles role
    WHERE role.rolname = current_user
  `);

  const role = rows[0];

  if (
    !role ||
    role.is_superuser ||
    role.bypasses_rls ||
    role.inherits_roles ||
    role.can_create_database ||
    role.can_create_roles ||
    role.can_replicate ||
    role.owns_relations ||
    role.can_create_schema_objects ||
    role.has_dangerous_membership
  ) {
    throw new Error(
      'WORKER DATABASE_URL must use a restricted ' +
      'NOINHERIT, NOSUPERUSER, NOBYPASSRLS runtime role ' +
      'that owns no application relations, has no CREATE ' +
      'privilege on public/tenant schemas, and has no ' +
      'privileged role memberships.',
    );
  }
}

export function getWorkerConfig(environment = process.env) {
  return validateRuntimeEnvironment("worker", environment);
}

export async function getPool() {
  if (pool) return pool;
  const config = getWorkerConfig();
  pool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.poolMaximum,
    idleTimeoutMillis: config.database.idleTimeoutMilliseconds,
    connectionTimeoutMillis: config.database.connectionTimeoutMilliseconds,
    query_timeout: config.database.queryTimeoutMilliseconds,
    statement_timeout: config.database.statementTimeoutMilliseconds,
    application_name: "vercentlabs-worker",
    ssl: process.env.NODE_ENV === "production" && !config.database.connectionString.includes("localhost") ? { rejectUnauthorized: true } : undefined,
  });
  pool.on("error", (error) => logger.error("idle client error", { error: String(error?.message || error) }));
  if (!roleVerified) {
    roleVerified = verifyRuntimeRole(pool);
  }
  await roleVerified;
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
    roleVerified = undefined;
  }
}

// Organizations live in the control-plane public schema, not under
// tenant.* RLS — listing them is not a tenant-isolation concern (this
// query returns ids only, no tenant business data). Every subsequent
// per-organization query the worker makes still goes through
// setTenantContext()+RLS, exactly like every other part of this
// application — there is no cross-tenant bypass here, only a directory
// lookup of which tenants exist.
export async function listActiveOrganizationIds(runtimePool) {
  const { rows } = await runtimePool.query(
    `SELECT id FROM organizations WHERE status = 'active' ORDER BY created_at ASC`,
  );
  return rows.map((row) => row.id);
}

export async function withTenantClient(runtimePool, organizationId, work) {
  const client = await runtimePool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, organizationId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
