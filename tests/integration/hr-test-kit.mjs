// Shared setup for the HR & Payroll real-PostgreSQL tests: one organization and company, users with
// explicit permission sets (no owner bypass), a branch, and a transaction runner under RLS.
import { randomUUID } from "node:crypto";

import { Client } from "pg";

export const ALL_HR = [
  "hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage", "hr_payroll.sensitive.view", "hr_payroll.attendance.manage", "hr_payroll.shift.manage",
  "hr_payroll.leave.manage", "hr_payroll.leave.approve", "hr_payroll.expense.manage", "hr_payroll.expense.approve", "hr_payroll.payroll.prepare", "hr_payroll.payroll.approve",
  "hr_payroll.payroll.post", "hr_payroll.payslip.view", "hr_payroll.compensation.manage", "hr_payroll.statutory.manage", "hr_payroll.reports.view", "hr_payroll.settings.manage", "hr_payroll.audit.view",
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

export async function buildHrWorld(admin, roles, tag) {
  const api = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");
  const orgId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const users = Object.fromEntries(Object.keys(roles).map((r) => [r, randomUUID()]));
  const first = Object.values(users)[0];
  for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `${tag}-${role}-${id}@test.invalid`, `${tag} ${role}`]);
  await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`, [orgId, `${tag} Org`, `${tag}-org-${orgId}`, first]);
  await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,$3,$3,$4,'INR','IN',true,'active')`, [companyId, orgId, `${tag} Co`, tag.toUpperCase().slice(0, 8)]);
  await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
  for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
  const ctx = Object.fromEntries(Object.entries(roles).map(([r, permissions]) => [r, api.hrContext({ organizationId: orgId, userId: users[r], activeCompanyId: companyId, roleSlugs: [], permissions })]));
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
  // run as `who`, expect a HrError with the given http status (and optional code)
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
      const { rows } = await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id' AND table_name LIKE 'hr\\_%'`);
      for (const r of rows) await admin.query(`DELETE FROM tenant.${r.table_name} WHERE organization_id=$1`, [orgId]);
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK").catch(() => {});
    }
  };
  return { api, orgId, companyId, branchId, users, ctx, run, tx, denied, sql, cleanup, today: new Date().toISOString().slice(0, 10) };
}
