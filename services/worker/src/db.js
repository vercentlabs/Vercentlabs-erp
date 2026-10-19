import pg from "pg";
import { loadSecretFiles, validateRuntimeEnvironment } from "@vercentlabs/config/production";
import { resolveDbSsl, restrictedRoleRequired, runTenantTransaction, verifyRestrictedRuntimeRole } from "@vercentlabs/database";
import { createLogger, monitorPool } from "@vercentlabs/observability";

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
  monitorPool(pool, logger, { name: "worker", maximum: config.database.poolMaximum });
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

// Shared Platform plan 8: only the companies with something due (jobs, events, automation runs, webhook deliveries), oldest work first —
// one query instead of visiting every company. A database without the function (before migration 0192) falls back to every company.
export async function listDueOrganizationIds(runtimePool, limit = 500) {
  try {
    const { rows } = await runtimePool.query(`SELECT organization_id FROM public.worker_due_organizations($1)`, [limit]);
    return rows.map((row) => row.organization_id);
  } catch (error) {
    if (error?.code === "42883") return listActiveOrganizationIds(runtimePool);
    throw error;
  }
}

// Removes finished history past its retention (public.prune_platform_history), batch after batch, at most `rounds` times.
export async function prunePlatformHistory(runtimePool, { batch = 5000, rounds = 10 } = {}) {
  const totals = {};
  for (let round = 0; round < rounds; round += 1) {
    const { rows } = await runtimePool.query(`SELECT kind, removed FROM public.prune_platform_history($1)`, [batch]);
    let more = false;
    for (const row of rows) {
      totals[row.kind] = (totals[row.kind] ?? 0) + Number(row.removed);
      if (Number(row.removed) >= batch) more = true;
    }
    if (!more) break;
  }
  return totals;
}

export async function withTenantClient(runtimePool, organizationId, work) {
  const client = await runtimePool.connect();
  try {
    return await runTenantTransaction(client, organizationId, work);
  } finally {
    client.release();
  }
}
