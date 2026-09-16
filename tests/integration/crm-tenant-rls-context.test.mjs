// Real PostgreSQL integration test — not a fake-DB-client unit test.
//
// Stage 3 (Prompt 3) live-browser QA discovery: apps/web/src/core/db.ts's
// withClient() opens a bare pool connection and never calls
// setTenantContext(), so it never sets Postgres's app.current_organization_id
// session variable. Every tenant-schema table's RLS policy is
// `organization_id = tenant.current_organization_id()` — with that setting
// unset, the function returns NULL, and `organization_id = NULL` matches
// no row at all. 59 CRM API routes used withClient() for reads (including
// the dashboard and the entire generic [resource] list/get boundary) and
// silently returned EMPTY results for every real tenant, in a real
// browser against a real database — invisible to this repo's ~1,100
// mocked unit tests, none of which talk to a real Postgres connection or
// know what RLS is. Fixed by switching every CRM route to
// tenantTransaction(session.organizationId, ...). A static guard
// (apps/web/scripts/verify-routes.mjs, Check 5) now prevents any CRM route
// from reintroducing withClient(); this test is the executable proof of
// the actual database behavior that guard exists to protect, using the
// SAME restricted runtime role (DATABASE_URL's vercent_app, not the
// superuser MIGRATION_DATABASE_URL role, which has BYPASSRLS and would
// make this test pass trivially without proving anything).
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { setTenantContext } from "../../packages/database/src/index.js";
import { listCrmRecords } from "../../services/api/src/modules/crm/index.js";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";
const appConnectionString = process.env.DATABASE_URL || "";

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

test("CRM tenant RLS: the restricted runtime role sees a lead only after setTenantContext, proving withClient()-style bare reads are denied by RLS, not by an app-level filter", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }
  const app = await connectOrNull(appConnectionString);
  if (!app) {
    await admin.end();
    t.skip("No reachable Postgres connection as the restricted runtime role (DATABASE_URL) -- run `pnpm db:setup` first.");
    return;
  }

  const organizationId = randomUUID();
  const leadId = randomUUID();
  const userId = randomUUID();
  try {
    // Committed (not just BEGIN'd) deliberately: a second connection under
    // a different role, as used below, cannot see another connection's
    // uncommitted rows regardless of RLS — that's ordinary MVCC visibility,
    // not the thing this test is proving. Cleaned up explicitly afterward.
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'CRM RLS Context Test User','not-a-real-hash','active',now())`,
      [userId, `crm-rls-context-test-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by)
       VALUES($1,'CRM RLS Context Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [organizationId, `crm-rls-context-test-${organizationId}`, userId],
    );
    await admin.query(
      `INSERT INTO tenant.crm_lead_stages(organization_id,code,name,is_initial)
       VALUES($1,'new','New',true)`,
      [organizationId],
    );
    await admin.query(
      `INSERT INTO tenant.crm_leads(id,organization_id,code,first_name,email)
       VALUES($1,$2,'RLSTEST-0001','RLS Context Test Lead',$3)`,
      [leadId, organizationId, `crm-rls-context-test-lead-${leadId}@test.invalid`],
    );

    const withoutContext = await app.query(
      `SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
      [organizationId, leadId],
    );
    assert.equal(
      withoutContext.rows.length,
      0,
      "a bare connection (no app.current_organization_id set) must be denied by RLS even though the WHERE clause matches the fixture row exactly",
    );

    // setTenantContext uses set_config(..., is_local=true) — the same
    // Postgres primitive as `SET LOCAL`, which only persists for the
    // current transaction. This is why apps/web/src/core/db.ts's
    // tenantTransaction() wraps it in an explicit BEGIN/COMMIT and
    // withClient() (the actual bug) does not: outside a transaction, the
    // setting would reset before the very next statement on the same
    // connection, so this test must reproduce that same transactional
    // wrapping to prove the real app.
    await app.query("BEGIN");
    await setTenantContext(app, organizationId);
    const withContext = await app.query(
      `SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
      [organizationId, leadId],
    );
    await app.query("COMMIT");
    assert.equal(withContext.rows.length, 1, "the exact same query, after setTenantContext inside a transaction, must see the fixture row");
    assert.equal(withContext.rows[0].id, leadId);

    // Cross-tenant isolation, same connection, same session variable
    // mechanism: a DIFFERENT organization's context must not see this row.
    await app.query("BEGIN");
    await setTenantContext(app, randomUUID());
    const wrongTenant = await app.query(
      `SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
      [organizationId, leadId],
    );
    await app.query("COMMIT");
    assert.equal(wrongTenant.rows.length, 0, "a different organization's tenant context must not see this row either");
  } finally {
    await admin.query(`DELETE FROM tenant.crm_leads WHERE id=$1`, [leadId]).catch(() => undefined);
    await admin.query(`DELETE FROM tenant.crm_lead_stages WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=$1`, [userId]).catch(() => undefined);
    await app.end();
    await admin.end();
  }
});

test("CRM Communications: listCrmRecords does not throw \"could not determine data type of parameter\" for an organization_owner/allowAllCompanies caller", async (t) => {
  // Real Prompt 3 live-browser QA discovery, found immediately after fixing
  // the RLS bug above (the Communications page 500'd on its very first
  // real request): communicationVisibilitySql (communication-projection.js)
  // interpolated a bare boolean placeholder (`OR $N OR`, no cast) into the
  // audience predicate, and communicationParentScopeSql (record-policy.js)
  // pushed context.activeCompanyId onto the parameters array even when
  // allowAllCompanies made it unused in the returned SQL text — both leave
  // Postgres unable to infer a parameter's type, and BOTH only manifest for
  // an organization_owner/view_all caller (the common case), never for a
  // caller who instead hits recordScope's other branches. Neither is
  // reachable from a mocked client.query, which never parses SQL at all.
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }
  const app = await connectOrNull(appConnectionString);
  if (!app) {
    await admin.end();
    t.skip("No reachable Postgres connection as the restricted runtime role (DATABASE_URL) -- run `pnpm db:setup` first.");
    return;
  }

  const organizationId = randomUUID();
  const userId = randomUUID();
  const companyId = randomUUID();
  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at)
       VALUES($1,$2,'CRM Comms Param Test User','not-a-real-hash','active',now())`,
      [userId, `crm-comms-param-test-${userId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by)
       VALUES($1,'CRM Comms Param Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [organizationId, `crm-comms-param-test-${organizationId}`, userId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,country_code,base_currency,is_primary,code)
       VALUES($1,$2,'Comms Test Co','Comms Test Co Pvt Ltd','IN','INR',true,'CTC')`,
      [companyId, organizationId],
    );

    const context = {
      organizationId,
      userId,
      activeCompanyId: companyId,
      activeBranchId: null,
      allowAllCompanies: true,
      permissions: ["crm.view"],
      roleSlugs: ["organization_owner"],
    };

    await app.query("BEGIN");
    await setTenantContext(app, organizationId);
    // No fixture communications rows are needed — the bug was a query-
    // construction-time type-inference failure, thrown before any row is
    // evaluated, so an empty result set is a fully valid, successful proof.
    const result = await listCrmRecords(app, context, "communications", { limit: 25, offset: 0 });
    await app.query("COMMIT");
    assert.deepEqual(result.rows, []);
    assert.equal(result.total, 0);
  } finally {
    await app.query("ROLLBACK").catch(() => undefined);
    await admin.query(`DELETE FROM public.companies WHERE id=$1`, [companyId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=$1`, [userId]).catch(() => undefined);
    await app.end();
    await admin.end();
  }
});
