import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  CRM_LEAD_ACQUISITION_CAPABILITY_IDS,
  buildEnrichmentReview,
  buildLeadFormDefinition,
  crmLeadAcquisitionHash,
  normalizeLeadAcquisitionEvent,
  normalizeLeadFieldMapping,
  previewLeadImport,
  queueLeadEnrichment,
  reviewLeadEnrichment,
  submitPublishedLeadForm,
  validateLeadImportRows,
  verifyLeadAcquisitionWebhookSignature,
} from "../src/crm/lead-acquisition.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: null,
  allowAllCompanies: true,
};

test("CRM-06 exposes exactly six governed capabilities", () => {
  assert.deepEqual(CRM_LEAD_ACQUISITION_CAPABILITY_IDS, [
    "CRM-054",
    "CRM-056",
    "CRM-057",
    "CRM-058",
    "CRM-059",
    "CRM-063",
  ]);
});

test("lead import mapping rejects unknown target fields", () => {
  assert.deepEqual(normalizeLeadFieldMapping({ firstName: "Given name" }), {
    firstName: "Given name",
  });
  assert.throws(
    () => normalizeLeadFieldMapping({ password: "secret" }),
    /Unsupported lead field mapping/,
  );
});

test("lead import preview validates required and contact fields", () => {
  const rows = validateLeadImportRows(
    [
      { Given: "Asha", Email: "asha@example.com" },
      { Given: "", Email: "invalid" },
    ],
    { firstName: "Given", email: "Email" },
  );
  assert.equal(rows[0].valid, true);
  assert.equal(rows[1].valid, false);
  assert.ok(rows[1].errors.length >= 2);
});

test("lead acquisition screen defaults preview as two valid rows", () => {
  const rows = validateLeadImportRows(
    [
      {
        first_name: "Rahul",
        last_name: "Sharma",
        email: "rahul.crmtest01@example.com",
        phone: "+919876543210",
        company: "Apex Components Pvt Ltd",
        job_title: "Purchase Manager",
      },
      {
        first_name: "Neha",
        last_name: "Patil",
        email: "neha.crmtest02@example.com",
        phone: "+919876543211",
        company: "Nova Engineering LLP",
        job_title: "Operations Head",
      },
    ],
    {
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      companyName: "company",
      jobTitle: "job_title",
    },
  );

  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.valid).length, 2);
  assert.equal(rows.filter((row) => !row.valid).length, 0);
});

test("lead import identity separates files and duplicate strategies", async () => {
  async function previewHash(fileName, duplicateStrategy) {
    let selectedHash = "";
    const client = {
      async query(sql, values) {
        if (sql.includes("SELECT * FROM tenant.crm_lead_import_batches")) {
          selectedHash = values[1];
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO tenant.crm_lead_import_batches")) {
          return { rows: [{ id: "batch-1" }] };
        }
        return { rows: [] };
      },
    };
    await previewLeadImport(client, context, {
      fileName,
      duplicateStrategy,
      fieldMapping: { firstName: "name", email: "email" },
      rows: [{ name: "Asha", email: "asha@example.com" }],
    });
    return selectedHash;
  }

  const original = await previewHash("first.csv", "skip");
  assert.notEqual(original, await previewHash("second.csv", "skip"));
  assert.notEqual(original, await previewHash("first.csv", "update"));
  assert.equal(original, await previewHash("first.csv", "skip"));
});

test("form builder requires unique fields and required first name", () => {
  const form = buildLeadFormDefinition({
    fields: [
      { name: "firstName", type: "text", required: true },
      { name: "email", type: "email" },
    ],
  });
  assert.equal(form.fields.length, 2);
  assert.throws(
    () =>
      buildLeadFormDefinition({
        fields: [{ name: "email", type: "email", required: true }],
      }),
    /firstName/,
  );
});

test("public form submission accepts the projected form_id", async () => {
  const formId = "44444444-4444-4444-8444-444444444444";
  const leadId = "55555555-5555-4555-8555-555555555555";
  const rateLimitFormIds = [];
  const client = {
    async query(sql, values) {
      if (sql.includes("crm_capture_rate_limits")) {
        rateLimitFormIds.push(values[1]);
        return { rows: [{ attempts: 1 }] };
      }
      if (sql.includes("SELECT id FROM tenant.crm_leads")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_leads")) {
        return { rows: [{ id: leadId }] };
      }
      return { rows: [] };
    },
  };

  const result = await submitPublishedLeadForm(
    client,
    context,
    {
      form_id: formId,
      form_schema: {
        fields: [
          { name: "firstName", type: "text", required: true },
          { name: "email", type: "email", required: true },
        ],
      },
      duplicate_strategy: "warn",
    },
    { firstName: "Asha", email: "asha@example.com" },
  );

  assert.equal(result.leadId, leadId);
  assert.deepEqual(rateLimitFormIds, [formId]);
});

test("enrichment queue returns its review id and approved decisions apply", async () => {
  const jobId = "66666666-6666-4666-8666-666666666666";
  const reviewId = "77777777-7777-4777-8777-777777777777";
  const entityId = "88888888-8888-4888-8888-888888888888";
  const queueClient = {
    async query(sql) {
      if (sql.includes("INSERT INTO tenant.crm_enrichment_jobs")) {
        return { rows: [{ id: jobId, status: "queued" }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_enrichment_reviews")) {
        return { rows: [{ id: reviewId }] };
      }
      return { rows: [] };
    },
  };
  const queued = await queueLeadEnrichment(queueClient, context, {
    entityId,
    provider: "mock",
    proposedChanges: { industry: "Automation", jobTitle: "Director" },
    confidence: 90,
  });
  assert.equal(queued.reviewId, reviewId);

  const appliedColumns = [];
  const reviewClient = {
    async query(sql, values) {
      if (sql.includes("FROM tenant.crm_enrichment_reviews review")) {
        return {
          rows: [
            {
              id: reviewId,
              enrichment_job_id: jobId,
              entity_type: "lead",
              entity_id: entityId,
              status: "pending",
              confidence: 90,
              proposed_changes: {
                industry: "Automation",
                jobTitle: "Director",
              },
            },
          ],
        };
      }
      if (sql.includes("UPDATE tenant.crm_leads")) {
        appliedColumns.push(sql);
        return { rows: [] };
      }
      if (sql.includes("UPDATE tenant.crm_enrichment_reviews")) {
        return { rows: [{ id: reviewId, status: values[4] }] };
      }
      return { rows: [] };
    },
  };
  const reviewed = await reviewLeadEnrichment(reviewClient, context, reviewId, {
    decision: "approved",
    acceptedKeys: ["industry", "jobTitle"],
  });
  assert.equal(reviewed.status, "accepted");
  assert.equal(appliedColumns.length, 2);

  appliedColumns.length = 0;
  const rejected = await reviewLeadEnrichment(reviewClient, context, reviewId, {
    decision: "rejected",
    acceptedKeys: ["industry"],
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(appliedColumns.length, 0);
});

test("provider webhooks are timestamp bound", () => {
  const rawBody = JSON.stringify({ id: "event-1" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "crm06-secret";
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
  assert.equal(
    verifyLeadAcquisitionWebhookSignature({
      rawBody,
      timestamp: "1",
      signature,
      secret,
    }),
    false,
  );
});

test("advertising and social payloads normalize to one lead contract", () => {
  const advertising = normalizeLeadAcquisitionEvent("meta", {
    id: "meta-1",
    first_name: "Riya",
    email: "RIYA@example.com",
    campaign_id: "campaign-1",
  });
  assert.equal(advertising.sourceChannel, "advertising");
  assert.equal(advertising.lead.email, "riya@example.com");
  const social = normalizeLeadAcquisitionEvent("instagram", {
    id: "ig-1",
    name: "Rahul",
    phone_number: "+91 98765 43210",
  });
  assert.equal(social.sourceChannel, "social");
});

test("enrichment proposals are allowlisted and evidence hashes are stable", () => {
  const review = buildEnrichmentReview({
    provider: "mock",
    confidence: 93,
    proposedChanges: {
      industry: "Manufacturing",
      jobTitle: "Founder",
      ownerUserId: "must-not-pass",
    },
  });
  assert.deepEqual(Object.keys(review.proposedChanges).sort(), [
    "industry",
    "jobTitle",
  ]);
  assert.equal(
    crmLeadAcquisitionHash({ b: 2, a: 1 }),
    crmLeadAcquisitionHash({ a: 1, b: 2 }),
  );
});
