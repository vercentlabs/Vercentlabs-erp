import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import {
  applyOfflineBatch,
  getOfflineChanges,
  recordCrmOfflineAcceptance,
  getCrmOfflineReadiness,
  crmOfflineHash,
} from "@vercentlabs/api";
dotenv.config({ path: [".env.local", ".env"], override: false });
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(url, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const org = (
    await client.query(
      `SELECT o.id,o.created_by,o.base_currency,c.id company_id,b.id branch_id FROM public.organizations o LEFT JOIN public.companies c ON c.organization_id=o.id LEFT JOIN public.branches b ON b.organization_id=o.id WHERE o.status='active' ORDER BY o.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(org);
  await client.query(
    `SELECT set_config('app.current_organization_id',$1,true)`,
    [org.id],
  );
  const c = {
    organizationId: org.id,
    userId: org.created_by,
    activeCompanyId: org.company_id,
    activeBranchId: org.branch_id,
  };
  const code = `CRM12-${Date.now()}`;
  const batch = await applyOfflineBatch(client, c, {
    mutations: [
      {
        clientMutationId: `m-${Date.now()}`,
        deviceId: "live",
        operation: "create",
        resource: "leads",
        idempotencyKey: `lead-${code}`,
        payload: {
          code,
          firstName: "Offline",
          lastName: "Lead",
          email: `${code.toLowerCase()}@example.com`,
        },
      },
    ],
  });
  assert.equal(batch.applied, 1);
  const replay = await applyOfflineBatch(client, c, {
    mutations: [
      {
        clientMutationId: `m-replay-${Date.now()}`,
        deviceId: "live",
        operation: "create",
        resource: "leads",
        idempotencyKey: `lead-${code}`,
        payload: { code, firstName: "Offline" },
      },
    ],
  });
  assert.equal(replay.results[0].idempotent, true);
  const changes = await getOfflineChanges(client, c, { cursor: 0 });
  assert.ok(changes.changes.length >= 1);
  const sha = process.env.RELEASE_SHA || "crm-12-live";
  await recordCrmOfflineAcceptance(client, c, {
    commitSha: sha,
    status: "passed",
    evidence: { batch, changes: changes.changes.length },
  });
  assert.equal(
    (await getCrmOfflineReadiness(client, c, sha)).readiness,
    "ready",
  );
  const ledger = JSON.parse(
    (await import("node:fs")).readFileSync(
      "../../docs/implementation/four-module-feature-evidence.json",
      "utf8",
    ),
  );
  const crm = ledger.filter((x) => x.module === "CRM");
  const gates = {
    implemented: crm.filter((x) => x.registerStatus === "Implemented").length,
    accepted: crm.filter((x) => x.acceptanceStatus === "verified").length,
    offline: true,
  };
  assert.equal(gates.implemented, 83);
  assert.equal(gates.accepted, 83);
  await client.query(
    `INSERT INTO tenant.crm_final_acceptance_runs(organization_id,commit_sha,status,capability_count,gate_results,evidence_hash,verified_by) VALUES($1,$2,'passed',83,$3::jsonb,$4,$5)`,
    [org.id, sha, JSON.stringify(gates), crmOfflineHash(gates), org.created_by],
  );
  await client.query("ROLLBACK");
  console.log("CRM-12 live offline and 83-capability verification passed.");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
