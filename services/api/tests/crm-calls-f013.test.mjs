import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCrmCall } from "../src/modules/crm/call-operations.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const call = "66666666-6666-4666-8666-666666666666";
const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: branch, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.view", "crm.leads.view_sensitive"] };

function createClient({ dnc = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads")) return { rows: [{ id: lead, company_id: company, branch_id: branch, phone: "+91 9876543210", do_not_contact: dnc }] };
      if (sql.includes("FROM public.organization_memberships membership")) return { rows: [{ id: user, name: "Seller", email: "seller@example.com" }] };
      if (sql.includes("INSERT INTO tenant.crm_activities")) return { rows: [{ id: call, organization_id: org, company_id: company, branch_id: branch, entity_type: "lead", entity_id: lead, activity_type: "call", subject: "Call lead", description: null, status: "planned", priority: "medium", assigned_to: user, due_at: "2026-08-28T10:00:00.000Z", call_direction: "outbound", call_phone: "+91 9876543210", call_outcome_code: null, call_started_at: null, call_ended_at: null, call_duration_seconds: null, updated_at: "2026-08-27T10:00:00.000Z" }] };
      if (sql.includes("INSERT INTO tenant.crm_call_events")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F013: a scheduled outbound Lead Call resolves its phone and writes Call evidence", async () => {
  const client = createClient();
  const result = await createCrmCall(client, context, { mode: "schedule", entityType: "lead", entityId: lead, subject: "Call lead", direction: "outbound", dueAt: "2026-08-28T10:00:00.000Z" });
  assert.equal(result.id, call);
  assert.equal(result.phoneNumber, "+91 9876543210");
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_call_events")));
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_outbox_events")));
});

test("F013: all-company creation inherits the related record company/branch instead of becoming organization-wide", async () => {
  const client = createClient();
  await createCrmCall(client, { ...context, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true }, {
    mode: "schedule", entityType: "lead", entityId: lead, subject: "Scoped call", direction: "outbound", dueAt: "2026-08-28T10:00:00.000Z",
  });
  const insert = client.calls.find(({ sql }) => sql.includes("INSERT INTO tenant.crm_activities"));
  assert.equal(insert.values[1], company);
  assert.equal(insert.values[2], branch);
});

test("F013: outbound Calls respect Lead do-not-contact before mutation", async () => {
  const client = createClient({ dnc: true });
  await assert.rejects(
    () => createCrmCall(client, context, { mode: "schedule", entityType: "lead", entityId: lead, subject: "Blocked", direction: "outbound", dueAt: "2026-08-28T10:00:00.000Z" }),
    (error) => error.code === "CRM_CALL_DO_NOT_CONTACT",
  );
  assert.equal(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_activities")), false);
});

test("F013: Account and Opportunity phone resolution uses Contacts, never a nonexistent party.phone", () => {
  const source = read("services/api/src/modules/crm/call-operations.js");
  assert.match(source, /FROM tenant\.business_parties party/);
  assert.match(source, /FROM tenant\.contacts contact/);
  assert.match(source, /account_contact\.party_id=opportunity\.party_id/);
  assert.doesNotMatch(source, /party\.phone|party\.mobile/);
});

test("F013: generic Activity create/update/archive/complete cannot bypass governed Calls", () => {
  const source = read("services/api/src/modules/crm/index.js");
  assert.match(
    source,
    /if \(activityType === "call"\)\s*throw new CrmError\(410, "Use the governed Calls operations\.", "CRM_CALL_API_MOVED"\);/,
  );
  assert.match(
    source,
    /if \(before\.activityType === "call" \|\| requestedActivityType === "call"\)\s*throw new CrmError\(410, "Use the governed Calls operations\.", "CRM_CALL_API_MOVED"\);/,
  );
  assert.match(
    source,
    /if \(resource === "activities" && before\.activityType === "call"\)\s*throw new CrmError\(410, "Use the governed Calls operations\.", "CRM_CALL_API_MOVED"\);/,
  );
  assert.match(
    source,
    /if \(current\.activity_type === "call"\)\s*throw new CrmError\(410, "Use the governed Call completion action\.", "CRM_CALL_API_MOVED"\);/,
  );
});

test("F013: legacy server offline-sync cannot directly insert or complete Calls", () => {
  const source = read("services/api/src/modules/crm/offline-sync.js");
  assert.match(source, /governed Calls mobile endpoint for offline Call creation/);
  assert.match(source, /SELECT activity_type FROM tenant\.crm_activities/);
  assert.match(source, /governed Calls mobile endpoint for offline Call completion/);
});

test("F013: Lead follow-up Calls bridge into the governed Call service", () => {
  const source = read("apps/web/src/app/api/crm/leads/[id]/follow-up/route.ts");
  assert.match(source, /createCrmCall/);
  assert.match(source, /input\.activityType === "call"/);
  assert.match(source, /direction: "outbound"/);
  assert.match(source, /crmCallAuditSnapshot/);
});

test("F013: audit/outbox/history evidence intentionally excludes phone numbers and free-text notes", () => {
  const service = read("services/api/src/modules/crm/call-operations.js");
  const audit = read("apps/web/src/modules/crm/audit.ts");
  const safePayload = service.match(/function safeEventPayload\(call\) \{([\s\S]*?)\n\}/)?.[1] || "";
  const eventInsert = service.match(/INSERT INTO tenant\.crm_call_events\(([\s\S]*?)\)\n\s*VALUES/)?.[1] || "";
  const auditSnapshot = audit.match(/export function crmCallAuditSnapshot[\s\S]*?\n\}/)?.[0] || "";
  for (const source of [safePayload, eventInsert, auditSnapshot]) {
    assert.doesNotMatch(source, /phoneNumber|call_phone|description|\boutcome\b(?!Code)/i);
  }
});

test("F013 migration specializes crm_activities and creates immutable RLS Call history", () => {
  const migration = read("database/tenant/migrations/069_crm_calls_f013.sql");
  for (const column of ["call_direction", "call_phone", "call_outcome_code", "call_started_at", "call_ended_at", "call_duration_seconds"]) assert.match(migration, new RegExp(column));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant\.crm_call_events/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON tenant\.crm_call_events/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_organization_isolation/);
});

test("F013 lifecycle is concurrency/replay governed and parent touch is completion-only", () => {
  const source = read("services/api/src/modules/crm/call-operations.js");
  assert.match(source, /CRM_CALL_STALE_WRITE/);
  assert.match(source, /before\.status === "in_progress"[\s\S]{0,120}replayed: true/);
  assert.match(source, /before\.status === "completed"[\s\S]{0,240}replayed: true/);
  assert.match(source, /before\.status === "cancelled"[\s\S]{0,120}replayed: true/);
  assert.match(source, /touchParentOnCompletion/);
});
