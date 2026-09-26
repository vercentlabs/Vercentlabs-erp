// Fixtures for `pnpm test:production:db`: the migration owner plus the TWO
// restricted runtime roles production uses (web: DATABASE_URL, worker:
// WORKER_DATABASE_URL). Rows are created as the owner; every assertion runs
// as a runtime role, the way production code reaches the database.
import { randomUUID } from "node:crypto";

import pg from "pg";

export function requireProductionDatabases() {
  for (const name of ["MIGRATION_DATABASE_URL", "DATABASE_URL", "WORKER_DATABASE_URL"]) {
    if (!String(process.env[name] || "").trim()) throw new Error(`${name} is required for test:production:db.`);
  }
}

export async function createProductionKit() {
  requireProductionDatabases();
  const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, application_name: "production-tests-owner" });
  await owner.connect();
  const web = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, application_name: "production-tests-web" });
  const worker = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL, max: 2, application_name: "production-tests-worker" });
  const organizations = [];
  const users = [];

  async function user(label) {
    const id = randomUUID();
    await owner.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'x','active',now())`, [id, `prod-${label}-${id}@test.invalid`, `Prod ${label}`]);
    users.push(id);
    return id;
  }

  async function organization(label) {
    const ownerId = await user(`${label}-owner`);
    const organizationId = randomUUID();
    await owner.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`, [organizationId, `Prod ${label}`, `prod-${organizationId}`, ownerId]);
    organizations.push(organizationId);
    await owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [organizationId, ownerId]);
    return { organizationId, ownerId };
  }

  // A transaction on a runtime pool with optional organisation/user context.
  async function as(pool, { organizationId = null, userId = null } = {}, work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (organizationId) await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      if (userId) await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function close() {
    if (organizations.length) {
      await owner.query("SET session_replication_role = replica").catch(() => undefined);
      await owner.query(`DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
      const tenantTables = (await owner.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
      for (const row of tenantTables) await owner.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
      await owner.query("SET session_replication_role = DEFAULT").catch(() => undefined);
      await owner.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [organizations]);
    }
    if (users.length) await owner.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => undefined);
    await web.end().catch(() => undefined);
    await worker.end().catch(() => undefined);
    await owner.end().catch(() => undefined);
  }

  return { owner, web, worker, user, organization, as, close };
}

export const expectPostgresError = (pattern) => (error) => pattern.test(String(error?.message || "")) || pattern.test(String(error?.code || ""));
