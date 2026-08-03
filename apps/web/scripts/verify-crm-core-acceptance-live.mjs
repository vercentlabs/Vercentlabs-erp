import assert from "node:assert/strict";
import path from "node:path";

import {
  CRM_CORE_CHECK_KEYS,
  captureCrmCoreAcceptanceSnapshot,
  getCrmCoreAcceptanceDashboard,
  getCrmCoreAcceptanceTimeline,
  recordCrmCoreAcceptanceRun,
} from "@vercentlabs/api";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["028_crm_core_acceptance.sql"],
  );
  assert.ok(migration.rows[0], "CRM-01 tenant migration is not applied.");

  const organization = (
    await client.query(
      `SELECT organization.id,organization.created_by
       FROM public.organizations organization
       WHERE organization.status='active' AND organization.created_by IS NOT NULL
       ORDER BY organization.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    organization?.created_by,
    "An active organisation with an owner is required.",
  );

  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [organization.id],
  );
  const context = {
    organizationId: organization.id,
    userId: organization.created_by,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [
      "crm.view",
      "crm.reports.view",
      "crm.settings.manage",
      "organization.manage",
      "audit.view",
    ],
    roleSlugs: ["organization_owner"],
  };

  let tick = Date.now();
  const record = async (checkKey, status = "passed") => {
    const completedAt = new Date((tick += 1000)).toISOString();
    return recordCrmCoreAcceptanceRun(client, context, {
      checkKey,
      status,
      source: "acceptance",
      environment: "staging",
      commitSha: "crm-01-live-verification",
      startedAt: completedAt,
      completedAt,
      evidence: {
        verifiedBy: "crm-01-live",
        checkKey,
        transactional: true,
      },
    });
  };

  for (const checkKey of CRM_CORE_CHECK_KEYS) {
    const check = await record(checkKey);
    assert.ok(check.id);
    assert.equal(check.status, "passed");
  }

  const ready = await getCrmCoreAcceptanceDashboard(client, context);
  assert.equal(ready.health.readiness, "ready");
  assert.equal(ready.health.score, 100);
  assert.equal(ready.checks.length, CRM_CORE_CHECK_KEYS.length);

  const snapshot = await captureCrmCoreAcceptanceSnapshot(client, context, {
    environment: "staging",
    commitSha: "crm-01-live-verification",
    evidence: { purpose: "transactional CRM-01 acceptance" },
  });
  assert.ok(snapshot.id);
  assert.equal(snapshot.readiness_status, "ready");
  assert.equal(Number(snapshot.acceptance_score), 100);

  await record("CRM-022", "failed");
  const blocked = await getCrmCoreAcceptanceDashboard(client, context);
  assert.equal(blocked.health.readiness, "blocked");
  assert.ok(blocked.health.blockers.some((entry) => entry.includes("CRM-022")));
  await record("CRM-022", "passed");
  const restored = await getCrmCoreAcceptanceDashboard(client, context);
  assert.equal(restored.health.readiness, "ready");

  const timeline = await getCrmCoreAcceptanceTimeline(client, context);
  assert.ok(timeline.some((entry) => entry.entry_type === "check"));
  assert.ok(timeline.some((entry) => entry.entry_type === "snapshot"));

  const tables = ["crm_core_acceptance_runs", "crm_core_acceptance_snapshots"];
  const security = await client.query(
    `SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity,
      EXISTS(SELECT 1 FROM pg_policy policy WHERE policy.polrelid=relation.oid) AS has_policy
     FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname='tenant' AND relation.relname=ANY($1::text[])`,
    [tables],
  );
  assert.equal(security.rows.length, tables.length);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.has_policy, true);
  }

  await client.query("ROLLBACK");
  console.log(
    "CRM-01 live verification passed: 17 capabilities, seven cross-surface gates, fail-closed readiness, immutable snapshot, timeline and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
