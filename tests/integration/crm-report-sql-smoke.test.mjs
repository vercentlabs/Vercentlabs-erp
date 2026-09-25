// Real PostgreSQL integration test — not a fake-DB-client unit test.
//
// getCrmReport's ~15 report branches are each a hand-written raw SQL
// string wrapped in a shared scope-parameters CTE (see analytics-service.js).
// The unit test suite (services/api/tests/*) only ever runs these against a
// fake client that pattern-matches SQL substrings — it can never catch a
// genuine SQL syntax error, because the fake client never actually parses
// the query. This gap is not hypothetical: the "attribution" report shipped
// with `WHERE ${dateClause(...)}` as its first predicate, and dateClause()'s
// own output always starts with the literal word "AND" (matching every
// other report's convention of appending it after a real leading
// condition) — producing "WHERE AND (...)", a syntax error that 861 unit
// tests and a full verify:crm pass never surfaced, only discovered by
// actually loading the report in a browser against a live database. This
// suite runs every report key against a real, freshly seeded org so a
// syntax error (or any other real-Postgres-only failure — an ambiguous
// column, a bad JOIN, a missing table) fails CI instead of only being
// caught by hand.
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

test("getCrmReport: every report key runs as valid SQL against real PostgreSQL, on a freshly seeded org with no data", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { getCrmReport } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const userId = randomUUID();
  try {
    await admin.query(
      `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Report Smoke Owner','x','active',now())`,
      [userId, `report-smoke-${orgId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'Report Smoke Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `report-smoke-${orgId}`, userId],
    );
    await setTenantContext(admin, orgId);

    const context = {
      organizationId: orgId,
      userId,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      roleSlugs: ["organization_owner"],
      permissions: ["crm.records.view_all"],
    };

    const reportKeys = [
      "pipeline",
      "conversion",
      "sources",
      "activities",
      "forecast",
      "campaigns",
      "attribution",
      "revenue-operations",
      "account-health",
      "privacy",
      "pipeline-intelligence",
      "engagement-intelligence",
      "relationship-coverage",
      "partner-pipeline",
      "ai-governance",
    ];

    for (const key of reportKeys) {
      await t.test(`"${key}" report runs without a SQL error`, async () => {
        const result = await getCrmReport(admin, context, key, {});
        assert.equal(result.report, key);
        assert.ok(Array.isArray(result.rows));
      });
    }

    await t.test("an unknown report key is rejected with a 404, not a SQL error", async () => {
      await assert.rejects(
        () => getCrmReport(admin, context, "not-a-real-report", {}),
        (error) => error.status === 404,
      );
    });
  } finally {
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=$1`, [userId]).catch(() => undefined);
    await admin.end();
  }
});
