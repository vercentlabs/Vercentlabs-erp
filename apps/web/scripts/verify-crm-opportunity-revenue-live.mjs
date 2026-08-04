import assert from "node:assert/strict";
import dotenv from "dotenv";
import pg from "pg";
import {
  capturePredictiveForecast,
  cloneOpportunity,
  getCrmOpportunityRevenueReadiness,
  getOpportunityRevenueDashboard,
  recordCrmOpportunityRevenueAcceptance,
  saveMutualActionPlan,
  saveOpportunityRecurringRevenue,
  saveOpportunityRevenueSplits,
  saveQuotaSeasonality,
  submitWinLossReview,
} from "@vercentlabs/api";
dotenv.config({ path: [".env.local", ".env"] });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();
const releaseSha = process.env.RELEASE_SHA || "crm-09-local";
try {
  await client.query("BEGIN");
  const org = (
    await client.query(
      `SELECT id,created_by,base_currency FROM public.organizations ORDER BY created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    org?.created_by,
    "An organisation owner is required for CRM-09 live acceptance.",
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
  const pipeline = (
    await client.query(
      `SELECT p.id,s.id AS stage_id FROM tenant.crm_pipelines p JOIN tenant.crm_pipeline_stages s ON s.organization_id=p.organization_id AND s.pipeline_id=p.id WHERE p.organization_id=$1 ORDER BY s.sequence LIMIT 1`,
      [org.id],
    )
  ).rows[0];
  assert.ok(pipeline, "A CRM pipeline and stage are required.");
  let item = (
    await client.query(
      `SELECT id FROM tenant.items WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,
      [org.id],
    )
  ).rows[0];
  if (!item) {
    const uom = (
      await client.query(
        `SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,
        [org.id],
      )
    ).rows[0];
    assert.ok(uom, "A unit of measure is required.");
    item = (
      await client.query(
        `INSERT INTO tenant.items(organization_id,company_id,code,name,item_type,uom_id,track_inventory,sales_price,created_by,updated_by) VALUES($1,$2,$3,'CRM09 Service','service',$4,false,1200,$5,$5) RETURNING id`,
        [
          org.id,
          company?.id || null,
          `CRM09-ITEM-${Date.now()}`,
          uom.id,
          org.created_by,
        ],
      )
    ).rows[0];
  }
  const opportunity = (
    await client.query(
      `INSERT INTO tenant.crm_opportunities(organization_id,company_id,code,pipeline_id,stage_id,owner_user_id,name,amount,currency_code,probability,expected_close_date,status,forecast_category,next_step,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,'CRM09 Acceptance',1200,$7,60,current_date+30,'open','pipeline','Mutual close plan',$6,$6) RETURNING *`,
      [
        org.id,
        company?.id || null,
        `CRM09-${Date.now()}`,
        pipeline.id,
        pipeline.stage_id,
        org.created_by,
        org.base_currency || "INR",
      ],
    )
  ).rows[0];
  const opportunityItem = (
    await client.query(
      `INSERT INTO tenant.crm_opportunity_items(organization_id,opportunity_id,item_id,description,quantity,unit_price,created_by,updated_by) VALUES($1,$2,$3,'Annual subscription',1,1200,$4,$4) RETURNING id`,
      [org.id, opportunity.id, item.id, org.created_by],
    )
  ).rows[0];
  const schedule = await saveOpportunityRecurringRevenue(client, context, {
    opportunityItemId: opportunityItem.id,
    periods: 12,
    interval: "month",
    startDate: new Date().toISOString(),
    totalAmount: 1200,
  });
  assert.equal(schedule.rows.length, 12);
  const splits = await saveOpportunityRevenueSplits(client, context, {
    opportunityId: opportunity.id,
    splits: [
      {
        userId: org.created_by,
        role: "owner",
        splitType: "revenue",
        percent: 100,
      },
    ],
  });
  assert.equal(splits.splits[0].percent, 100);
  const plan = await saveMutualActionPlan(client, context, {
    opportunityId: opportunity.id,
    name: "CRM09 Close Plan",
    targetCloseDate: opportunity.expected_close_date,
    milestones: [
      {
        title: "Commercial approval",
        internalOwnerUserId: org.created_by,
        dueDate: opportunity.expected_close_date,
        status: "completed",
        completionEvidence: { approved: true },
      },
    ],
  });
  assert.equal(plan.evaluation.ready, true);
  const forecast = await capturePredictiveForecast(client, context, {});
  assert.ok(Number(forecast.snapshot.predicted_amount) > 0);
  let quota = (
    await client.query(
      `SELECT id FROM tenant.crm_quota_plans WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,
      [org.id],
    )
  ).rows[0];
  if (!quota)
    quota = (
      await client.query(
        `INSERT INTO tenant.crm_quota_plans(organization_id,company_id,user_id,name,period_start,period_end,currency_code,target_amount,status,created_by,updated_by) VALUES($1,$2,$3,$4,current_date,date_trunc('year',current_date)::date+interval '1 year - 1 day',$5,100000,'draft',$3,$3) RETURNING id`,
        [
          org.id,
          company?.id || null,
          org.created_by,
          `CRM09 Quota ${Date.now()}`,
          org.base_currency || "INR",
        ],
      )
    ).rows[0];
  const allocation = await saveQuotaSeasonality(client, context, {
    quotaPlanId: quota.id,
    weights: [
      { periodKey: "Q1", weight: 1 },
      { periodKey: "Q2", weight: 1 },
      { periodKey: "Q3", weight: 1 },
      { periodKey: "Q4", weight: 1 },
    ],
  });
  assert.equal(allocation.allocation.length, 4);
  const clone = await cloneOpportunity(client, context, opportunity.id, {
    code: `CRM09-CLONE-${Date.now()}`,
    name: "CRM09 Cloned Opportunity",
    copyItems: true,
  });
  assert.ok(clone.id);
  await client.query(
    `UPDATE tenant.crm_opportunities SET status='lost',actual_close_date=current_date WHERE organization_id=$1 AND id=$2`,
    [org.id, opportunity.id],
  );
  const review = await submitWinLossReview(client, context, {
    opportunityId: opportunity.id,
    primaryReason: "Budget",
    competitorName: "Alternative",
    salesCycleDays: 21,
    lessons: ["Qualify budget earlier"],
  });
  assert.equal(review.outcome, "lost");
  for (const capabilityId of [
    "CRM-051",
    "CRM-052",
    "CRM-053",
    "CRM-073",
    "CRM-074",
    "CRM-075",
    "CRM-076",
    "CRM-077",
  ])
    await recordCrmOpportunityRevenueAcceptance(client, context, {
      capabilityId,
      commitSha: releaseSha,
      status: "passed",
      evidence: {
        opportunityId: opportunity.id,
        cloneId: clone.id,
        forecastId: forecast.snapshot.id,
      },
    });
  const dashboard = await getOpportunityRevenueDashboard(client, context);
  assert.ok(Number(dashboard.summary.open_opportunities) >= 1);
  const readiness = await getCrmOpportunityRevenueReadiness(
    client,
    context,
    releaseSha,
  );
  assert.equal(readiness.readiness, "ready");
  await client.query("ROLLBACK");
  console.log("CRM-09 live opportunity-revenue verification passed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
