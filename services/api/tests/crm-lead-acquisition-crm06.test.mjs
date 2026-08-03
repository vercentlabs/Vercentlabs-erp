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
  validateLeadImportRows,
  verifyLeadAcquisitionWebhookSignature,
} from "../src/crm/lead-acquisition.js";

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
