// Shared setup for the Support real-PostgreSQL tests: one organization and company, users with
// explicit permission sets (no owner bypass), a branch, a customer party+contact, and a transaction
// runner under RLS.
import { randomUUID } from "node:crypto";

import { Client } from "pg";

export const ALL_SUPPORT = [
  "support.view", "support.manage", "support.ticket.create", "support.ticket.assign", "support.ticket.resolve", "support.ticket.close",
  "support.queue.manage", "support.sla.manage", "support.escalation.manage", "support.knowledge.manage", "support.communication.manage",
  "support.sensitive.view", "support.reports.view", "support.settings.manage", "support.audit.view",
];

export async function connectAdmin() {
  const connectionString = process.env.MIGRATION_DATABASE_URL || "";
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

export async function buildSupportWorld(admin, roles, tag) {
  const api = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");
  const orgId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const partyId = randomUUID();
  const contactId = randomUUID();
  const users = Object.fromEntries(Object.keys(roles).map((r) => [r, randomUUID()]));
  const first = Object.values(users)[0];
  for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `${tag}-${role}-${id}@test.invalid`, `${tag} ${role}`]);
  await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`, [orgId, `${tag} Org`, `${tag}-org-${orgId}`, first]);
  await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,$3,$3,$4,'INR','IN',true,'active')`, [companyId, orgId, `${tag} Co`, tag.toUpperCase().slice(0, 8)]);
  await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
  for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
  await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
  await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,currency_code,created_by,updated_by) VALUES ($1,$2,$3,$4,'customer',$5,'INR',$6,$6)`, [partyId, orgId, companyId, `${tag}-CUST`.slice(0, 30), `${tag} Customer`, first]);
  await admin.query(`INSERT INTO tenant.contacts(id,organization_id,party_id,first_name,last_name,email,is_primary,status) VALUES ($1,$2,$3,'Cara','Contact',$4,true,'active')`, [contactId, orgId, partyId, `cara-${tag}@customer.test`]);
  const ctx = Object.fromEntries(Object.entries(roles).map(([r, permissions]) => [r, api.supportContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));
  async function tx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }
  const run = (who, fn) => tx((c) => fn(c, ctx[who]));
  // run as `who`, expect a SupportError with the given http status (and optional code)
  const denied = async (who, fn, status = 403, code) => {
    try {
      await run(who, fn);
    } catch (e) {
      if (e.status !== status || (code && e.code !== code)) throw new Error(`expected ${status}${code ? ` ${code}` : ""}, got ${e.status} ${e.code}: ${e.message}`);
      return e;
    }
    throw new Error(`expected a ${status} rejection but the call succeeded`);
  };
  const sql = async (text, params = []) => tx(async (c) => (await c.query(text, params)).rows);
  const cleanup = async () => {
    try {
      await admin.query("BEGIN");
      await admin.query("SET LOCAL session_replication_role = replica");
      await setTenantContext(admin, orgId);
      const { rows } = await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id' AND table_name LIKE 'support\\_%'`);
      for (const r of rows) await admin.query(`DELETE FROM tenant.${r.table_name} WHERE organization_id=$1`, [orgId]);
      await admin.query(`DELETE FROM tenant.contacts WHERE organization_id=$1`, [orgId]);
      await admin.query(`DELETE FROM tenant.business_parties WHERE organization_id=$1`, [orgId]);
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK").catch(() => {});
    }
  };
  return { api, orgId, companyId, branchId, partyId, contactId, users, ctx, run, tx, denied, sql, cleanup, today: new Date().toISOString().slice(0, 10) };
}
