import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import {
  registerPartnerDeal,
  submitMdfRequest,
  recordFieldVisit,
  saveSequenceBranch,
  createCoachingScorecard,
  awardGamificationPoints,
  processInboundEmail,
  recordCrmPartnerEngagementAcceptance,
  getCrmPartnerEngagementReadiness,
} from "@vercentlabs/api";
dotenv.config({ path: [".env.local", ".env"], override: false });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const org = (
    await client.query(
      `SELECT id,created_by FROM public.organizations WHERE status='active' ORDER BY created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(org);
  await client.query(
    `SELECT set_config('app.current_organization_id',$1,true)`,
    [org.id],
  );
  const context = { organizationId: org.id, userId: org.created_by };
  const deal = await registerPartnerDeal(client, context, {
    accountName: `CRM10 ${Date.now()}`,
    accountDomain: `crm10-${Date.now()}.example`,
    opportunityName: "Partner opportunity",
    estimatedValue: 10000,
  });
  assert.equal(deal.status, "submitted");
  await submitMdfRequest(client, context, {
    title: "Launch campaign",
    amount: 5000,
    businessCase: "Joint demand generation",
  });
  await recordFieldVisit(client, context, {
    entityType: "general",
    purpose: "Partner visit",
    latitude: 18.5204,
    longitude: 73.8567,
  });
  await saveSequenceBranch(client, context, {
    name: "Reply branch",
    steps: [
      { key: "start", next: ["reply"] },
      { key: "reply", next: [], exitGoal: "meeting_booked" },
    ],
  });
  await createCoachingScorecard(client, context, {
    criteria: [{ key: "discovery", maxScore: 5, weight: 1 }],
    observations: { discovery: 4 },
    feedback: "Good discovery",
  });
  await awardGamificationPoints(client, context, {
    events: [{ eventType: "meeting" }],
    rules: [{ eventType: "meeting", points: 10 }],
  });
  await processInboundEmail(client, context, {
    providerMessageId: `crm10-${Date.now()}`,
    from: "lead@example.com",
    subject: "New enquiry",
  });
  const sha = process.env.RELEASE_SHA || "crm-10-live";
  for (const capabilityId of [
    "CRM-037",
    "CRM-044",
    "CRM-048",
    "CRM-050",
    "CRM-055",
    "CRM-078",
    "CRM-079",
    "CRM-080",
    "CRM-082",
    "CRM-083",
  ])
    await recordCrmPartnerEngagementAcceptance(client, context, {
      capabilityId,
      commitSha: sha,
      status: "passed",
      evidence: { dealId: deal.id },
    });
  const readiness = await getCrmPartnerEngagementReadiness(
    client,
    context,
    sha,
  );
  assert.equal(readiness.readiness, "ready");
  await client.query("ROLLBACK");
  console.log("CRM-10 live partner-engagement verification passed.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
