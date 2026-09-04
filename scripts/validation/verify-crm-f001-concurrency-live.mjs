import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";
import { updateCrmRecord } from "../../services/api/src/modules/crm/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
).trim();
if (!connectionString) {
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL is required for F001 live concurrency verification.",
  );
}

const admin = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f001-concurrency-admin",
});
const actorA = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f001-concurrency-a",
});
const actorB = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f001-concurrency-b",
});

const state = {
  leadId: null,
  organizationId: null,
  staleConflictObserved: false,
  blockedUntilFirstCommit: false,
  finalRowCount: 0,
  outboxRows: 0,
  cleanedUp: false,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tenantBegin(client, organizationId) {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organizationId]);
}

await Promise.all([admin.connect(), actorA.connect(), actorB.connect()]);
try {
  const base = (
    await admin.query(`
      SELECT organization.id AS organization_id,
             company.id AS company_id,
             branch.id AS branch_id,
             membership.user_id
        FROM public.organizations organization
        JOIN public.companies company
          ON company.organization_id=organization.id AND company.status='active'
        JOIN public.organization_memberships membership
          ON membership.organization_id=organization.id AND membership.status='active'
        JOIN public.users user_account
          ON user_account.id=membership.user_id AND user_account.status='active'
        LEFT JOIN LATERAL (
          SELECT candidate.id
            FROM public.branches candidate
           WHERE candidate.organization_id=organization.id
             AND candidate.company_id=company.id
             AND candidate.status='active'
           ORDER BY candidate.is_primary DESC,candidate.created_at,candidate.id
           LIMIT 1
        ) branch ON true
       WHERE organization.status='active'
       ORDER BY company.is_primary DESC,organization.created_at,company.created_at,membership.created_at
       LIMIT 1`)
  ).rows[0];
  if (!base) throw new Error("F001 concurrency verification requires an active organization/company/member.");

  const stage = (
    await admin.query(
      `SELECT code FROM tenant.crm_lead_stages
        WHERE organization_id=$1 AND status='active'
        ORDER BY is_initial DESC,sort_order,id LIMIT 1`,
      [base.organization_id],
    )
  ).rows[0];
  if (!stage) throw new Error("F001 concurrency verification requires an active Lead stage.");

  state.organizationId = base.organization_id;
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  await tenantBegin(admin, base.organization_id);
  const created = await admin.query(
    `INSERT INTO tenant.crm_leads(
       organization_id,company_id,branch_id,code,first_name,email,status,record_status,
       owner_user_id,priority,rating,created_by,updated_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,'medium','warm',$8,$8)
     RETURNING id,updated_at,priority`,
    [
      base.organization_id,
      base.company_id,
      base.branch_id || null,
      `F001-CONC-${suffix}`,
      "Concurrency verifier",
      `f001-concurrency-${suffix}@example.invalid`,
      stage.code,
      base.user_id,
    ],
  );
  state.leadId = created.rows[0].id;
  await admin.query("COMMIT");

  const context = {
    organizationId: base.organization_id,
    userId: base.user_id,
    activeCompanyId: base.company_id,
    activeBranchId: base.branch_id || null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.leads.manage", "crm.records.view_all", "crm.leads.view_sensitive"],
  };

  await Promise.all([
    tenantBegin(actorA, base.organization_id),
    tenantBegin(actorB, base.organization_id),
  ]);
  const [versionA, versionB] = await Promise.all([
    actorA.query("SELECT updated_at,priority FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2", [base.organization_id, state.leadId]),
    actorB.query("SELECT updated_at,priority FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2", [base.organization_id, state.leadId]),
  ]);
  const expectedA = versionA.rows[0]?.updated_at?.toISOString();
  const expectedB = versionB.rows[0]?.updated_at?.toISOString();
  if (!expectedA || expectedA !== expectedB) throw new Error("Concurrent actors did not begin from the same Lead version.");

  // A no-op business value is deliberate: updateCrmRecord still advances the
  // optimistic version while avoiding an unrelated changed-field/outbox effect.
  await updateCrmRecord(
    actorA,
    context,
    "leads",
    state.leadId,
    { priority: versionA.rows[0].priority },
    { expectedUpdatedAt: expectedA, requireVersion: true },
  );

  let secondFinished = false;
  const secondWrite = updateCrmRecord(
    actorB,
    context,
    "leads",
    state.leadId,
    { priority: versionB.rows[0].priority },
    { expectedUpdatedAt: expectedB, requireVersion: true },
  )
    .then(() => ({ ok: true }))
    .catch((error) => ({ ok: false, error }))
    .finally(() => {
      secondFinished = true;
    });

  await sleep(150);
  state.blockedUntilFirstCommit = !secondFinished;
  if (!state.blockedUntilFirstCommit) {
    throw new Error("Second Lead writer did not block on the first writer's row lock.");
  }

  await actorA.query("COMMIT");
  const secondResult = await secondWrite;
  if (secondResult.ok) throw new Error("Stale concurrent Lead write unexpectedly succeeded.");
  state.staleConflictObserved =
    Number(secondResult.error?.status) === 409 &&
    String(secondResult.error?.code || "").includes("STALE");
  if (!state.staleConflictObserved) {
    throw new Error(
      `Expected an actionable stale Lead conflict, got ${secondResult.error?.code || secondResult.error?.message || secondResult.error}`,
    );
  }
  await actorB.query("ROLLBACK");

  await tenantBegin(admin, base.organization_id);
  const finalLead = await admin.query(
    "SELECT count(*)::int AS count FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2",
    [base.organization_id, state.leadId],
  );
  state.finalRowCount = Number(finalLead.rows[0]?.count || 0);
  const outbox = await admin.query(
    "SELECT count(*)::int AS count FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_type='leads' AND entity_id=$2",
    [base.organization_id, state.leadId],
  );
  state.outboxRows = Number(outbox.rows[0]?.count || 0);
  if (state.finalRowCount !== 1) throw new Error("Concurrent F001 verification changed Lead cardinality.");
  if (state.outboxRows > 1) throw new Error("Stale concurrent Lead write duplicated the outbox business effect.");
  await admin.query("DELETE FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_id=$2", [base.organization_id, state.leadId]);
  await admin.query("DELETE FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2", [base.organization_id, state.leadId]);
  await admin.query("COMMIT");
  state.cleanedUp = true;

  console.log(JSON.stringify({ passed: true, ...state }, null, 2));
} finally {
  await Promise.allSettled([
    admin.query("ROLLBACK"),
    actorA.query("ROLLBACK"),
    actorB.query("ROLLBACK"),
  ]);
  if (state.leadId && state.organizationId && !state.cleanedUp) {
    try {
      await admin.query("BEGIN");
      await admin.query("SELECT set_config('app.current_organization_id',$1,true)", [state.organizationId]);
      await admin.query("DELETE FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_id=$2", [state.organizationId, state.leadId]);
      await admin.query("DELETE FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2", [state.organizationId, state.leadId]);
      await admin.query("COMMIT");
      state.cleanedUp = true;
    } catch {
      await admin.query("ROLLBACK").catch(() => undefined);
    }
  }
  await Promise.allSettled([admin.end(), actorA.end(), actorB.end()]);
}
