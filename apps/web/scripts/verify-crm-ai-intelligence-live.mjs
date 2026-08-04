import assert from "node:assert/strict";
import pg from "pg";
import dotenv from "dotenv";
import {
  createNextBestAction,
  captureRelationshipIntelligence,
  createAssistantDraft,
  captureDealRisk,
  recordAiFeedback,
  recordCrmAiAcceptance,
  getCrmAiReadiness,
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
      `SELECT id,created_by FROM public.organizations WHERE status='active' ORDER BY created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(org);
  await client.query(
    `SELECT set_config('app.current_organization_id',$1,true)`,
    [org.id],
  );
  const c = { organizationId: org.id, userId: org.created_by };
  const rec = await createNextBestAction(client, c, {
    entityType: "lead",
    actions: [{ key: "call", label: "Call now", baseScore: 80 }],
    signals: {},
  });
  await captureRelationshipIntelligence(client, c, {
    entityType: "party",
    contacts: [{ role: "buyer" }],
    interactions: [{ at: new Date().toISOString(), sentiment: "positive" }],
  });
  const draft = await createAssistantDraft(client, c, {
    facts: ["Customer requested a proposal"],
    nextStep: "Confirm review date",
  });
  await captureDealRisk(client, c, {
    probability: 25,
    daysWithoutActivity: 21,
    closeOverdue: true,
  });
  await recordAiFeedback(client, c, {
    recommendationId: rec.id,
    draftId: draft.id,
    outcome: "accepted",
  });
  const sha = process.env.RELEASE_SHA || "crm-11-live";
  for (const capabilityId of ["CRM-007", "CRM-008", "CRM-009", "CRM-043"])
    await recordCrmAiAcceptance(client, c, {
      capabilityId,
      commitSha: sha,
      status: "passed",
      evidence: { recommendationId: rec.id, draftId: draft.id },
    });
  assert.equal((await getCrmAiReadiness(client, c, sha)).readiness, "ready");
  await client.query("ROLLBACK");
  console.log("CRM-11 live AI verification passed.");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
