import pg from "pg";
import { loadSecretFiles, validateRuntimeEnvironment } from "@vercentlabs/config";
import { resolveDbSsl, restrictedRoleRequired, runTenantTransaction, verifyRestrictedRuntimeRole } from "@vercentlabs/database";
import { createLogger } from "@vercentlabs/observability";

const { Pool } = pg;
const logger = createLogger("worker-db");

let pool;
let roleVerified;

// The worker is a separate deployable with its own database authority
// (WORKER_DATABASE_URL in production), so it verifies its own connection: a
// worker running as a superuser/BYPASSRLS role is as dangerous as the web.
async function verifyRuntimeRole(runtimePool) {
  if (!restrictedRoleRequired(process.env)) return;
  await verifyRestrictedRuntimeRole(runtimePool, "The worker database URL");
}

export function getWorkerConfig(environment = process.env) {
  loadSecretFiles(environment);
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
    ssl: resolveDbSsl(process.env),
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
    return await runTenantTransaction(client, organizationId, work);
  } finally {
    client.release();
  }
}
