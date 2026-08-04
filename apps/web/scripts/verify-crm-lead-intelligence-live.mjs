import assert from "node:assert/strict";
import dotenv from "dotenv";
import pg from "pg";
import {
  recordCrmLeadIntelligenceAcceptance,
  recordLeadBehaviorEvent,
  openLeadSlaCase,
  recordLeadResponse,
  refreshLeadNurtureQueue,
  getLeadIntelligenceDashboard,
  getCrmLeadIntelligenceReadiness,
} from "@vercentlabs/api";
dotenv.config({ path: [".env.local", ".env"] });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();
const releaseSha = process.env.RELEASE_SHA || "crm-08-local";
try {
  await client.query("BEGIN");
  const org = (
    await client.query(
      `SELECT id,created_by FROM public.organizations ORDER BY created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    org,
    "At least one organisation is required for CRM-08 live acceptance.",
  );
  await client.query(
    `SELECT set_config('app.current_organization_id',$1,true)`,
    [org.id],
  );
  const context = {
    organizationId: org.id,
    userId: org.created_by,
    allowedCompanyIds: [],
    allowedBranchIds: [],
    allowAllCompanies: true,
    allowAllBranches: true,
  };
  const company = (
    await client.query(
      `SELECT id FROM public.companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,
      [org.id],
    )
  ).rows[0];
  const lead = (
    await client.query(
      `INSERT INTO tenant.crm_leads(organization_id,company_id,code,first_name,last_name,email,company_name,status,priority,consent_email,created_by,updated_by) VALUES($1,$2,$3,'CRM08','Acceptance','crm08@example.com','CRM08 Industries','new','high',true,$4,$4) RETURNING *`,
      [org.id, company?.id || null, `CRM08-${Date.now()}`, org.created_by],
    )
  ).rows[0];
  const eventResult = await recordLeadBehaviorEvent(client, context, {
    leadId: lead.id,
    eventType: "demo_requested",
    sourceType: "manual",
    idempotencyKey: `crm08-${lead.id}`,
  });
  assert.ok(eventResult.score.score >= 30);
  const sla = await openLeadSlaCase(client, context, lead.id, {
    startedAt: new Date().toISOString(),
  });
  assert.ok(sla.response_due_at);
  const response = await recordLeadResponse(client, context, lead.id, {
    responseType: "call",
  });
  assert.equal(response.cases, 1);
  const nurture = await refreshLeadNurtureQueue(client, context);
  assert.ok(nurture.evaluated >= 1);
  for (const capabilityId of ["CRM-060", "CRM-061", "CRM-062"])
    await recordCrmLeadIntelligenceAcceptance(client, context, {
      capabilityId,
      commitSha: releaseSha,
      status: "passed",
      evidence: {
        leadId: lead.id,
        score: eventResult.score.score,
        slaCaseId: sla.id,
      },
    });
  const dashboard = await getLeadIntelligenceDashboard(client, context);
  assert.ok(Number(dashboard.summary.active_leads) >= 1);
  const readiness = await getCrmLeadIntelligenceReadiness(
    client,
    context,
    releaseSha,
  );
  assert.equal(readiness.readiness, "ready");
  await client.query("ROLLBACK");
  console.log("CRM-08 live lead-intelligence verification passed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
