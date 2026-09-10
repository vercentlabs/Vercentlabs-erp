import assert from "node:assert/strict";
import test from "node:test";

import { resources, recordScope, listCrmRecords, getCrmRecord } from "../src/modules/crm/index.js";

// Integrity closeout (Prompts 1-5) established that crm_communications
// needed a real company/branch/owner boundary derived from its actual
// linked parent record (it is companyScoped:false with no owner column of
// its own) — that part is UNCHANGED here (recordScope's parent-scope
// EXISTS-subquery join to Lead/Opportunity/Party/Contact).
//
// F018 final closeout supersedes the earlier "hide the whole table without
// crm.leads.view_sensitive" design that this file used to pin. AUDIENCE
// ("does this row exist for this caller at all") and CONTENT ("can this
// caller read its subject/body") are now two separate decisions
// (communication-projection.js): recordScope only ever decides audience
// (parent scope + team/private/participant tier) — it no longer returns
// "AND false" for a caller lacking crm.leads.view_sensitive. Content is
// decided afterward, per row, by projectCrmRecord's communications branch:
// a restricted caller now gets a real, audience-scoped row back (not a
// blanket denial), but with subject/body/recipients redacted to a metadata
// stub — exactly the "stricter field/content visibility than record
// visibility" the dossier (F018-SEC-002) asks for, rather than an
// all-or-nothing gate.

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";

const restrictedContext = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view"],
};

const sensitiveContext = {
  ...restrictedContext,
  permissions: ["crm.view", "crm.leads.view_sensitive"],
};

function mockClient(rows = []) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows };
    },
  };
}

test("recordScope: communications get the canonical audience clause (parent scope + team/private/participant) for EVERY caller, restricted or not — audience is no longer gated on the sensitive-content permission", () => {
  const parameters = [org, "communication-id"];
  const clause = recordScope(resources.communications, restrictedContext, parameters, "record");
  // The clause is NOT an unconditional top-level "AND false" (that would
  // mean the whole table is hidden, the old behavior this test used to
  // pin) — it still ends with the real, evaluable audience predicate.
  // Nested "AND false" fragments MAY still appear inside the parent-scope
  // EXISTS subqueries themselves (e.g. a Lead-linked row's own scope check)
  // — that is pre-existing, unrelated Lead/Opportunity scoping behavior,
  // not something communications' own audience gate controls.
  assert.doesNotMatch(clause.trim(), /^AND false$/, "a restricted actor must still get an audience-scoped clause, not a blanket denial — content is redacted downstream, not the row hidden");
  assert.match(clause, /record\.visibility='team' OR record\.created_by=\$\d+/, "must carry the canonical audience predicate regardless of sensitive-content permission");
});

test("recordScope: a caller with crm.leads.view_sensitive gets the SAME parent-aware scope clause — the permission no longer changes recordScope's audience SQL at all, only content projection downstream", () => {
  const parameters = [org, "communication-id"];
  const clause = recordScope(resources.communications, sensitiveContext, parameters, "record");
  assert.doesNotMatch(clause, /AND false$/, "a permitted actor must not be universally denied");
  assert.match(clause, /record\.lead_id IS NOT NULL/, "must check Lead linkage");
  assert.match(clause, /record\.opportunity_id IS NOT NULL/, "must check Opportunity linkage");
  assert.match(clause, /tenant\.crm_leads lead/, "must join the linked Lead to reuse its own real scope");
  assert.match(clause, /tenant\.crm_opportunities opportunity/, "must join the linked Opportunity to reuse its own real scope");
  // The Opportunity EXISTS subquery must itself carry real company/branch/
  // owner scope (recordScope applied recursively for resources.opportunities)
  // — proving a permitted caller in Company A still cannot read a
  // communication linked to an Opportunity that belongs to Company B.
  assert.match(clause, /opportunity\.company_id/, "the nested Opportunity scope must still apply company scoping");
});

test("getCrmRecord: fetching a single communication by id for a restricted actor returns a real, audience-scoped row with content redacted to metadata (not a 404, not full content)", async () => {
  const row = {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: org,
    channel: "email",
    direction: "outbound",
    status: "sent",
    occurred_at: "2026-09-10T10:30:00.000Z",
    visibility: "team",
    created_by: "99999999-9999-4999-8999-999999999999",
    subject: "Confidential pricing",
    body: "Here is the discount structure...",
    from_address: "seller@example.com",
    to_addresses: ["buyer@example.com"],
  };
  const client = mockClient([row]);
  const result = await getCrmRecord(client, restrictedContext, "communications", row.id);
  assert.equal(result.contentVisibility, "metadata", "a restricted, non-sender caller must get a metadata-only projection");
  assert.equal(result.subject, undefined, "subject must be redacted for a restricted caller");
  assert.equal(result.body, undefined, "body must be redacted for a restricted caller");
  assert.equal(result.fromAddress, undefined, "sender address must be redacted for a restricted caller");
  assert.equal(result.channel, "email", "channel is metadata and must still be present");
  assert.equal(result.status, "sent", "status is metadata and must still be present");
});

test("getCrmRecord: fetching a single communication by id for a sensitive-content-permitted actor returns full content", async () => {
  const row = {
    id: "33333333-3333-4333-8333-333333333333",
    organization_id: org,
    channel: "email",
    direction: "outbound",
    status: "sent",
    occurred_at: "2026-09-10T10:30:00.000Z",
    visibility: "team",
    created_by: "99999999-9999-4999-8999-999999999999",
    subject: "Confidential pricing",
    body: "Here is the discount structure...",
  };
  const client = mockClient([row]);
  const result = await getCrmRecord(client, sensitiveContext, "communications", row.id);
  assert.equal(result.contentVisibility, "full");
  assert.equal(result.subject, "Confidential pricing");
  assert.equal(result.body, "Here is the discount structure...");
});

test("listCrmRecords: listing communications for a restricted actor returns audience-scoped rows with content redacted, not zero rows and not an error", async () => {
  const rows = [{
    id: "should-appear-redacted",
    organization_id: org,
    channel: "email",
    direction: "inbound",
    status: "received",
    occurred_at: "2026-09-10T09:00:00.000Z",
    visibility: "team",
    created_by: "99999999-9999-4999-8999-999999999999",
    subject: "Should be redacted",
    body: "Should be redacted",
  }];
  const client = mockClient(rows);
  const result = await listCrmRecords(client, restrictedContext, "communications", {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].contentVisibility, "metadata");
  assert.equal(result.rows[0].subject, undefined);
  const sql = client.queries.find((q) => q.sql.includes("crm_communications"))?.sql;
  assert.ok(sql, "expected a crm_communications list query");
  assert.match(sql, /record\.visibility='team' OR record\.created_by=\$\d+/, "the underlying audience query must carry the real, evaluable canonical predicate — not an unconditional denial");
});

test("listCrmRecords: the caller's own sent communication is never redacted, even without the sensitive-content permission", async () => {
  const rows = [{
    id: "own-communication",
    organization_id: org,
    channel: "email",
    direction: "outbound",
    status: "sent",
    occurred_at: "2026-09-10T09:00:00.000Z",
    visibility: "team",
    created_by: actorId,
    subject: "My own email",
    body: "My own body",
  }];
  const client = mockClient(rows);
  const result = await listCrmRecords(client, restrictedContext, "communications", {});
  assert.equal(result.rows[0].contentVisibility, "full");
  assert.equal(result.rows[0].subject, "My own email");
});
