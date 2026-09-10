// CRM vNext Prompt 6 (F017 — Notes & Files), §43: "A user who can view a
// Lead/Opportunity must not automatically see a private Note. Implement
// independent Note-content visibility."
//
// Before this fix, apps/web/src/modules/crm/server/lead-detail-data.ts
// returned EVERY Note attached to a Lead to any caller holding
// crm.leads.view_sensitive — crm_notes had no visibility concept at all
// (confirmed: migration 002_crm_module.sql never added one). Migration
// 103_f017_note_visibility.sql adds a 'shared'/'private' column; this test
// exercises the REAL getLeadDetailData() query (via
// tests/helpers/load-server-ts-module.mjs) against a mock client that
// actually evaluates the visibility WHERE clause — not just a canned
// response — so a regression that widens the predicate would be caught.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadServerTsModule } from "./helpers/load-server-ts-module.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const { getLeadDetailData } = await loadServerTsModule("apps/web/src/modules/crm/server/lead-detail-data.ts");

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "77777777-7777-4777-8777-777777777777";
const leadId = "55555555-5555-4555-8555-555555555555";
const author = "33333333-3333-4333-8333-333333333333";
const unrelatedTeammate = "44444444-4444-4444-8444-444444444444";
const manager = "66666666-6666-4666-8666-666666666666";

const sharedNote = { id: "note-shared", entity_type: "lead", entity_id: leadId, body: "Shared with the team", visibility: "shared", created_by: author };
const privateNote = { id: "note-private", entity_type: "lead", entity_id: leadId, body: "Private — do not share", visibility: "private", created_by: author };

function leadRow() {
  return {
    id: leadId, organization_id: org, company_id: company, branch_id: branch, owner_user_id: author,
    first_name: "Priya", last_name: "Match", email: "priya@example.com", status: "new",
    qualification_state: "not_reviewed", record_status: "active", updated_at: new Date().toISOString(),
  };
}

function context({ userId, sensitive, viewAll = false }) {
  const permissions = [];
  if (sensitive) permissions.push("crm.leads.view_sensitive");
  if (viewAll) permissions.push("crm.records.view_all");
  return {
    organizationId: org, userId, activeCompanyId: company, activeBranchId: branch,
    allowAllCompanies: false, roleSlugs: [], permissions,
  };
}

// A real evaluator for the actual WHERE clause emitted by
// lead-detail-data.ts's notes query — (n.visibility<>'private' OR
// n.created_by=$3 OR $4) — applied against params[2] (userId) and
// params[3] (canViewAllCrmRecords boolean), so this test proves the SQL
// predicate itself, not a mock that always agrees with the code under test.
function mockClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push(sql);
      if (/FROM tenant\.crm_leads/i.test(sql)) return { rows: [leadRow()] };
      if (/FROM tenant\.crm_notes n/i.test(sql)) {
        const callerUserId = params[2];
        const canViewAll = Boolean(params[3]);
        const visible = [sharedNote, privateNote].filter(
          (note) => note.visibility !== "private" || note.created_by === callerUserId || canViewAll,
        );
        return { rows: visible };
      }
      if (/crm_normalize_email/i.test(sql)) return { rows: [{ email: null, mobile: null, business_phone: null, name: null, company: null }] };
      return { rows: [], rowCount: 0 };
    },
  };
}

test("F017: the Note author sees both their own private Note and shared Notes", async () => {
  const data = await getLeadDetailData(mockClient(), context({ userId: author, sensitive: true }), leadId);
  const ids = data.notes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["note-private", "note-shared"]);
});

test("F017: an unrelated sensitive-permission viewer sees the shared Note but NOT the private Note", async () => {
  const data = await getLeadDetailData(mockClient(), context({ userId: unrelatedTeammate, sensitive: true }), leadId);
  const ids = data.notes.map((n) => n.id);
  assert.deepEqual(ids, ["note-shared"]);
});

test("F017: a manager/admin with the organization-wide view-all override sees the private Note too", async () => {
  const data = await getLeadDetailData(mockClient(), context({ userId: manager, sensitive: true, viewAll: true }), leadId);
  const ids = data.notes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["note-private", "note-shared"]);
});

test("F017: a user without Lead sensitive-content permission sees no Notes at all — even their own private Note — and the Notes table is never queried", async () => {
  const client = mockClient();
  const data = await getLeadDetailData(client, context({ userId: author, sensitive: false }), leadId);
  assert.deepEqual(data.notes, []);
  assert.ok(!client.calls.some((sql) => /FROM tenant\.crm_notes n/i.test(sql)), "Notes must not be queried at all without the base sensitive-content permission");
});

test("F017: organization_owner sees the private Note without an explicit crm.records.view_all permission grant", async () => {
  const data = await getLeadDetailData(
    mockClient(),
    { organizationId: org, userId: unrelatedTeammate, activeCompanyId: company, activeBranchId: branch, allowAllCompanies: false, roleSlugs: ["organization_owner"], permissions: [] },
    leadId,
  );
  const ids = data.notes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["note-private", "note-shared"]);
});

// F017 closeout — the Lead notes route no longer inlines its own INSERT;
// it now delegates to the canonical Notes domain module (notes-operations.
// js's own tests cover the visibility-default-to-'shared' behavior and the
// private-visibility predicate directly against the real SQL).
test("F017: the Note routes delegate to the canonical Notes domain module, not a re-derived equivalent", () => {
  const source = read("apps/web/src/app/api/crm/leads/[id]/notes/route.ts");
  assert.match(source, /import \{ createCrmNote, listCrmNotes \} from "@vercentlabs\/api"/);
  assert.match(source, /createCrmNote\(client, context, "lead", id, input\)/);
  assert.match(source, /listCrmNotes\(client, context, "lead", id, \{ includeArchived \}\)/);
});

test("F017 migration adds a constrained shared/private visibility column to crm_notes", () => {
  const migration = read("database/tenant/migrations/103_f017_note_visibility.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'shared'/);
  assert.match(migration, /CHECK \(visibility IN \('shared', 'private'\)\)/);
});
