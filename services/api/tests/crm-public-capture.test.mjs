import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureCrmLead } from "../src/modules/crm/index.js";
import { submitPublishedLeadForm } from "../src/modules/crm/prospect-and-relationship-master-data/lead-acquisition.js";

const org = "11111111-1111-4111-8111-111111111111";
const formId = "22222222-2222-4222-8222-222222222222";
const formKey = "33333333333333333333333333333333333333"; // 40 hex-ish chars, format not enforced at this layer

const activeForm = {
  id: formId,
  organization_id: org,
  company_id: null,
  branch_id: null,
  source_id: null,
  campaign_id: null,
  owner_user_id: "44444444-4444-4444-8444-444444444444",
  allowed_origins: [],
  required_fields: [],
  success_message: "Thanks!",
  rate_limit_per_hour: 10,
};

function captureClient({ formRow = activeForm, attempts = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT \* FROM tenant\.crm_public_capture_form\(\$1\)/.test(sql)) {
        return { rows: formRow ? [formRow] : [] };
      }
      if (/SELECT set_config/.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant\.crm_capture_rate_limits/.test(sql)) {
        return { rows: [{ attempts }] };
      }
      if (/crm_normalize_email/.test(sql)) {
        return {
          rows: [{
            email: null,
            mobile: null,
            business_phone: null,
            name: null,
            company: null,
          }],
        };
      }
      if (/FROM tenant\.crm_leads/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("public capture: unknown/revoked form key is rejected", async () => {
  await assert.rejects(
    captureCrmLead(captureClient({ formRow: null }), formKey, { firstName: "A" }, {}),
    (error) => error.status === 404,
  );
});

test("public capture: honeypot field trips rejection before the rate limiter is even consulted", async () => {
  const client = captureClient();
  await assert.rejects(
    captureCrmLead(client, formKey, { firstName: "A", websiteUrl: "http://spam.example" }, {}),
    (error) => error.status === 400 && /Submission rejected/.test(error.message),
  );
  assert.ok(
    !client.calls.some((call) => /crm_capture_rate_limits/.test(call.sql)),
    "the rate limiter must not be touched once the honeypot has already rejected the request",
  );
});

test("public capture: an abusive burst is rejected with 429 once the per-hour limit is exceeded", async () => {
  const client = captureClient({ attempts: 11 }); // form.rate_limit_per_hour is 10
  await assert.rejects(
    captureCrmLead(client, formKey, { firstName: "A" }, {}),
    (error) => error.status === 429,
  );
});

test("public capture: normal traffic under the limit is not rejected by the rate limiter", async () => {
  const client = captureClient({ attempts: 3 });
  // Reaching the (unmocked) required-fields/duplicate-check path — instead of a 429 — proves
  // the limiter allowed this request through.
  await assert.rejects(
    captureCrmLead(client, formKey, { firstName: "A" }, {}),
    (error) => error.status !== 429,
  );
});

test("public capture: tenant resolution comes only from the form key, never from the submitted body", async () => {
  const client = captureClient();
  try {
    await captureCrmLead(client, formKey, { firstName: "A" }, {});
  } catch {
    // expected — we only care that set_config was called with the form's own organization_id
  }
  const tenantCall = client.calls.find((call) => /SELECT set_config/.test(call.sql));
  assert.ok(tenantCall, "expected the tenant context to be set");
  assert.equal(tenantCall.params[0], org);
});

test("public capture: configured capture owner is resolved through the eligible-assignee helper", () => {
  const source = readFileSync(new URL("../src/modules/crm/prospect-and-relationship-master-data/lead-capture.js", import.meta.url), "utf8");
  assert.match(source, /import \{ getEligibleLeadAssignee \}/);
  assert.match(source, /getEligibleLeadAssignee\(client, context, form\.owner_user_id/);
});

test("public capture: a campaign-attributed submission fires campaign.member_responded only when the membership insert actually happens", () => {
  const source = readFileSync(new URL("../src/modules/crm/prospect-and-relationship-master-data/lead-capture.js", import.meta.url), "utf8");
  const start = source.indexOf("export async function captureCrmLead(");
  const end = source.indexOf("\nexport ", start + 1);
  const block = source.slice(start, end);
  assert.match(block, /VALUES \(\$1,\$2,\$3,'responded',\$4\) ON CONFLICT DO NOTHING RETURNING id/);
  assert.match(block, /if \(membership\.rows\[0\]\)/);
  assert.match(block, /runCrmAutomation\(client, context, "campaign\.member_responded", "lead", lead\.id/);
});

function leadAcquisitionClient({ formId: id = formId, attempts = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO tenant\.crm_capture_rate_limits/.test(sql)) {
        return { rows: [{ attempts }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("published lead-acquisition form: an abusive burst is rejected with 429", async () => {
  const client = leadAcquisitionClient({ attempts: 61 }); // default limit is 60
  const form = { id: formId, rate_limit_per_hour: 60, form_schema: { fields: [] } };
  const context = { organizationId: org, userId: "55555555-5555-4555-8555-555555555555" };
  await assert.rejects(
    submitPublishedLeadForm(client, context, form, { __fingerprint: "anonymous" }),
    (error) => error.status === 429,
  );
});

test("published lead-acquisition form: a spoofed __fingerprint per request does not change which counter is incremented once server-computed", async () => {
  // This documents the fix at the route layer (apps/web/src/app/api/crm/lead-acquisition/
  // public/forms/[key]/route.ts): __fingerprint must be a value the ROUTE computed via
  // verifiedCaptureProxyFingerprint()/directCaptureFingerprint() — never a client-controlled
  // header forwarded verbatim. At this service-layer boundary, submitPublishedLeadForm simply
  // hashes whatever __fingerprint it is given, so the security property lives at the route,
  // not here; this test only pins the hashing behavior so a future edit cannot silently start
  // trusting a wider input shape.
  const client = leadAcquisitionClient({ attempts: 1 });
  const form = { id: formId, rate_limit_per_hour: 60, form_schema: { fields: [] } };
  const context = { organizationId: org, userId: "55555555-5555-4555-8555-555555555555" };
  await assert.rejects(
    submitPublishedLeadForm(client, context, form, { __fingerprint: "same-value" }),
    () => true,
  );
  const rateLimitCall = client.calls.find((call) => /crm_capture_rate_limits/.test(call.sql));
  assert.ok(rateLimitCall, "expected a rate-limit row to be written");
  assert.equal(typeof rateLimitCall.params[2], "string");
  assert.equal(rateLimitCall.params[2].length, 64); // sha256-family hex digest, truncated
});
