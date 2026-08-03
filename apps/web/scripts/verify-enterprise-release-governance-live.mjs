import assert from "node:assert/strict";
import path from "node:path";

import {
  RELEASE_CHECK_KEYS,
  captureReleaseReadinessSnapshot,
  getReleaseGovernanceDashboard,
  getReleaseGovernanceTimeline,
  recordReleaseCheckRun,
  upsertReleaseIncidentCase,
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
    ["027_enterprise_release_governance.sql"],
  );
  assert.ok(migration.rows[0], "Stage 11 tenant migration is not applied.");

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
    permissions: ["organization.manage", "audit.view", "modules.manage"],
    roleSlugs: ["organization_owner"],
  };
  const now = new Date().toISOString();
  for (const checkKey of RELEASE_CHECK_KEYS) {
    const check = await recordReleaseCheckRun(client, context, {
      checkKey,
      status: "passed",
      source: checkKey === "deployment_smoke" ? "deployment" : "ci",
      environment: "staging",
      commitSha: "stage-11-live-verification",
      startedAt: now,
      completedAt: now,
      evidence: { verifiedBy: "stage-11-live", checkKey },
    });
    assert.ok(check.id);
  }

  const dashboard = await getReleaseGovernanceDashboard(client, context);
  assert.equal(dashboard.health.readiness, "ready");
  assert.equal(dashboard.health.score, 100);
  assert.equal(dashboard.checks.length, RELEASE_CHECK_KEYS.length);

  const snapshot = await captureReleaseReadinessSnapshot(client, context, {
    environment: "staging",
    commitSha: "stage-11-live-verification",
    evidence: { purpose: "transactional live verification" },
  });
  assert.ok(snapshot.id);
  assert.equal(snapshot.readiness_status, "ready");
  assert.equal(Number(snapshot.release_score), 100);

  const incident = await upsertReleaseIncidentCase(client, context, {
    service: "web",
    severity: "high",
    status: "investigating",
    title: "Stage 11 live verification incident",
    details: "Temporary incident used to verify fail-closed promotion logic.",
    ownerUserId: organization.created_by,
    nextActionAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.ok(incident.id);
  const blocked = await getReleaseGovernanceDashboard(client, context);
  assert.equal(blocked.health.readiness, "blocked");
  assert.ok(
    blocked.health.blockers.some((entry) => entry.includes("high-severity")),
  );

  const resolved = await upsertReleaseIncidentCase(client, context, {
    id: incident.id,
    service: "web",
    severity: "high",
    status: "resolved",
    title: "Stage 11 live verification incident",
    details: "Resolved inside the verification transaction.",
    ownerUserId: organization.created_by,
  });
  assert.equal(resolved.status, "resolved");

  const timeline = await getReleaseGovernanceTimeline(client, context);
  assert.ok(timeline.some((entry) => entry.entry_type === "check"));
  assert.ok(timeline.some((entry) => entry.entry_type === "incident"));
  assert.ok(timeline.some((entry) => entry.entry_type === "snapshot"));

  const tables = [
    "release_governance_policies",
    "release_governance_check_runs",
    "release_governance_incident_cases",
    "release_governance_snapshots",
  ];
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
    "Stage 11 live verification passed: checks, backup/restore evidence, snapshots, fail-closed incidents, timeline and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
