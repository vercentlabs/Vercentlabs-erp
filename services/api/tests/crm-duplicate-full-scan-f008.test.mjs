import assert from "node:assert/strict";
import test from "node:test";

import {
  DUPLICATE_FULL_SCAN_JOB_TYPE,
  enqueueDuplicateFullScan,
  getDuplicateFullScanJob,
  listDuplicateScanMatches,
  processDuplicateFullScanBatch,
} from "../src/modules/crm/prospect-and-relationship-master-data/duplicate-scan.js";
import { CrmError } from "../src/modules/crm/crm-data-operations-and-customization/errors.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

function context(overrides = {}) {
  // Full scans are org-wide data-quality tooling: view-all callers only.
  return { organizationId: org, userId: user, allowAllCompanies: true, permissions: ["crm.records.view_all", "crm.data-quality.manage"], roleSlugs: [], ...overrides };
}

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

// A single hand-rolled routing table drives every test below — the real
// SQL text from duplicate-scan.js, lead-duplicates.js and
// duplicate-matching.js is matched by regex, same convention as
// crm-lead-duplicates-f008.test.mjs and crm-account-contact-duplicates-
// f008.test.mjs. Building the full route table once here (rather than a
// narrower per-test client) is what makes it possible to exercise the real
// cross-module call chain (processDuplicateFullScanBatch -> fetchPage ->
// evaluateLeadDuplicateRisk/findAccountDuplicates, all real code, nothing
// stubbed) instead of only unit-testing duplicate-scan.js's own SQL.
function makeDb(routes) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const sqlNorm = norm(sql);
      calls.push({ sql: sqlNorm, params });
      for (const [pattern, handler] of routes) {
        if (pattern.test(sqlNorm)) return handler(params, sqlNorm);
      }
      throw new Error(`Unexpected query in duplicate-scan test: ${sqlNorm}`);
    },
  };
}

test("F008 full scan: rejects an unknown entity type before touching the database", async () => {
  const db = makeDb([]);
  await assert.rejects(() => enqueueDuplicateFullScan(db, context(), "opportunity"), (error) => {
    assert.ok(error instanceof CrmError);
    assert.equal(error.status, 400);
    return true;
  });
  assert.equal(db.calls.length, 0);
});

test("F008 full scan: enqueue creates a fresh job with no idempotency key (re-running a scan is always allowed)", async () => {
  const jobRow = {
    id: jobId, job_type: DUPLICATE_FULL_SCAN_JOB_TYPE, status: "pending",
    payload: { entityType: "lead" }, attempts: 0, max_attempts: 3,
    progress: {}, result_manifest: {}, created_at: "2026-01-01", updated_at: "2026-01-01", completed_at: null,
  };
  const db = makeDb([
    [/^INSERT INTO tenant\.background_jobs/, () => ({ rows: [jobRow] })],
    [/^INSERT INTO tenant\.platform_events/, () => ({ rows: [] })],
  ]);
  const job = await enqueueDuplicateFullScan(db, context(), "lead");
  assert.equal(job.id, jobId);
  assert.equal(job.entityType, "lead");
  const insertCall = db.calls.find((c) => /^INSERT INTO tenant\.background_jobs/.test(c.sql));
  assert.ok(!insertCall.sql.includes("idempotency_key"), "no idempotency_key column — a new scan is never deduped against an older one");
});

test("F008 full scan: getDuplicateFullScanJob 404s when the job does not belong to this organization/job type", async () => {
  const db = makeDb([[/^SELECT \* FROM tenant\.background_jobs WHERE organization_id=\$1 AND id=\$2 AND job_type=\$3$/, () => ({ rows: [] })]]);
  await assert.rejects(() => getDuplicateFullScanJob(db, context(), jobId), (error) => {
    assert.ok(error instanceof CrmError);
    assert.equal(error.status, 404);
    return true;
  });
});

test("F008 full scan (leads): a single-page batch finds a real email duplicate via the SAME engine findLeadDuplicates uses, and finishes done", async () => {
  const leadA = {
    id: "44444444-4444-4444-8444-444444444444", code: "LEAD-A", full_name: "Priya Shah", company_name: "Acme",
    status: "working", record_status: "active", company_id: null, branch_id: null, owner_user_id: user,
    normalized_email: "priya@example.com", normalized_mobile: null, normalized_business_phone: null,
    normalized_name: "priya shah", normalized_company_name: "acme",
    first_name: "Priya", last_name: "Shah", email: "priya@example.com", mobile: null, phone: null,
  };
  const leadB = {
    id: "55555555-5555-4555-8555-555555555555", code: "LEAD-B", full_name: "Priya S", company_name: "Acme",
    status: "new", record_status: "active", company_id: null, branch_id: null, owner_user_id: user,
    normalized_email: "priya@example.com", normalized_mobile: null, normalized_business_phone: null,
    normalized_name: "priya s", normalized_company_name: "acme",
    first_name: "Priya", last_name: "S", email: "priya@example.com", mobile: null, phone: null,
  };
  const inserted = [];
  const db = makeDb([
    [/^SELECT \* FROM tenant\.background_jobs WHERE organization_id=\$1 AND id=\$2$/, () => ({
      rows: [{ id: jobId, organization_id: org, job_type: DUPLICATE_FULL_SCAN_JOB_TYPE, payload: { entityType: "lead" }, progress: {} }],
    })],
    [/^SELECT id,first_name,last_name,email,mobile,phone,company_name FROM tenant\.crm_leads/, () => ({ rows: [leadA, leadB] })],
    [/crm_normalize_email/, (params) => ({
      rows: [{
        email: params[0] ? String(params[0]).trim().toLowerCase() : null,
        mobile: null,
        business_phone: null,
        name: `${params[3] ?? ""} ${params[4] ?? ""}`.trim().toLowerCase() || null,
        company: params[5] ? String(params[5]).trim().toLowerCase() : null,
      }],
    })],
    [/FROM tenant\.crm_lead_duplicate_overrides/, () => ({ rows: [] })],
    // The real duplicate-risk candidate search — excludes the record being
    // evaluated (params[1]) so a lead is never reported as its own match.
    [/FROM tenant\.crm_leads\s+WHERE organization_id=\$1\s+AND \(\$2::uuid IS NULL OR id<>\$2\)/, (params) => ({
      rows: [leadA, leadB].filter((row) => row.id !== params[1]),
    })],
    [/^INSERT INTO tenant\.crm_duplicate_scan_matches/, (params) => {
      inserted.push(params);
      return { rows: [] };
    }],
    [/^UPDATE tenant\.background_jobs SET progress=\$3::jsonb,result_manifest=\$3::jsonb,updated_at=now\(\)/, (params) => {
      inserted.manifest = JSON.parse(params[2]);
      return { rows: [] };
    }],
  ]);

  const result = await processDuplicateFullScanBatch(db, context(), jobId);
  assert.equal(result.done, true, "a page smaller than the batch size always finishes the job");
  assert.equal(result.manifest.processed, 2);
  // Each of the two leads independently discovers the other as a match
  // (found counts match instances, same as the append-only scan-matches
  // table before its ON CONFLICT DO NOTHING/UPDATE collapses the reciprocal
  // pair down to one row keyed by the sorted (record_a_id, record_b_id)).
  assert.equal(result.manifest.found, 2);
  assert.equal(inserted.length, 2);
  for (const params of inserted) {
    const [, , entityType, recordAId, recordBId, classification] = params;
    assert.equal(entityType, "lead");
    assert.deepEqual([recordAId, recordBId].sort(), [leadA.id, leadB.id].sort());
    assert.equal(classification, "exact");
  }
});

test("F008 full scan (accounts): reuses the rule-driven findAccountDuplicates engine, not a separate comparison", async () => {
  const accountA = { id: "66666666-6666-4666-8666-666666666666", display_name: "Sunrise Dairy", legal_name: "Sunrise Dairy Pvt Ltd", gstin: "27AAAAA0000A1Z5", pan: null, party_type: "customer", status: "active" };
  const accountB = { id: "77777777-7777-4777-8777-777777777777", display_name: "Sunrise Dairy Ltd", legal_name: "Sunrise Dairy Pvt Ltd", gstin: "27AAAAA0000A1Z5", pan: null, party_type: "customer", status: "active" };
  const ruleRows = [
    { signal: "gstin", method: "exact", weight: 70, fuzzy_threshold: null, enabled: true, blocking: true },
    { signal: "pan", method: "exact", weight: 45, fuzzy_threshold: null, enabled: true, blocking: false },
    { signal: "legal_name", method: "normalized", weight: 35, fuzzy_threshold: null, enabled: true, blocking: false },
  ];
  const inserted = [];
  const db = makeDb([
    [/^SELECT \* FROM tenant\.background_jobs WHERE organization_id=\$1 AND id=\$2$/, () => ({
      rows: [{ id: jobId, organization_id: org, job_type: DUPLICATE_FULL_SCAN_JOB_TYPE, payload: { entityType: "account" }, progress: {} }],
    })],
    [/^SELECT id,display_name,legal_name,gstin,pan FROM tenant\.business_parties/, () => ({ rows: [accountA, accountB] })],
    [/^SELECT \* FROM tenant\.crm_duplicate_rules WHERE organization_id=\$1 AND entity_type=\$2 AND enabled=true/, () => ({ rows: ruleRows })],
    [/^SELECT max\(updated_at\) AS at FROM tenant\.crm_duplicate_rules/, () => ({ rows: [{ at: new Date(0) }] })],
    [/FROM tenant\.business_parties party/, (params) => ({ rows: [accountA, accountB].filter((row) => row.id !== params[params.length - 1]).map((row) => ({ ...row, match_score: 70, matched_signals: ["gstin"] })) })],
    [/FROM tenant\.crm_account_duplicate_overrides/, () => ({ rows: [] })],
    [/^INSERT INTO tenant\.crm_duplicate_scan_matches/, (params) => {
      inserted.push(params);
      return { rows: [] };
    }],
    [/^UPDATE tenant\.background_jobs SET progress=\$3::jsonb,result_manifest=\$3::jsonb,updated_at=now\(\)/, () => ({ rows: [] })],
  ]);

  const result = await processDuplicateFullScanBatch(db, context(), jobId);
  assert.equal(result.done, true);
  assert.equal(result.manifest.found, 2);
  assert.ok(inserted.every(([, , entityType]) => entityType === "account"));
});

test("F008 full scan: listDuplicateScanMatches resolves each record's CURRENT name, never a scan-time snapshot", async () => {
  const matchRow = {
    id: "88888888-8888-4888-8888-888888888888", entity_type: "lead",
    record_a_id: "44444444-4444-4444-8444-444444444444", record_b_id: "55555555-5555-4555-8555-555555555555",
    classification: "exact", matched_signals: ["email"], created_at: "2026-01-01",
  };
  const db = makeDb([
    [/^SELECT \* FROM tenant\.crm_duplicate_scan_matches/, () => ({ rows: [matchRow] })],
    [/^SELECT lead\.id,lead\.full_name AS label FROM tenant\.crm_leads/, () => ({
      rows: [
        { id: "44444444-4444-4444-8444-444444444444", label: "Priya Shah (current)" },
        { id: "55555555-5555-4555-8555-555555555555", label: "Priya S" },
      ],
    })],
  ]);
  const rows = await listDuplicateScanMatches(db, context(), jobId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recordAName, "Priya Shah (current)");
  assert.equal(rows[0].recordBName, "Priya S");
  assert.deepEqual(rows[0].matchedSignals, ["email"]);
});
