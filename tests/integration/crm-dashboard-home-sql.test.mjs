// Real PostgreSQL integration test for the CRM Home charts' read model
// (getCrmDashboard's qualification, leadTrend and sourcePerformance, and
// the stages' weightedAmount). A fake client cannot parse SQL, so these
// run against a freshly seeded organisation and check the numbers, the
// company switch and the owner scope — the same predicates as every other
// dashboard figure.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

const monthKey = (offset) => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return date.toISOString().slice(0, 7);
};

test("getCrmDashboard: Home chart aggregates respect company, owner scope and never drop sources", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { getCrmDashboard } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const rep = randomUUID();
  const otherRep = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  try {
    for (const [id, label] of [[rep, "rep"], [otherRep, "other"]])
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `home-${label}-${orgId}@test.invalid`, `Home ${label}`],
      );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Home Charts Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `home-charts-${orgId}`, rep],
    );
    for (const [id, code] of [[companyA, "HCA"], [companyB, "HCB"]])
      await admin.query(
        `INSERT INTO public.companies(id,organization_id,name,legal_name,country_code,base_currency,code) VALUES ($1,$2,$3,$3,'IN','INR',$4)`,
        [id, orgId, `Company ${code}`, code],
      );
    await setTenantContext(admin, orgId);

    // Leads reference a lifecycle stage; a bare organisation has none yet.
    await admin.query(`INSERT INTO tenant.crm_lead_stages(organization_id,code,name) VALUES ($1,'new','New')`, [orgId]);
    const sources = [];
    for (let index = 1; index <= 9; index += 1) {
      const row = await admin.query(
        `INSERT INTO tenant.crm_lead_sources(organization_id,name,code) VALUES ($1,$2,$3) RETURNING id`,
        [orgId, `Source ${index}`, `SRC${index}`],
      );
      sources.push(row.rows[0].id);
    }
    let sequence = 0;
    async function lead({ owner, company, source = null, qualification = "not_reviewed", createdAt = "now()", converted = false }) {
      sequence += 1;
      const decided = qualification === "qualified";
      await admin.query(
        `INSERT INTO tenant.crm_leads(organization_id,company_id,code,first_name,email,owner_user_id,source_id,qualification_state,qualification_decided_at,qualification_decided_by_user_id,record_status,converted_at,created_at)
         VALUES ($1,$2,$3,'Home',$4,$5,$6,$7,$8,$9,$10,${converted ? "date_trunc('month', now()) - interval '1 month' + interval '3 days'" : "NULL"},${createdAt})`,
        [orgId, company, `HL-${sequence}`, `home${sequence}@test.invalid`, owner, source, qualification, decided ? new Date() : null, decided ? rep : null, converted ? "converted" : "active"],
      );
    }
    // Company A: the rep owns two current leads (one qualified) and one
    // converted last month that was created two months ago; the other rep
    // owns one lead in each of sources 2-9.
    await lead({ owner: rep, company: companyA, source: sources[0], qualification: "qualified" });
    await lead({ owner: rep, company: companyA, source: sources[0] });
    await lead({ owner: rep, company: companyA, source: sources[0], createdAt: "date_trunc('month', now()) - interval '2 months' + interval '3 days'", converted: true });
    for (const source of sources.slice(1)) await lead({ owner: otherRep, company: companyA, source });
    // Company B: one qualified lead owned by the rep.
    await lead({ owner: rep, company: companyB, source: sources[0], qualification: "qualified" });

    const from = `${monthKey(-2)}-01`;
    const to = new Date().toISOString().slice(0, 10);
    const base = { organizationId: orgId, activeBranchId: null, allowAllCompanies: true, roleSlugs: [] };
    const viewAll = { ...base, userId: rep, activeCompanyId: companyA, permissions: ["crm.records.view_all"] };
    const count = (rows, key) => rows.find((row) => row.key === key)?.count;

    await t.test("qualification buckets add up to the open-lead KPI, zero buckets included", async () => {
      const dashboard = await getCrmDashboard(admin, viewAll, { scope: "all", from, to });
      assert.deepEqual(dashboard.qualification.map((row) => row.key), ["qualified", "not_reviewed", "unqualified"]);
      assert.equal(count(dashboard.qualification, "qualified"), 1);
      assert.equal(count(dashboard.qualification, "not_reviewed"), 9);
      assert.equal(count(dashboard.qualification, "unqualified"), 0);
      const total = dashboard.qualification.reduce((sum, row) => sum + row.count, 0);
      assert.equal(total, dashboard.metrics.openLeads);
    });

    await t.test("the lead trend is exactly six calendar months ending this month, with empty months", async () => {
      const dashboard = await getCrmDashboard(admin, viewAll, { scope: "all", from, to });
      assert.deepEqual(dashboard.leadTrend.map((row) => row.month), [-5, -4, -3, -2, -1, 0].map(monthKey));
      const byMonth = Object.fromEntries(dashboard.leadTrend.map((row) => [row.month, row]));
      assert.equal(byMonth[monthKey(-2)].created, 1, "the converted lead counts in the month it was created");
      assert.equal(byMonth[monthKey(-1)].converted, 1, "and as converted in the month it converted");
      assert.equal(byMonth[monthKey(0)].created, 10);
      assert.equal(byMonth[monthKey(-4)].created, 0);
      assert.equal(byMonth[monthKey(-4)].converted, 0);
    });

    await t.test("source performance names the six largest sources and sums the rest into Other", async () => {
      const dashboard = await getCrmDashboard(admin, viewAll, { scope: "all", from, to });
      const rows = dashboard.sourcePerformance;
      assert.equal(rows.length, 7);
      assert.equal(rows[0].name, "Source 1");
      assert.equal(rows[0].leadCount, 3);
      assert.equal(rows[0].convertedCount, 1);
      assert.equal(rows[0].sourceId, sources[0]);
      const other = rows.at(-1);
      assert.equal(other.isOther, true);
      assert.equal(other.name, "Other");
      assert.equal(other.leadCount, 3, "three one-lead sources fold into Other");
      assert.equal(rows.reduce((sum, row) => sum + row.leadCount, 0), dashboard.metrics.leadsInPeriod, "nothing is dropped");
    });

    await t.test("switching the active company changes every aggregate", async () => {
      const dashboard = await getCrmDashboard(admin, { ...viewAll, activeCompanyId: companyB }, { scope: "all", from, to });
      assert.equal(dashboard.metrics.openLeads, 1);
      assert.equal(count(dashboard.qualification, "qualified"), 1);
      assert.equal(count(dashboard.qualification, "not_reviewed"), 0);
      assert.equal(dashboard.leadTrend.at(-1).created, 1);
      assert.deepEqual(dashboard.sourcePerformance.map((row) => [row.name, row.leadCount]), [["Source 1", 1]]);
    });

    await t.test("a rep without view-all never aggregates another seller's leads, even in 'all'", async () => {
      const restricted = { ...base, userId: rep, activeCompanyId: companyA, permissions: [] };
      for (const scope of ["all", "mine", "team"]) {
        const dashboard = await getCrmDashboard(admin, restricted, { scope, from, to });
        assert.equal(dashboard.metrics.openLeads, 2, scope);
        assert.equal(count(dashboard.qualification, "not_reviewed"), 1, scope);
        assert.equal(dashboard.leadTrend.at(-1).created, 2, scope);
        assert.deepEqual(dashboard.sourcePerformance.map((row) => [row.name, row.leadCount]), [["Source 1", 3]], scope);
      }
    });

    await t.test("'mine' narrows a view-all caller to their own leads", async () => {
      const dashboard = await getCrmDashboard(admin, viewAll, { scope: "mine", from, to });
      assert.equal(dashboard.metrics.openLeads, 2);
      assert.equal(dashboard.sourcePerformance.length, 1);
      assert.equal(dashboard.leadTrend.at(-1).created, 2);
    });
  } finally {
    await admin.query(`DELETE FROM tenant.crm_leads WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM tenant.crm_lead_sources WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM tenant.crm_lead_stages WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.companies WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [[rep, otherRep]]).catch(() => undefined);
    await admin.end();
  }
});
