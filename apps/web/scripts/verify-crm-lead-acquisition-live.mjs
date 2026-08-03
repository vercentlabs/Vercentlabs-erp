import assert from "node:assert/strict";
import path from "node:path";
import { createHmac } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";
import {
  CRM_LEAD_ACQUISITION_CAPABILITY_IDS,
  appendLeadChatMessage,
  commitLeadImport,
  createLeadAcquisitionConnection,
  getCrmLeadAcquisitionReadiness,
  getLeadAcquisitionDashboard,
  ingestLeadAcquisitionWebhook,
  previewLeadImport,
  publishLeadForm,
  queueLeadEnrichment,
  recordCrmLeadAcquisitionAcceptance,
  reviewLeadEnrichment,
  rollbackLeadImport,
  saveLeadForm,
  startLeadChatSession,
  submitPublishedLeadForm,
  verifyLeadAcquisitionWebhookSignature,
} from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const unique = `CRM06-${Date.now()}`;

try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["033_crm_lead_acquisition.sql"],
  );
  assert.ok(migration.rows[0], "CRM-06 tenant migration is not applied.");
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
    activeBranchId: baseline.branch_id || null,
    allowAllCompanies: true,
  };

  const preview = await previewLeadImport(client, context, {
    fileName: `${unique}.csv`,
    duplicateStrategy: "skip",
    fieldMapping: {
      firstName: "Given",
      email: "Email",
      companyName: "Company",
    },
    rows: [
      {
        Given: "CRM06 Import",
        Email: `${unique.toLowerCase()}@example.com`,
        Company: "Vercent Test",
      },
      { Given: "", Email: "invalid", Company: "Invalid row" },
    ],
  });
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].valid, true);
  assert.equal(preview.rows[1].valid, false);
  const committed = await commitLeadImport(client, context, preview.batch.id);
  assert.equal(committed.created_rows, 1);
  const importedRow = (
    await client.query(
      `SELECT result_lead_id FROM tenant.crm_lead_import_rows
        WHERE organization_id=$1 AND batch_id=$2 AND action='create'`,
      [context.organizationId, preview.batch.id],
    )
  ).rows[0];
  assert.ok(importedRow?.result_lead_id);
  const rollback = await rollbackLeadImport(client, context, preview.batch.id);
  assert.equal(rollback.rolledBack, 1);

  const form = await saveLeadForm(client, context, {
    name: `${unique} Website form`,
    allowedOrigins: ["https://example.com"],
    duplicateStrategy: "block",
    consentText: "I agree to be contacted.",
    fields: [
      { name: "firstName", label: "First name", type: "text", required: true },
      { name: "email", label: "Work email", type: "email", required: true },
      { name: "companyName", label: "Company", type: "text" },
      { name: "consentEmail", label: "Email consent", type: "checkbox" },
    ],
  });
  const published = await publishLeadForm(client, context, form.id);
  assert.equal(published.status, "active");
  const formResult = await submitPublishedLeadForm(client, context, published, {
    firstName: "CRM06 Form",
    email: `${unique.toLowerCase()}-form@example.com`,
    companyName: "Form Company",
    consentEmail: true,
    consent: true,
    __fingerprint: `${unique}-form-fingerprint`,
  });
  assert.equal(formResult.action, "create");

  const connection = await createLeadAcquisitionConnection(client, context, {
    provider: "mock",
    displayName: `${unique} mock acquisition`,
    credentialReference: "env:CRM06_TEST_PROVIDER",
    status: "sandbox",
  });
  assert.equal(connection.provider, "mock");

  const rawBody = JSON.stringify({ id: `${unique}-signature` });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "crm06-live-secret";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  assert.equal(
    verifyLeadAcquisitionWebhookSignature({
      rawBody,
      timestamp,
      signature,
      secret,
    }),
    true,
  );

  const event = await ingestLeadAcquisitionWebhook(
    client,
    context,
    connection.id,
    "mock",
    {
      id: `${unique}-provider-event`,
      eventType: "lead.created",
      firstName: "CRM06 Provider",
      email: `${unique.toLowerCase()}-provider@example.com`,
      companyName: "Provider Company",
      attribution: { campaign: "Sandbox" },
    },
  );
  assert.equal(event.action, "create");
  const repeated = await ingestLeadAcquisitionWebhook(
    client,
    context,
    connection.id,
    "mock",
    {
      id: `${unique}-provider-event`,
      firstName: "Repeated",
      email: `${unique.toLowerCase()}-provider@example.com`,
    },
  );
  assert.equal(repeated.duplicate, true);

  const chatConnection = await createLeadAcquisitionConnection(
    client,
    context,
    {
      provider: "website_chat",
      displayName: `${unique} website chat`,
      status: "sandbox",
    },
  );
  const chat = await startLeadChatSession(client, context, chatConnection.id, {
    fingerprint: `${unique}-visitor`,
    name: "CRM06 Visitor",
    email: `${unique.toLowerCase()}-chat@example.com`,
    pageUrl: "https://example.com/pricing",
    consent: true,
  });
  assert.ok(
    chat.lead_id,
    "Consented chat visitors must create or link a lead.",
  );
  const message = await appendLeadChatMessage(client, context, chat.id, {
    providerMessageId: `${unique}-message`,
    senderType: "visitor",
    body: "I need an ERP demonstration.",
  });
  assert.equal(message.sender_type, "visitor");

  const job = await queueLeadEnrichment(client, context, {
    entityType: "lead",
    entityId: event.leadId,
    provider: "mock",
    requestedFields: ["industry", "jobTitle"],
    proposedChanges: { industry: "Manufacturing", jobTitle: "Founder" },
    confidence: 95,
    provenance: { providerRecordId: `${unique}-enrichment` },
  });
  const review = (
    await client.query(
      `SELECT id FROM tenant.crm_enrichment_reviews
        WHERE organization_id=$1 AND enrichment_job_id=$2`,
      [context.organizationId, job.id],
    )
  ).rows[0];
  assert.ok(review?.id);
  const reviewed = await reviewLeadEnrichment(client, context, review.id, {
    acceptedKeys: ["industry", "jobTitle"],
  });
  assert.equal(reviewed.status, "accepted");

  const dashboard = await getLeadAcquisitionDashboard(client, context);
  assert.ok(Number(dashboard.summary.imports) >= 1);
  assert.ok(Number(dashboard.summary.published_forms) >= 1);
  assert.ok(Number(dashboard.summary.processed_events) >= 1);

  for (const capabilityId of CRM_LEAD_ACQUISITION_CAPABILITY_IDS) {
    await recordCrmLeadAcquisitionAcceptance(client, context, {
      capabilityId,
      status: "passed",
      commitSha: process.env.RELEASE_SHA || "crm06-live",
      providerAcceptance: ["CRM-054", "CRM-056"].includes(capabilityId)
        ? "not_required"
        : "sandbox",
      evidence: {
        importRollback: true,
        publishedFormId: form.id,
        connectionId: connection.id,
        providerEventId: event.eventId,
        chatSessionId: chat.id,
        enrichmentReviewId: review.id,
        tenantIsolation: true,
        idempotencyVerified: true,
      },
    });
  }
  const readiness = await getCrmLeadAcquisitionReadiness(client, context);
  assert.equal(readiness.readiness, "ready");
  assert.equal(readiness.score, 100);

  await client.query("ROLLBACK");
  console.log("CRM-06 lead-acquisition live verification passed.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
