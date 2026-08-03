import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import {
  CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS,
  createCustomerSuccessPlan,
  getCrmCustomerSuccessReadiness,
  getCustomerSuccessAccount,
  getCustomerSuccessDashboard,
  ingestProductUsageEvent,
  recordCrmCustomerSuccessAcceptance,
  recordCustomerFeedback,
  recalculateCustomerHealth,
  updateCustomerSuccessMilestone,
  upsertRenewalCase,
} from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const unique = `CRM03-${Date.now()}`;
try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["030_crm_customer_success.sql"],
  );
  assert.ok(migration.rows[0], "CRM-03 tenant migration is not applied.");
  const baseline = (
    await client.query(
      `SELECT organization.id AS organization_id,organization.created_by AS user_id,company.id AS company_id,organization.base_currency
     FROM public.organizations organization JOIN public.companies company ON company.organization_id=organization.id
     WHERE organization.status='active' AND organization.created_by IS NOT NULL ORDER BY organization.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    baseline?.organization_id && baseline?.user_id && baseline?.company_id,
    "An active organisation, owner and company are required.",
  );
  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [baseline.organization_id],
  );
  const context = {
    organizationId: baseline.organization_id,
    userId: baseline.user_id,
    activeCompanyId: baseline.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [
      "crm.view",
      "crm.accounts.manage",
      "crm.integrations.manage",
      "crm.reports.view",
    ],
    roleSlugs: ["organization_owner"],
  };
  const account = (
    await client.query(
      `INSERT INTO tenant.business_parties(organization_id,company_id,code,party_type,display_name,legal_name,currency_code,status,created_by,updated_by)
     VALUES($1,$2,$3,'customer',$4,$4,$5,'active',$6,$6) RETURNING *`,
      [
        baseline.organization_id,
        baseline.company_id,
        unique,
        `${unique} Customer`,
        baseline.base_currency || "INR",
        baseline.user_id,
      ],
    )
  ).rows[0];
  const plan = await createCustomerSuccessPlan(client, context, account.id, {
    name: `${unique} onboarding`,
    renewalDate: new Date(Date.now() + 75 * 86400000)
      .toISOString()
      .slice(0, 10),
    objectives: ["Complete onboarding", "Reach first value"],
  });
  assert.equal(plan.party_id, account.id);
  const accountWorkspace = await getCustomerSuccessAccount(
    client,
    context,
    account.id,
  );
  assert.equal(accountWorkspace.milestones.length, 4);
  const byKey = new Map(
    accountWorkspace.milestones.map((row) => [row.milestone_key, row]),
  );
  await assert.rejects(
    () =>
      updateCustomerSuccessMilestone(
        client,
        context,
        byKey.get("first_value").id,
        { status: "completed" },
      ),
    /prerequisite/i,
  );
  for (const key of ["kickoff", "data_ready", "first_value"]) {
    await updateCustomerSuccessMilestone(client, context, byKey.get(key).id, {
      status: "completed",
      completionNotes: `${key} accepted`,
    });
  }
  const usageInput = {
    partyId: account.id,
    externalSystem: "crm03-live",
    externalEventId: unique,
    metricName: "active_users",
    metricValue: 12,
    metricUnit: "users",
  };
  const firstUsage = await ingestProductUsageEvent(client, context, usageInput);
  const duplicateUsage = await ingestProductUsageEvent(
    client,
    context,
    usageInput,
  );
  assert.equal(firstUsage.duplicate, false);
  assert.equal(duplicateUsage.duplicate, true);
  const feedback = await recordCustomerFeedback(client, context, {
    partyId: account.id,
    surveyType: "nps",
    score: 4,
    comment: "Needs a faster implementation follow-up.",
    channel: "crm03-live",
    externalResponseId: unique,
  });
  assert.equal(Number(feedback.normalized_score), 40);
  const renewal = await upsertRenewalCase(client, context, account.id, {
    renewalDate: new Date(Date.now() + 75 * 86400000)
      .toISOString()
      .slice(0, 10),
    contractValue: 125000,
    currencyCode: baseline.base_currency || "INR",
    probability: 70,
    forecastCategory: "best_case",
    riskLevel: "medium",
    nextAction: "Executive renewal review",
  });
  assert.equal(renewal.party_id, account.id);
  const health = await recalculateCustomerHealth(client, context, account.id);
  assert.ok(
    Number(health.healthScore) >= 0 && Number(health.healthScore) <= 100,
  );
  const completedWorkspace = await getCustomerSuccessAccount(
    client,
    context,
    account.id,
  );
  assert.ok(completedWorkspace.usage.length >= 1);
  assert.ok(completedWorkspace.feedback.length >= 1);
  assert.ok(completedWorkspace.renewals.length >= 1);
  assert.ok(completedWorkspace.interventions.length >= 1);
  assert.ok(completedWorkspace.healthHistory.length >= 1);
  const dashboard = await getCustomerSuccessDashboard(client, context);
  assert.ok(Number(dashboard.summary.active_plans) >= 1);
  for (const capabilityId of CRM_CUSTOMER_SUCCESS_CAPABILITY_IDS) {
    await recordCrmCustomerSuccessAcceptance(client, context, {
      capabilityId,
      status: "passed",
      commitSha: process.env.RELEASE_SHA || "crm03-local",
      evidence: {
        liveFixture: unique,
        planId: plan.id,
        accountId: account.id,
        tenantScoped: true,
      },
    });
  }
  const readiness = await getCrmCustomerSuccessReadiness(client, context);
  assert.equal(readiness.readiness, "ready");
  assert.equal(readiness.passed, 5);
  await client.query("ROLLBACK");
  console.log("CRM-03 customer-success live verification passed.");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  throw error;
} finally {
  client.release();
  await pool.end();
}
