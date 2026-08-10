import pg from "pg";
import { validateRuntimeEnvironment } from "@vercentlabs/config";
import { setTenantContext } from "@vercentlabs/database";
import { createLogger } from "@vercentlabs/observability";

const { Pool } = pg;
const logger = createLogger("worker-db");

let pool;
let roleVerified;

// Mirrors apps/web/src/lib/db.ts's own verifyRuntimeRole() check
// independently rather than importing it, because the worker is a
// genuinely separate deployable process with its own DATABASE_URL/
// credential in production — trusting apps/web to have already checked
// its own connection tells us nothing about the worker's. A worker
// running with a superuser/BYPASSRLS credential is exactly as dangerous
// as apps/web running with one.
async function verifyRuntimeRole(runtimePool) {
  if (process.env.NODE_ENV !== "production" && process.env.ENFORCE_RESTRICTED_DB_ROLE !== "true") {
    return;
  }
  const { rows } = await runtimePool.query(
    `SELECT current_user AS role_name, role.rolsuper AS is_superuser, role.rolbypassrls AS bypasses_rls,
            role.rolcreatedb AS can_create_database, role.rolcreaterole AS can_create_roles,
            role.rolreplication AS can_replicate
       FROM pg_roles role WHERE role.rolname = current_user`,
    [],
  );
  const role = rows[0];
  if (!role) throw new Error("Unable to verify the worker's database role.");
  const unsafe = role.is_superuser || role.bypasses_rls || role.can_create_database || role.can_create_roles || role.can_replicate;
  if (unsafe) {
    throw new Error(
      `WORKER DATABASE_URL must use a restricted NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION runtime role (current role "${role.role_name}" fails this check).`,
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
