// Fixtures for the real-PostgreSQL shared runtime suites (`pnpm test:shared-runtime:db`).
// Fixtures are written with the migration role; domain calls run on the
// restricted runtime role (DATABASE_URL) inside tenant transactions, like the web app.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { setTenantContext } from "../../../packages/database/src/index.js";
import { buildWorkspaceAccessSnapshot } from "../../../services/api/src/core/access/index.js";
import { ensureDefaultLeadStages } from "../../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/stage-catalog.js";

export function requireDatabase() {
  assert.ok(process.env.MIGRATION_DATABASE_URL, "MIGRATION_DATABASE_URL is required: shared runtime DB tests never skip.");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL (restricted runtime role) is required.");
}

export async function createRuntimeKit() {
  requireDatabase();
  const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, application_name: "shared-runtime-tests-owner" });
  await owner.connect();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, application_name: "shared-runtime-tests-runtime" });
  const organizations = [];
  const users = [];

  async function user(label) {
    const id = randomUUID();
    await owner.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'x','active',now())`, [id, `rt-${label}-${id}@test.invalid`, `RT ${label}`]);
    users.push(id);
    return id;
  }

  // An organisation with one company/branch and the named members (all active).
  async function organization(memberLabels = ["owner"]) {
    const ids = {};
    for (const label of memberLabels) ids[label] = await user(label);
    const organizationId = randomUUID();
    const companyId = randomUUID();
    const branchId = randomUUID();
    const first = ids[memberLabels[0]];
    await owner.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'RT Org',$2,'IN','Asia/Kolkata','INR',$3)`, [organizationId, `rt-org-${organizationId}`, first]);
    organizations.push(organizationId);
    await owner.query(`INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES($1,$2,'RT Co','RT Co','RTCO','INR','IN',true,'active')`, [companyId, organizationId]);
    await owner.query(`INSERT INTO branches(id,organization_id,company_id,name,code,timezone,status) VALUES($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, organizationId, companyId]);
    for (const id of Object.values(ids)) {
      await owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [organizationId, id]);
      await owner.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES($1,$2,$3)`, [organizationId, id, companyId]);
      await owner.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES($1,$2,$3)`, [organizationId, id, branchId]);
    }
    const session = (label, permissions = [], roleSlugs = []) => ({
      organizationId, userId: ids[label], activeCompanyId: companyId, activeBranchId: branchId, permissions, roleSlugs, emailVerified: true,
    });
    return { organizationId, companyId, branchId, ids, session };
  }

  // Runtime-role tenant transaction (the same boundary the web app uses).
  async function tenant(organizationId, work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await setTenantContext(client, organizationId);
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

  async function runtime(work) {
    const client = await pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  // A CRM lead owned by ownerUserId (CRM default stages seeded through CRM itself).
  async function crmLead(org, ownerUserId, firstName, lastName) {
    const id = randomUUID();
    await tenant(org.organizationId, async (client) => {
      await ensureDefaultLeadStages(client, { organizationId: org.organizationId, userId: ownerUserId });
      await client.query(
        `INSERT INTO tenant.crm_leads (id, organization_id, company_id, code, first_name, last_name, email, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, org.organizationId, org.companyId, `L-${id.slice(0, 8)}`, firstName, lastName, `${id.slice(0, 8)}@example.test`, ownerUserId],
      );
    });
    return id;
  }

  const accessibleModules = (session, env = { BILLING_ENFORCEMENT_MODE: "observe" }) =>
    tenant(session.organizationId, async (client) => [...(await buildWorkspaceAccessSnapshot(client, session, { env })).accessibleModules]);

  async function close() {
    if (organizations.length) {
      // Statement by statement (no wrapping transaction), triggers off for the
      // append-only evidence tables, so one failure never blocks the rest.
      await owner.query("SET session_replication_role = replica").catch(() => undefined);
      for (const table of ["notifications", "notification_preferences", "approval_decisions", "approval_requests", "audit_events"]) {
        await owner.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
      }
      const tenantTables = (await owner.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id'`)).rows;
      for (const row of tenantTables) await owner.query(`DELETE FROM tenant.${row.table_name} WHERE organization_id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
      // FK cascades must be ON for the organisation delete (replica mode would orphan public rows).
      await owner.query("SET session_replication_role = DEFAULT").catch(() => undefined);
      await owner.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [organizations]);
    }
    if (users.length) await owner.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    await owner.end().catch(() => undefined);
  }

  return { owner, pool, user, organization, tenant, runtime, crmLead, accessibleModules, close };
}

export const expectCode = (code) => (error) => {
  assert.equal(error.code, code, `${error.status} ${error.code}: ${error.message}`);
  return true;
};
