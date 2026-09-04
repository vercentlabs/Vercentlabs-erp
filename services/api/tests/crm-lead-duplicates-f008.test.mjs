import assert from "node:assert/strict";
import test from "node:test";

import {
  LeadDuplicateError,
  assertLeadDuplicatePolicy,
  evaluateLeadDuplicateRisk,
  hasLeadDuplicateIdentityChange,
  recordLeadDuplicateOverride,
} from "../src/modules/crm/lead-duplicates.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const company = "44444444-4444-4444-8444-444444444444";
const branch = "55555555-5555-4555-8555-555555555555";

const normalizeText = (value) => {
  const v = String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return v || null;
};
const normalizePhone = (value) => {
  const v = String(value ?? "").replace(/[^0-9]+/g, "");
  return v || null;
};

function context(overrides = {}) {
  return {
    organizationId: org,
    userId: user,
    activeCompanyId: company,
    activeBranchId: branch,
    allowAllCompanies: false,
    permissions: ["crm.view"],
    roleSlugs: ["sales_representative"],
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    code: "LEAD-001",
    full_name: "Priya Shah",
    company_name: "Acme Manufacturing",
    status: "working",
    record_status: "active",
    company_id: company,
    branch_id: branch,
    owner_user_id: user,
    normalized_email: "priya@example.com",
    normalized_mobile: "919999911111",
    normalized_business_phone: "912012345678",
    normalized_name: "priya shah",
    normalized_company_name: "acme manufacturing",
    ...overrides,
  };
}

function client(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/crm_normalize_email/.test(sql)) {
        return {
          rows: [{
            email: normalizeText(params[0]),
            mobile: normalizePhone(params[1]),
            business_phone: normalizePhone(params[2]),
            name: normalizeText(`${params[3] ?? ""} ${params[4] ?? ""}`),
            company: normalizeText(params[5]),
          }],
        };
      }
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [{}] };
      if (/FROM tenant\.crm_leads/.test(sql)) return { rows };
      if (/INSERT INTO tenant\.crm_lead_duplicate_overrides/.test(sql)) {
        return { rows: [{ id: "override-1", reason: params[3] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F008: identical normalized email is an exact duplicate", async () => {
  const db = client([row()]);
  const result = await evaluateLeadDuplicateRisk(db, context(), {
    firstName: "Priya",
    lastName: "Shah",
    email: "  PRIYA@EXAMPLE.COM ",
  });
  assert.equal(result.classification, "exact");
  assert.deepEqual(result.matches[0].signals.includes("email"), true);
});

test("F008: phone formatting differences normalize deterministically", async () => {
  const db = client([row()]);
  const result = await evaluateLeadDuplicateRisk(db, context(), {
    mobile: "+91 99999 11111",
  });
  assert.equal(result.classification, "exact");
  assert.ok(result.matches[0].signals.includes("mobile"));
});

test("F008: name plus company is probable, never exact by itself", async () => {
  const db = client([row({ normalized_email: null, normalized_mobile: null })]);
  const result = await evaluateLeadDuplicateRisk(db, context(), {
    firstName: "Priya",
    lastName: "Shah",
    companyName: "ACME   Manufacturing",
  });
  assert.equal(result.classification, "probable");
});

test("F008: name alone does not block or warn", async () => {
  const db = client([]);
  const result = await evaluateLeadDuplicateRisk(db, context(), {
    firstName: "Priya",
    lastName: "Shah",
  });
  assert.equal(result.classification, "none");
});

test("F008: integrity search is organization-wide but hidden records are redacted", async () => {
  const db = client([row({ owner_user_id: other })]);
  const result = await evaluateLeadDuplicateRisk(db, context(), {
    email: "priya@example.com",
  });
  assert.equal(result.classification, "exact");
  assert.deepEqual(result.matches[0], { restricted: true });
  assert.doesNotMatch(JSON.stringify(result.matches[0]), /classification|signals|email/);
  const select = db.calls.find((call) => /FROM tenant\.crm_leads/.test(call.sql));
  assert.equal(select.params[0], org);
  assert.doesNotMatch(select.sql, /owner_user_id\s*=/);
});

test("F008: authorized viewer sees safe identity but not contact PII", async () => {
  const db = client([row({ owner_user_id: other })]);
  const result = await evaluateLeadDuplicateRisk(
    db,
    context({ permissions: ["crm.view", "crm.records.view_all"] }),
    { email: "priya@example.com" },
  );
  assert.equal(result.matches[0].id, row().id);
  assert.equal(result.matches[0].name, "Priya Shah");
  assert.equal("email" in result.matches[0], false);
  assert.equal("mobile" in result.matches[0], false);
});

test("F008: exact duplicate blocks without an override", async () => {
  await assert.rejects(
    assertLeadDuplicatePolicy(client([row()]), context(), { email: "priya@example.com" }),
    (error) => error instanceof LeadDuplicateError && error.code === "CRM_LEAD_DUPLICATE_EXACT" && error.status === 409,
  );
});

test("F008: ordinary seller cannot force an exact duplicate", async () => {
  await assert.rejects(
    assertLeadDuplicatePolicy(client([row()]), context(), { email: "priya@example.com" }, { overrideReason: "Separate buying unit for this opportunity" }),
    (error) => error.code === "CRM_LEAD_DUPLICATE_OVERRIDE_FORBIDDEN",
  );
});

test("F008: authorized data-quality manager must provide a meaningful reason", async () => {
  const manager = context({ permissions: ["crm.view", "crm.records.view_all", "crm.data-quality.manage"] });
  await assert.rejects(
    assertLeadDuplicatePolicy(client([row()]), manager, { email: "priya@example.com" }, { overrideReason: "short" }),
    (error) => error.code === "CRM_LEAD_DUPLICATE_OVERRIDE_REASON_REQUIRED",
  );
});

test("F008: authorized exact override is immutable-ledger ready and locks the identity", async () => {
  const db = client([row()]);
  const manager = context({ permissions: ["crm.view", "crm.records.view_all", "crm.data-quality.manage"] });
  const evaluation = await assertLeadDuplicatePolicy(
    db,
    manager,
    { email: "priya@example.com" },
    { overrideReason: "Separate buying unit with an independent procurement process" },
  );
  assert.equal(evaluation.overrideReason.startsWith("Separate buying unit"), true);
  assert.ok(db.calls.some((call) => /pg_advisory_xact_lock/.test(call.sql)));
  const ledger = await recordLeadDuplicateOverride(db, manager, "77777777-7777-4777-8777-777777777777", evaluation, "create");
  assert.equal(ledger.id, "override-1");
});

test("F008: unrelated Lead updates do not trigger identity rechecks", () => {
  assert.equal(hasLeadDuplicateIdentityChange({ priority: "high" }), false);
  assert.equal(hasLeadDuplicateIdentityChange({ email: "new@example.com" }), true);
});
