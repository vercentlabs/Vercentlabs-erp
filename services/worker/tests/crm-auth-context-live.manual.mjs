#!/usr/bin/env node
// MANUAL, live-PostgreSQL-only test — deliberately named *.manual.mjs so it
// is NOT matched by services/worker's own `test` script glob
// (tests/*.test.mjs), matching the exact precedent set by
// live-concurrency.manual.mjs (Prompt 13). It lives in services/worker/
// tests/ purely for dependency/tooling reasons: this package is the only
// one in the monorepo that already wires together pg, @vercentlabs/database
// and @vercentlabs/api as real dependencies with a test script whose glob
// safely excludes non-`.test.mjs` files — apps/web and services/api both
// run bare `node --test` (no glob), which WOULD sweep up a manual script
// dropped into their own tests/ directories. What this actually verifies
// is unrelated to the worker: it proves Prompt 14's CRM authorization
// context fix (apps/web/src/lib/crm.ts's crmContext() now propagating
// session.permissions/session.roleSlugs) end-to-end against a REAL
// database — not the mocked-client pure-function tests in
// services/api/tests/crm-record-scope.test.mjs, which already proved the
// scoping SQL is correct in isolation but could not have caught the
// integration bug Prompt 13 found (the bug was entirely in the caller
// never populating those fields, not in the scoping logic itself).
//
// Run manually: node services/worker/tests/crm-auth-context-live.manual.mjs
// Requires DATABASE_URL pointed at a real Postgres with all migrations
// through 052 applied. Creates its own organizations/users/leads/
// activities and deletes all of them at the end, regardless of outcome.
import pg from "pg";
import { setTenantContext } from "@vercentlabs/database";
import { listCrmRecords, getCrmRecord } from "@vercentlabs/api";

const { Pool } = pg;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://vercent_app:replace_with_runtime_password@localhost:5433/vercentlabs_control";

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`OK   ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

function uuid() {
  return crypto.randomUUID();
}

// Builds an object with EXACTLY the shape apps/web/src/lib/crm.ts's
// crmContext() now produces (permissions/roleSlugs populated from the
// real session) — this is the "real chain" this script proves, one layer
// below the Next.js request itself (which cannot run outside its own
// server runtime — see apps/web/tests/helpers/load-ts-module.mjs's own
// documented constraint on next/headers-dependent files).
// Leads/opportunities/activities are companyScoped (services/api/src/
// crm.js recordScope()): with allowAllCompanies false, a null
// activeCompanyId short-circuits recordScope() to " AND false" BEFORE the
// ownership predicate is even reached — that is a real, separate gate
// (Part 29: company scope and record-ownership scope are deliberately
// independent), not something this script is testing. A real request
// always has activeCompanyId resolved from the session before reaching
// CRM, so every persona here gets a non-null one; test rows themselves
// use company_id = NULL, which recordScope()'s "company_id IS NULL OR ..."
// clause always treats as visible regardless of the specific value.
const STAND_IN_COMPANY_ID = "99999999-9999-4999-8999-999999999999";
const STAND_IN_BRANCH_ID = "88888888-8888-4888-8888-888888888888";

function sessionDerivedContext({ organizationId, userId, permissions = [], roleSlugs = [] }) {
  return {
    organizationId,
    userId,
    activeCompanyId: STAND_IN_COMPANY_ID,
    activeBranchId: STAND_IN_BRANCH_ID,
    allowAllCompanies: roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator"),
    permissions,
    roleSlugs,
  };
}

async function withTenant(pool, organizationId, work) {
  const client = await pool.connect();
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

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  const created = { users: [], organizations: [] };

  try {
    const bootstrapUser = uuid();
    await pool.query(
      `INSERT INTO public.users (id, email, full_name, password_hash) VALUES ($1,$2,$3,'x')`,
      [bootstrapUser, `p14-bootstrap-${bootstrapUser}@example.invalid`, "P14 Bootstrap"],
    );
    created.users.push(bootstrapUser);

    const orgA = uuid();
    const orgB = uuid();
    for (const [id, slug] of [[orgA, `p14-org-a-${orgA}`], [orgB, `p14-org-b-${orgB}`]]) {
      await pool.query(
        `INSERT INTO public.organizations (id, name, slug, country_code, timezone, base_currency, created_by)
         VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`,
        [id, `P14 Test Org ${id}`, slug, bootstrapUser],
      );
      created.organizations.push(id);
    }

    const userA = uuid(); // owns leadA / activityA in orgA
    const userB = uuid(); // owns leadB / activityB in orgA
    const userM = uuid(); // manager persona in orgA
    const userOrgB = uuid(); // unrelated user, owns a lead in orgB
    for (const id of [userA, userB, userM, userOrgB]) {
      await pool.query(
        `INSERT INTO public.users (id, email, full_name, password_hash) VALUES ($1,$2,$3,'x')`,
        [id, `p14-${id}@example.invalid`, `P14 User ${id}`],
      );
      created.users.push(id);
    }

    const leadA = uuid();
    const leadB = uuid();
    const activityA = uuid();
    const activityB = uuid();
    await withTenant(pool, orgA, async (client) => {
      await client.query(
        `INSERT INTO tenant.crm_leads (id, organization_id, code, first_name, owner_user_id)
         VALUES ($1,$2,'P14-A','Alpha',$3)`,
        [leadA, orgA, userA],
      );
      await client.query(
        `INSERT INTO tenant.crm_leads (id, organization_id, code, first_name, owner_user_id)
         VALUES ($1,$2,'P14-B','Beta',$3)`,
        [leadB, orgA, userB],
      );
      await client.query(
        `INSERT INTO tenant.crm_activities (id, organization_id, entity_type, activity_type, subject, assigned_to)
         VALUES ($1,$2,'general','task','P14 activity A',$3)`,
        [activityA, orgA, userA],
      );
      await client.query(
        `INSERT INTO tenant.crm_activities (id, organization_id, entity_type, activity_type, subject, assigned_to)
         VALUES ($1,$2,'general','task','P14 activity B',$3)`,
        [activityB, orgA, userB],
      );
    });

    const leadOrgB = uuid();
    await withTenant(pool, orgB, async (client) => {
      await client.query(
        `INSERT INTO tenant.crm_leads (id, organization_id, code, first_name, owner_user_id)
         VALUES ($1,$2,'P14-X','XOrg',$3)`,
        [leadOrgB, orgB, userOrgB],
      );
    });

    // --- Restricted user (sales_representative-shaped: no view_all) ---
    const restrictedPerms = ["crm.view", "crm.leads.manage", "crm.activities.manage"];
    await withTenant(pool, orgA, async (client) => {
      const ctx = sessionDerivedContext({ organizationId: orgA, userId: userA, permissions: restrictedPerms });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(rows.some((r) => r.id === leadA), "restricted user A sees their own lead in list");
      check(!rows.some((r) => r.id === leadB), "restricted user A does NOT see user B's lead in list");
      await check2(
        () => getCrmRecord(client, ctx, "leads", leadB),
        (error) => error?.status === 404,
        "restricted user A gets 404 (not leaked) on direct-ID access to user B's lead",
      );
    });

    // --- Auditor-shaped: crm.view/crm.export/crm.reports.view but NOT view_all ---
    const auditorPerms = ["crm.view", "crm.export", "crm.reports.view"];
    await withTenant(pool, orgA, async (client) => {
      const ctx = sessionDerivedContext({ organizationId: orgA, userId: userM, permissions: auditorPerms });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(!rows.some((r) => r.id === leadA) && !rows.some((r) => r.id === leadB), "auditor persona (no view_all) sees neither lead they don't own");
    });

    // --- Elevated user via explicit crm.records.view_all permission ---
    const managerPerms = [...restrictedPerms, "crm.records.view_all"];
    await withTenant(pool, orgA, async (client) => {
      const ctx = sessionDerivedContext({ organizationId: orgA, userId: userM, permissions: managerPerms });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(rows.some((r) => r.id === leadA) && rows.some((r) => r.id === leadB), "manager with crm.records.view_all sees BOTH leads");
      const activities = await listCrmRecords(client, ctx, "activities", { limit: 50 });
      check(
        activities.rows.some((r) => r.id === activityA) && activities.rows.some((r) => r.id === activityB),
        "manager with crm.records.view_all sees BOTH activities (assigned_to-based ownerField)",
      );
      const record = await getCrmRecord(client, ctx, "leads", leadB);
      check(record.id === leadB, "manager can directly open user B's lead by ID");
    });

    // --- organization_owner via roleSlugs, WITHOUT the explicit permission (Prompt 13's specific finding) ---
    await withTenant(pool, orgA, async (client) => {
      const ctx = sessionDerivedContext({ organizationId: orgA, userId: userM, permissions: [], roleSlugs: ["organization_owner"] });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(rows.some((r) => r.id === leadA) && rows.some((r) => r.id === leadB), "organization_owner (roleSlugs-derived) sees BOTH leads even with an empty permissions array");
    });

    // --- Role revocation: same manager, view_all removed -> reverts to restricted ---
    await withTenant(pool, orgA, async (client) => {
      const ctx = sessionDerivedContext({ organizationId: orgA, userId: userM, permissions: restrictedPerms });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(!rows.some((r) => r.id === leadA) && !rows.some((r) => r.id === leadB), "same manager with view_all removed reverts to seeing neither (fresh per-request context, no stale cache)");
    });

    // --- Fail-closed: permissions/roleSlugs entirely absent from context ---
    await withTenant(pool, orgA, async (client) => {
      const ctx = { organizationId: orgA, userId: userM, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true };
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(!rows.some((r) => r.id === leadA) && !rows.some((r) => r.id === leadB), "context missing permissions/roleSlugs entirely fails CLOSED (sees nothing), never open");
    });

    // --- Tenant isolation: org A manager (view_all) cannot reach org B's lead ---
    await withTenant(pool, orgA, async (client) => {
      const ctx = sessionDerivedContext({ organizationId: orgA, userId: userM, permissions: managerPerms });
      await check2(
        () => getCrmRecord(client, ctx, "leads", leadOrgB),
        (error) => error?.status === 404,
        "org A manager with crm.records.view_all CANNOT reach org B's lead by ID (tenant isolation holds regardless of permission)",
      );
    });
  } finally {
    // Best-effort cleanup regardless of outcome — never leave test rows behind.
    for (const organizationId of created.organizations) {
      await withTenant(pool, organizationId, async (client) => {
        await client.query("DELETE FROM tenant.crm_activities WHERE organization_id = $1", [organizationId]);
        await client.query("DELETE FROM tenant.crm_leads WHERE organization_id = $1", [organizationId]);
      }).catch(() => {});
      await pool.query("DELETE FROM public.organizations WHERE id = $1", [organizationId]).catch(() => {});
    }
    for (const userId of created.users) {
      await pool.query("DELETE FROM public.users WHERE id = $1", [userId]).catch(() => {});
    }
    await pool.end();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function check2(action, predicate, message) {
  try {
    await action();
    failures += 1;
    console.error(`FAIL ${message} (did not throw)`);
  } catch (error) {
    check(predicate(error), message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
