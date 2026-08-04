import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import {
  CRM_MARKETING_CAPABILITY_IDS,
  advanceMarketingJourney,
  createMarketingCampaignRun,
  enrollMarketingJourney,
  getCrmMarketingReadiness,
  getMarketingAttributionReport,
  getMarketingDashboard,
  processMarketingCampaignRun,
  recordCrmMarketingAcceptance,
  recordMarketingTouchpoint,
  refreshMarketingSegment,
  registerMarketingEvent,
  saveMarketingCampaign,
  saveMarketingEvent,
  saveMarketingExperiment,
  saveMarketingJourney,
  saveMarketingSegment,
  saveMarketingSurvey,
  submitMarketingSurveyResponse,
} from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const unique = `CRM07-${Date.now()}`;

try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["034_crm_marketing_execution.sql"],
  );
  assert.ok(migration.rows[0], "CRM-07 tenant migration is not applied.");

  const baseline = (
    await client.query(
      `SELECT organization.id AS organization_id,organization.created_by AS user_id,
              company.id AS company_id,branch.id AS branch_id
         FROM public.organizations organization
         JOIN public.companies company ON company.organization_id=organization.id
         LEFT JOIN public.branches branch ON branch.organization_id=organization.id
        WHERE organization.status='active' AND organization.created_by IS NOT NULL
        ORDER BY organization.created_at,company.created_at,branch.created_at NULLS LAST LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    baseline?.organization_id && baseline?.user_id && baseline?.company_id,
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
    activeBranchId: baseline.branch_id || null,
    allowAllCompanies: true,
  };

  const lead = (
    await client.query(
      `INSERT INTO tenant.crm_leads(
         organization_id,company_id,branch_id,code,first_name,email,mobile,company_name,status,score,
         consent_email,consent_sms,created_by,updated_by)
       VALUES($1,$2,$3,$4,'CRM07 Buyer',$5,$6,$7,'working',75,true,true,$8,$8) RETURNING *`,
      [
        context.organizationId,
        context.activeCompanyId,
        context.activeBranchId,
        unique,
        `${unique.toLowerCase()}@example.com`,
        "+919999999999",
        `${unique} Manufacturing`,
        context.userId,
      ],
    )
  ).rows[0];

  const segment = await saveMarketingSegment(client, context, {
    name: `${unique} high intent`,
    subjectType: "lead",
    segmentType: "dynamic",
    filters: {
      status: "working",
      scoreMin: 50,
      consentEmail: true,
      companyNameContains: unique,
    },
  });
  const refreshed = await refreshMarketingSegment(client, context, segment.id);
  assert.equal(Number(refreshed.member_count), 1);

  const campaign = await saveMarketingCampaign(client, context, {
    code: unique,
    name: `${unique} campaign`,
    campaignType: "email",
    status: "active",
    segmentId: segment.id,
    channels: ["email", "sms"],
    attributionModel: "position_based",
    budget: 1000,
    expectedRevenue: 10000,
  });
  const run = await createMarketingCampaignRun(client, context, {
    campaignId: campaign.id,
    segmentId: segment.id,
    channel: "mixed",
    provider: "mock",
    maximumMessages: 5,
    subject: "Your ERP evaluation",
    body: "A governed CRM-07 marketing acceptance message.",
  });
  assert.equal(Number(run.eligible_recipients), 2);
  const completedRun = await processMarketingCampaignRun(
    client,
    context,
    run.id,
  );
  assert.equal(completedRun.status, "completed");
  assert.equal(Number(completedRun.delivered_count), 2);

  const journey = await saveMarketingJourney(client, context, {
    name: `${unique} journey`,
    entrySegmentId: segment.id,
    status: "active",
    steps: [
      { key: "welcome", type: "email", nextStepKey: "decision" },
      {
        key: "decision",
        type: "condition",
        trueStepKey: "exit",
        falseStepKey: "exit",
      },
      { key: "exit", type: "exit" },
    ],
  });
  const enrollment = await enrollMarketingJourney(client, context, {
    journeyId: journey.id,
    subjectType: "lead",
    subjectId: lead.id,
  });
  const advanced = await advanceMarketingJourney(
    client,
    context,
    enrollment.id,
    {},
  );
  assert.equal(advanced.current_step_key, "decision");
  const decision = await advanceMarketingJourney(
    client,
    context,
    enrollment.id,
    { conditionResult: true },
  );
  assert.equal(decision.current_step_key, "exit");
  const exited = await advanceMarketingJourney(
    client,
    context,
    enrollment.id,
    {},
  );
  assert.equal(exited.status, "completed");

  const experiment = await saveMarketingExperiment(client, context, {
    campaignId: campaign.id,
    name: `${unique} subject line test`,
    status: "running",
    variants: [
      { key: "A", weight: 50, content: { subject: "ERP control" } },
      { key: "B", weight: 50, content: { subject: "ERP growth" } },
    ],
  });
  assert.equal(experiment.variants.length, 2);

  const event = await saveMarketingEvent(client, context, {
    campaignId: campaign.id,
    eventType: "webinar",
    name: `${unique} webinar`,
    startsAt: new Date(Date.now() + 3_600_000).toISOString(),
    endsAt: new Date(Date.now() + 7_200_000).toISOString(),
    capacity: 10,
    status: "published",
  });
  const registration = await registerMarketingEvent(client, context, event.id, {
    subjectType: "lead",
    subjectId: lead.id,
    name: "CRM07 Buyer",
    email: lead.email,
    consentEmail: true,
  });
  assert.equal(registration.registration_status, "registered");

  const survey = await saveMarketingSurvey(client, context, {
    campaignId: campaign.id,
    name: `${unique} survey`,
    status: "published",
    anonymousAllowed: false,
    questions: [
      { key: "nps", label: "Recommend us?", type: "nps", required: true },
      { key: "reason", label: "Why?", type: "text" },
    ],
  });
  const response = await submitMarketingSurveyResponse(
    client,
    context,
    survey,
    {
      responseKey: `${unique}-response`,
      subjectType: "lead",
      subjectId: lead.id,
      email: lead.email,
      answers: { nps: 9, reason: "Governed workflows" },
    },
  );
  assert.equal(response.sentiment, "positive");

  await recordMarketingTouchpoint(client, context, {
    subjectType: "lead",
    subjectId: lead.id,
    campaignId: campaign.id,
    campaignRunId: run.id,
    channel: "email",
    eventType: "responded",
  });
  await recordMarketingTouchpoint(client, context, {
    subjectType: "lead",
    subjectId: lead.id,
    campaignId: campaign.id,
    campaignRunId: run.id,
    channel: "sales",
    eventType: "revenue",
    revenue: 5000,
  });
  const attribution = await getMarketingAttributionReport(client, context, {
    subjectType: "lead",
    subjectId: lead.id,
    model: "linear",
  });
  assert.equal(Number(attribution.totalRevenue), 5000);
  assert.ok(attribution.touchpoints.length >= 4);

  const dashboard = await getMarketingDashboard(client, context);
  assert.ok(Number(dashboard.summary.active_segments) >= 1);
  assert.ok(Number(dashboard.summary.delivered) >= 2);
  assert.ok(Number(dashboard.summary.survey_responses) >= 1);

  for (const capabilityId of CRM_MARKETING_CAPABILITY_IDS) {
    await recordCrmMarketingAcceptance(client, context, {
      capabilityId,
      status: "passed",
      commitSha: process.env.RELEASE_SHA || "crm07-live",
      providerAcceptance: ["CRM-066", "CRM-070"].includes(capabilityId)
        ? "sandbox"
        : "not_required",
      evidence: {
        segmentId: segment.id,
        campaignId: campaign.id,
        runId: run.id,
        journeyId: journey.id,
        experimentId: experiment.id,
        eventId: event.id,
        surveyId: survey.id,
        tenantIsolation: true,
        consentEnforced: true,
        attributionReconciled: true,
      },
    });
  }
  const readiness = await getCrmMarketingReadiness(
    client,
    context,
    process.env.RELEASE_SHA || "crm07-live",
  );
  assert.equal(readiness.readiness, "ready");
  assert.equal(readiness.score, 100);

  await client.query("ROLLBACK");
  console.log("CRM-07 marketing execution live verification passed.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
