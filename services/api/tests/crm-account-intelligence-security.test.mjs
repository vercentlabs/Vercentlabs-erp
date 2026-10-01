// Regression net for the governed, destructive and security-sensitive parts of
// the Account/Contact intelligence services: privacy request readiness and
// execution, retention policy and runs, merge conflict handling and merge
// aliases, and customer-service events. Imports go through the public
// account-intelligence.js boundary, so the same file describes the behaviour
// before and after that file became a compatibility barrel.
import assert from "node:assert/strict";
import test from "node:test";

import {
  executePrivacyRequest,
  getPrivacyRetentionDashboard,
  mergeAccountsGoverned,
  previewPrivacyRequest,
  recordCustomerServiceEvent,
  resolveMergedEntity,
  runPrivacyRetention,
  updatePrivacyRetentionPolicy,
} from "../src/modules/crm/master-data/account-intelligence.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const leadId = "44444444-4444-4444-8444-444444444444";
const policyId = "55555555-5555-4555-8555-555555555555";
const sourceId = "66666666-6666-4666-8666-666666666666";
const survivorId = "77777777-7777-4777-8777-777777777777";
const context = { organizationId: org, userId: user, activeCompanyId: null, roleSlugs: ["organization_owner"], permissions: [] };

function client(responder) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      const answer = responder(sql, values);
      if (answer instanceof Error) throw answer;
      return answer ?? { rows: [], rowCount: 0 };
    },
  };
}

const writes = (calls) => calls.filter(({ sql }) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql));

function privacyClient({ request = {}, subject = {} } = {}) {
  const row = { id: requestId, subject_type: "lead", subject_id: leadId, request_type: "access", status: "open", identity_verified_at: "2026-09-01T00:00:00Z", ...request };
  const lead = { id: leadId, legal_hold: false, first_name: "Asha", ...subject };
  return client((sql) => {
    if (/FROM tenant\.crm_privacy_requests/.test(sql)) return { rows: [row] };
    if (/FROM tenant\.crm_leads\s/.test(sql)) return { rows: [lead] };
    if (/count\(\*\)::int FROM tenant\.crm_activities/.test(sql)) return { rows: [{ activities: 2, communications: 1, notes: 0 }] };
    if (/INSERT INTO tenant\.crm_privacy_execution_runs/.test(sql)) return { rows: [{ id: "run-1" }] };
    return { rows: [] };
  });
}

// ----------------------------------------------------- privacy requests

test("privacy preview: ready only with verified identity, an open request and no legal hold", async () => {
  const ready = await previewPrivacyRequest(privacyClient(), context, requestId);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);
  const blocked = await previewPrivacyRequest(privacyClient({ request: { identity_verified_at: null, status: "completed" }, subject: { legal_hold: true } }), context, requestId);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, ["Identity verification is required.", "Request is already completed.", "The subject is under legal hold."]);
});

test("privacy execution: a blocked request (legal hold, unverified, closed) changes nothing", async () => {
  for (const scenario of [{ subject: { legal_hold: true } }, { request: { identity_verified_at: null } }, { request: { status: "rejected" } }]) {
    const db = privacyClient({ ...scenario, request: { request_type: "deletion", ...(scenario.request || {}) } });
    await assert.rejects(executePrivacyRequest(db, context, requestId, { erasureMode: "anonymize" }), { status: 409, code: "CRM_PRIVACY_EXECUTION_BLOCKED" });
    assert.deepEqual(writes(db.calls), []);
  }
});

test("privacy execution locks the request and the subject before deciding", async () => {
  const db = privacyClient();
  await executePrivacyRequest(db, context, requestId);
  assert.ok(db.calls.some(({ sql }) => /FROM tenant\.crm_privacy_requests[\s\S]*FOR UPDATE/.test(sql)));
  assert.ok(db.calls.some(({ sql }) => /FROM tenant\.crm_leads[\s\S]*FOR UPDATE/.test(sql)));
});

test("privacy execution: access/export returns the subject without changing it, then records the run and completes the request", async () => {
  const db = privacyClient({ request: { request_type: "export" } });
  const result = await executePrivacyRequest(db, context, requestId);
  assert.equal(result.exportPayload.subject.id, leadId);
  assert.deepEqual(result.exportPayload.counts, { activities: 2, communications: 1, notes: 0 });
  const mutations = writes(db.calls).map(({ sql }) => sql.match(/(?:UPDATE|INSERT INTO) tenant\.(\w+)/)[1]);
  assert.deepEqual(mutations, ["crm_privacy_execution_runs", "crm_privacy_requests"]);
  const run = db.calls.find(({ sql }) => /INSERT INTO tenant\.crm_privacy_execution_runs/.test(sql));
  assert.equal(run.values[4], "export");
  assert.match(run.values[6], /^[0-9a-f]{64}$/);
});

test("privacy execution: deletion anonymizes (or erases) the subject and redacts its communications and notes", async () => {
  const anonymize = privacyClient({ request: { request_type: "deletion" } });
  await executePrivacyRequest(anonymize, context, requestId, { erasureMode: "anonymize" });
  const anonymized = writes(anonymize.calls).map(({ sql }) => sql.match(/(?:UPDATE|INSERT INTO) tenant\.(\w+)/)[1]);
  assert.deepEqual(anonymized, ["crm_leads", "crm_communications", "crm_notes", "crm_privacy_execution_runs", "crm_privacy_requests"]);
  assert.match(writes(anonymize.calls)[0].sql, /privacy_status='anonymized'/);

  const erase = privacyClient({ request: { request_type: "deletion" } });
  await executePrivacyRequest(erase, context, requestId, { erasureMode: "erase" });
  assert.ok(writes(erase.calls).some(({ sql }) => /privacy_status='erased'/.test(sql)));

  const invalid = privacyClient({ request: { request_type: "deletion" } });
  await assert.rejects(executePrivacyRequest(invalid, context, requestId, { erasureMode: "shred" }), { status: 400, code: "CRM_PRIVACY_ERASURE_MODE_INVALID" });
  assert.deepEqual(writes(invalid.calls), []);
});

test("privacy execution: correction accepts only the allowed fields; restriction and consent withdrawal stop contact", async () => {
  const correct = privacyClient({ request: { request_type: "correction" } });
  await executePrivacyRequest(correct, context, requestId, { corrections: { email: "new@x.test", score: 99 } });
  const update = writes(correct.calls)[0];
  assert.match(update.sql, /UPDATE tenant\.crm_leads SET email=\$4,updated_by=\$1/);
  assert.doesNotMatch(update.sql, /score/);

  const none = privacyClient({ request: { request_type: "correction" } });
  await assert.rejects(executePrivacyRequest(none, context, requestId, { corrections: { score: 99 } }), { status: 400 });
  assert.deepEqual(writes(none.calls), []);

  for (const requestType of ["restriction", "consent_withdrawal"]) {
    const db = privacyClient({ request: { request_type: requestType } });
    await executePrivacyRequest(db, context, requestId);
    const sqls = writes(db.calls).map(({ sql }) => sql);
    assert.match(sqls[0], /privacy_status='restricted'/);
    assert.match(sqls[1], /do_not_contact=true,consent_email=false,consent_sms=false,consent_whatsapp=false/);
  }
});

// ------------------------------------------------------------ retention

test("retention policy update validates status, action and retention window before writing", async () => {
  const current = { id: policyId, name: "Leads", status: "active", action: "restrict", retention_days: 365 };
  const make = () => client((sql) => (/FROM tenant\.crm_privacy_retention_policies/.test(sql) ? { rows: [current] } : { rows: [{ ...current, updated: true }] }));
  for (const input of [{ status: "paused" }, { action: "delete" }, { retentionDays: -1 }, { retentionDays: 36501 }]) {
    const db = make();
    await assert.rejects(updatePrivacyRetentionPolicy(db, context, policyId, input), { status: 400 });
    assert.deepEqual(writes(db.calls), []);
  }
  const db = make();
  await updatePrivacyRetentionPolicy(db, context, policyId, { action: "anonymize", retentionDays: 730 });
  assert.deepEqual(writes(db.calls)[0].values.slice(0, 4), ["Leads", 730, "anonymize", "active"]);
  // Existing behaviour: a falsy retentionDays (0) means "not supplied" and keeps
  // the current window rather than being rejected.
  const zero = make();
  await updatePrivacyRetentionPolicy(zero, context, policyId, { retentionDays: 0 });
  assert.equal(writes(zero.calls)[0].values[1], 365);
});

test("retention run: only active, unheld, due records (SKIP LOCKED, limit 1..200), each with an execution run", async () => {
  const policy = { id: policyId, name: "Old leads", subject_type: "lead", action: "anonymize", retention_days: 30 };
  const db = client((sql) => {
    if (/FROM tenant\.crm_privacy_retention_policies/.test(sql)) return { rows: [policy] };
    if (/SELECT id FROM tenant\.crm_leads/.test(sql)) return { rows: [{ id: leadId }] };
    if (/INSERT INTO tenant\.crm_privacy_execution_runs/.test(sql)) return { rows: [{ id: "run-1", policy_id: policyId }] };
    return { rows: [] };
  });
  const result = await runPrivacyRetention(db, context, { limit: 5000 });
  assert.deepEqual({ policies: result.policies, processed: result.processed }, { policies: 1, processed: 1 });
  const select = db.calls.find(({ sql }) => /SELECT id FROM tenant\.crm_leads/.test(sql));
  assert.match(select.sql, /legal_hold=false AND privacy_status='active'/);
  assert.match(select.sql, /FOR UPDATE SKIP LOCKED/);
  assert.equal(select.values[3], 200);
  const order = writes(db.calls).map(({ sql }) => sql.match(/(?:UPDATE|INSERT INTO) tenant\.(\w+)/)[1]);
  assert.deepEqual(order, ["crm_leads", "crm_communications", "crm_notes", "crm_privacy_execution_runs", "crm_privacy_retention_policies"]);
});

test("retention dashboard summarizes policies and runs", async () => {
  const db = client((sql) =>
    /retention_policies/.test(sql)
      ? { rows: [{ status: "active" }, { status: "inactive" }] }
      : { rows: [{ status: "completed" }, { status: "failed" }, { status: "completed" }] },
  );
  const dashboard = await getPrivacyRetentionDashboard(db, context);
  assert.deepEqual(dashboard.metrics, { activePolicies: 1, completedRuns: 2, failedRuns: 1 });
});

// ---------------------------------------------------------------- merge

test("account merge: a duplicate-key collision while repointing fails with a stable conflict and writes no history or alias", async () => {
  const party = (id) => ({ id, status: "active", updated_at: "2026-09-01T00:00:00Z", display_name: id === sourceId ? "Source" : "Survivor", parent_party_id: null, parent_visible: true });
  const conflict = Object.assign(new Error("duplicate key"), { code: "23505" });
  const db = client((sql, values) => {
    if (/FROM tenant\.business_parties party\s+LEFT JOIN tenant\.business_parties parent/.test(sql)) return { rows: [party(values[1])] };
    if (/FROM pg_constraint/.test(sql)) return { rows: [{ table_name: "crm_account_plans", column_name: "party_id" }] };
    if (/UPDATE tenant\."crm_account_plans"/.test(sql)) return conflict;
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(mergeAccountsGoverned(db, context, sourceId, survivorId, "dup"), { status: 409, code: "CRM_MERGE_RELATIONSHIP_CONFLICT" });
  const tables = writes(db.calls).map(({ sql }) => sql);
  assert.equal(tables.some((sql) => /crm_account_merge_history|crm_entity_merge_aliases/.test(sql)), false);
  assert.equal(tables.some((sql) => /SET status='inactive',privacy_status='restricted',parent_party_id=NULL/.test(sql)), false);
  assert.match(db.calls[0].sql, /FROM tenant\.business_parties[\s\S]*ORDER BY id FOR UPDATE/);
  assert.deepEqual(db.calls[0].values[1], [sourceId, survivorId].sort());
});

test("merge aliases resolve only account/contact sources by the latest merge", async () => {
  const db = client(() => ({ rows: [{ survivor_entity_id: survivorId }] }));
  assert.deepEqual(await resolveMergedEntity(db, context, "account", sourceId), { survivor_entity_id: survivorId });
  assert.match(db.calls[0].sql, /ORDER BY merged_at DESC LIMIT 1/);
  await assert.rejects(resolveMergedEntity(db, context, "lead", sourceId), { status: 400 });
  await assert.rejects(resolveMergedEntity(db, context, "account", "nope"), { status: 400, code: "CRM_IDENTIFIER_INVALID" });
});

// ---------------------------------------------- customer-service events

test("customer-service events require a visible Account, a known event type and a title", async () => {
  const visible = () => client((sql) => (/FROM tenant\.business_parties party/.test(sql) ? { rows: [{ id: sourceId }] } : { rows: [{ id: "event-1" }] }));
  await assert.rejects(recordCustomerServiceEvent(visible(), context, sourceId, { eventType: "refund", title: "x" }), { status: 400 });
  await assert.rejects(recordCustomerServiceEvent(visible(), context, sourceId, { eventType: "complaint", title: "  " }), { status: 400 });
  const hidden = client(() => ({ rows: [] }));
  await assert.rejects(recordCustomerServiceEvent(hidden, context, sourceId, { title: "x" }), { status: 404, code: "CRM_ACCOUNT_NOT_FOUND" });
  assert.deepEqual(writes(hidden.calls), []);
  const db = visible();
  await recordCustomerServiceEvent(db, context, sourceId, { title: "Called in", externalCaseId: "SUP-1" });
  const insert = writes(db.calls)[0];
  assert.match(insert.sql, /ON CONFLICT \(organization_id,external_system,external_case_id\)/);
  assert.equal(insert.values[6], "service_note");
});
