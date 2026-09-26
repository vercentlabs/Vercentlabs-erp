// Shared setup for the Accounting real-PostgreSQL tests: one organization and company, users with
// explicit permission sets (no owner bypass), a branch, a real customer/supplier, and a fully
// initialized accounting foundation (ledger, chart of accounts, journals, mappings, settings) via
// this module's own initializeAccountingCompany -- the same function HR's payroll-posting tests
// already prove out, reused here directly rather than re-implemented.
import { randomUUID } from "node:crypto";

import { Client } from "pg";

export const ALL_ACCOUNTING = [
  "accounting.view", "accounting.journal.create", "accounting.journal.submit", "accounting.journal.approve", "accounting.journal.post", "accounting.journal.reverse",
  "accounting.receivables.manage", "accounting.receivables.approve", "accounting.receipts.manage", "accounting.collections.manage",
  "accounting.payables.manage", "accounting.payables.approve", "accounting.payments.manage", "accounting.payments.approve",
  "accounting.bank.manage", "accounting.bank.reconcile", "accounting.period.manage", "accounting.close.manage", "accounting.close.waive",
  "accounting.budget.manage", "accounting.tax.manage", "accounting.fx.manage", "accounting.intercompany.manage", "accounting.assets.manage",
  "accounting.recurring.manage", "accounting.consolidation.manage", "accounting.reports.view", "accounting.settings.manage", "accounting.audit.view",
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

export async function buildAccountingWorld(admin, roles, tag) {
  const api = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");
  const orgId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const customerId = randomUUID();
  const supplierId = randomUUID();
  const users = Object.fromEntries(Object.keys(roles).map((r) => [r, randomUUID()]));
  const first = Object.values(users)[0];
  for (const [role, id] of Object.entries(users)) await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`, [id, `${tag}-${role}-${id}@test.invalid`, `${tag} ${role}`]);
  await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`, [orgId, `${tag} Org`, `${tag}-org-${orgId}`, first]);
  await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,$3,$3,$4,'INR','IN',true,'active')`, [companyId, orgId, `${tag} Co`, tag.toUpperCase().slice(0, 8)]);
  await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
  for (const id of Object.values(users)) await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
  await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
  await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,currency_code,created_by,updated_by) VALUES ($1,$2,$3,$4,'customer',$5,'INR',$6,$6)`, [customerId, orgId, companyId, `${tag}-CUST`.slice(0, 30), `${tag} Customer`, first]);
  await admin.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,currency_code,created_by,updated_by) VALUES ($1,$2,$3,$4,'supplier',$5,'INR',$6,$6)`, [supplierId, orgId, companyId, `${tag}-SUP`.slice(0, 30), `${tag} Supplier`, first]);
  const t0 = new Date();
  const yearStart = new Date(Date.UTC(t0.getUTCFullYear(), 0, 1));
  const yearEnd = new Date(Date.UTC(t0.getUTCFullYear(), 11, 31));
  await admin.query(`INSERT INTO tenant.fiscal_periods(organization_id,company_id,name,fiscal_year,start_date,end_date,status) VALUES ($1,$2,'FY Current','FY-CURRENT',$3,$4,'open') ON CONFLICT DO NOTHING`, [orgId, companyId, yearStart.toISOString().slice(0, 10), yearEnd.toISOString().slice(0, 10)]);

  await admin.query("BEGIN");
  await setTenantContext(admin, orgId);
  await api.initializeAccountingCompany(admin, { organizationId: orgId, companyId, userId: first });
  await admin.query("COMMIT");

  const ctx = Object.fromEntries(Object.entries(roles).map(([r, permissions]) => [r, { organizationId: orgId, activeCompanyId: companyId, companyId, userId: users[r], permissions, roleSlugs: [] }]));
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
  const account = async (code) => (await sql(`SELECT a.* FROM tenant.accounting_accounts a JOIN tenant.accounting_ledgers l ON l.id=a.ledger_id WHERE a.organization_id=$1 AND a.company_id=$2 AND l.ledger_type='primary' AND a.code=$3`, [orgId, companyId, code]))[0];
  const cleanup = async () => {
    try {
      await admin.query("BEGIN");
      await admin.query("SET LOCAL session_replication_role = replica");
      await setTenantContext(admin, orgId);
      const { rows } = await admin.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='tenant' AND column_name='organization_id' AND (table_name LIKE 'accounting\\_%' OR table_name LIKE 'asset\\_%' OR table_name LIKE 'project\\_%' OR table_name LIKE 'stock\\_%' OR table_name LIKE 'procurement\\_%' OR table_name IN ('business_parties','fiscal_periods','assets','document_sequences','projects','items','warehouses','item_groups','units_of_measure'))`);
      for (const r of rows) await admin.query(`DELETE FROM tenant.${r.table_name} WHERE organization_id=$1`, [orgId]);
      await admin.query("COMMIT");
    } catch {
      await admin.query("ROLLBACK").catch(() => {});
    }
  };
  return { api, orgId, companyId, branchId, customerId, supplierId, users, ctx, run, tx, denied, sql, account, cleanup, today: new Date().toISOString().slice(0, 10) };
}
