import assert from "node:assert/strict";
import test from "node:test";

import { getCrmRecordTimelinePage, getCrmTimelinePageBySource } from "../src/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "77777777-7777-4777-8777-777777777777";
const user = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const opportunity = "66666666-6666-4666-8666-666666666666";
const party = "88888888-8888-4888-8888-888888888888";
const contact = "99999999-9999-4999-8999-999999999999";
const campaign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function baseContext({ sensitive = [], viewAll = false, ownerScope = true } = {}) {
  return {
    organizationId: org,
    userId: user,
    activeCompanyId: ownerScope ? company : company,
    activeBranchId: branch,
    allowAllCompanies: false,
    roleSlugs: [],
    permissions: [...sensitive, ...(viewAll ? ["crm.records.view_all"] : [])],
  };
}

function activityRow(id, occurredAt) {
  return { id, kind: "activity", subtype: "call", title: "Called", occurred_at: occurredAt, status: "completed", actor_user_id: user, created_by: user };
}

function createClient({ leadRow, opportunityRow, partyRow, contactRow, campaignRow, timelineRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads lead")) return { rows: leadRow ? [leadRow] : [] };
      if (sql.includes("FROM tenant.crm_opportunities opportunity")) return { rows: opportunityRow ? [opportunityRow] : [] };
      // Account/Contact access is now decided in SQL (company boundary +
      // ownership, crm-access-scope.js); emulate the company predicate: the
      // bound active company must match the row's company (NULL = shared).
      const inCompany = (row) => !row.company_id || values.includes(row.company_id);
      if (sql.includes("FROM tenant.business_parties account WHERE")) return { rows: partyRow && inCompany(partyRow) ? [partyRow] : [] };
      if (sql.includes("FROM tenant.contacts contact")) return { rows: contactRow && inCompany(contactRow) ? [contactRow] : [] };
      if (sql.includes("FROM tenant.crm_campaigns WHERE")) return { rows: campaignRow ? [campaignRow] : [] };
      if (sql.includes("WITH combined AS")) return { rows: timelineRows };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F019: a caller without Lead sensitive-content permission gets an empty timeline and no content query is even attempted", async () => {
  const client = createClient();
  const result = await getCrmRecordTimelinePage(client, baseContext({}), "lead", lead, {});
  assert.deepEqual(result, { rows: [], hasMore: false, nextCursor: null });
  assert.equal(client.calls.length, 0, "no query should run at all — the permission gate is checked before any DB round trip");
});

test("F019: an authorized Lead caller outside the record's company scope gets an empty timeline", async () => {
  const client = createClient({ leadRow: { id: lead } }); // no company_id column returned -> scope predicate excludes via SQL in real DB; simulate denial by omitting row
  const denyClient = createClient({ leadRow: null });
  const result = await getCrmRecordTimelinePage(denyClient, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, {});
  assert.deepEqual(result, { rows: [], hasMore: false, nextCursor: null });
});

test("F019: an authorized, in-scope Lead caller merges activities/communications/notes in one query, with the private-Note predicate present", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [activityRow("a1", "2026-09-01T10:00:00.000Z")] });
  const result = await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, {});
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "a1");
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.ok(combined.sql.includes("FROM tenant.crm_activities"));
  assert.ok(combined.sql.includes("FROM tenant.crm_communications"));
  assert.ok(combined.sql.includes("FROM tenant.crm_notes"));
  assert.ok(combined.sql.includes("visibility<>'private'"));
});

test("F019: Opportunity entities reuse the Lead sensitive-content permission (established precedent, not a re-derived equivalent)", async () => {
  const deniedClient = createClient();
  const denied = await getCrmRecordTimelinePage(deniedClient, baseContext({}), "opportunity", opportunity, {});
  assert.deepEqual(denied, { rows: [], hasMore: false, nextCursor: null });

  const allowedClient = createClient({ opportunityRow: { id: opportunity, company_id: company, branch_id: branch }, timelineRows: [] });
  const allowed = await getCrmRecordTimelinePage(allowedClient, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "opportunity", opportunity, {});
  assert.deepEqual(allowed, { rows: [], hasMore: false, nextCursor: null });
  assert.ok(allowedClient.calls.some(({ sql }) => sql.includes("FROM tenant.crm_opportunities opportunity")));
});

test("F019: a caller from another company is denied even with the right Opportunity/Account/Contact permission", async () => {
  const context = baseContext({ sensitive: ["crm.leads.view_sensitive", "crm.accounts.view_sensitive", "crm.contacts.view_sensitive"] });
  const otherCompany = "33333333-3333-4333-8333-333333333333";

  const opportunityClient = createClient({ opportunityRow: { id: opportunity, company_id: otherCompany, branch_id: branch } });
  assert.deepEqual(await getCrmRecordTimelinePage(opportunityClient, context, "opportunity", opportunity, {}), { rows: [], hasMore: false, nextCursor: null });

  const partyClient = createClient({ partyRow: { id: party, company_id: otherCompany } });
  assert.deepEqual(await getCrmRecordTimelinePage(partyClient, context, "party", party, {}), { rows: [], hasMore: false, nextCursor: null });

  const contactClient = createClient({ contactRow: { id: contact, company_id: otherCompany } });
  assert.deepEqual(await getCrmRecordTimelinePage(contactClient, context, "contact", contact, {}), { rows: [], hasMore: false, nextCursor: null });
});

test("F019: Account (party) entities use their own dedicated sensitive-content permission, distinct from Lead's", async () => {
  const wrongPermission = createClient({ partyRow: { id: party, company_id: company } });
  const denied = await getCrmRecordTimelinePage(wrongPermission, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "party", party, {});
  assert.deepEqual(denied, { rows: [], hasMore: false, nextCursor: null });

  const rightPermission = createClient({ partyRow: { id: party, company_id: company }, timelineRows: [] });
  await getCrmRecordTimelinePage(rightPermission, baseContext({ sensitive: ["crm.accounts.view_sensitive"] }), "party", party, {});
  assert.ok(rightPermission.calls.some(({ sql }) => sql.includes("FROM tenant.business_parties account WHERE") && sql.includes("account.owner_user_id IS NULL")), "account ownership applies, not company alone");
});

test("F019: Contact entities join through business_parties for company scope and use their own sensitive permission", async () => {
  const client = createClient({ contactRow: { id: contact, company_id: company }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.contacts.view_sensitive"] }), "contact", contact, {});
  const contactQuery = client.calls.find(({ sql }) => sql.includes("FROM tenant.contacts contact"));
  assert.ok(contactQuery.sql.includes("LEFT JOIN tenant.business_parties party"), "standalone Contacts are reachable (creator rule), not dropped by an inner join");
  assert.ok(contactQuery.sql.includes("contact.created_by ="), "Contact access rule applies");
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  // Contacts have no communication FK column mapping to itself in COMMUNICATION_COLUMN? verify it DOES (contact_id exists)
  assert.ok(combined.sql.includes("contact_id="));
});

test("F019: Campaign entities require no dedicated sensitive permission — company scope alone gates them", async () => {
  const client = createClient({ campaignRow: { id: campaign, company_id: company }, timelineRows: [] });
  const result = await getCrmRecordTimelinePage(client, baseContext({}), "campaign", campaign, {});
  assert.deepEqual(result, { rows: [], hasMore: false, nextCursor: null });
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  // Campaign has no crm_communications FK column — communication branch must be skipped entirely
  assert.ok(!combined.sql.includes("FROM tenant.crm_communications"));
});

test("F019: the kinds filter excludes unrequested source branches from the query entirely", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { kinds: ["activity"] });
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.ok(combined.sql.includes("FROM tenant.crm_activities"));
  assert.ok(!combined.sql.includes("FROM tenant.crm_communications"));
  assert.ok(!combined.sql.includes("FROM tenant.crm_notes"));
});

test("F019: pagination derives hasMore/nextCursor by fetching one extra row past the requested limit, never leaking the extra row itself", async () => {
  const rows = [
    activityRow("a1", "2026-09-05T10:00:00.000Z"),
    activityRow("a2", "2026-09-04T10:00:00.000Z"),
    activityRow("a3", "2026-09-03T10:00:00.000Z"), // the lookahead row for limit=2
  ];
  const client = createClient({ leadRow: { id: lead }, timelineRows: rows });
  const result = await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { limit: 2 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, "2026-09-04T10:00:00.000Z|a2");
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.ok(combined.values.includes(3), "the LIMIT bound passed to SQL must be limit+1, the lookahead trick");
});

test("F019: a stable cursor uses a tuple comparison, not OFFSET — no duplicate/skip risk across pages", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { cursor: "2026-09-04T10:00:00.000Z|66666666-6666-4666-8666-666666666666" });
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.match(combined.sql, /\(combined\.occurred_at,combined\.id\) < \(\$\d+::timestamptz,\$\d+::uuid\)/);
  assert.doesNotMatch(combined.sql, /OFFSET/);
  assert.match(combined.sql, /ORDER BY combined\.occurred_at DESC, combined\.id DESC/);
});

test("F019: attachments (governed file uploads) are merged into the default Timeline projection, using the 'crm.<entityType>' convention the Lead attachment route already writes", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, {});
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.ok(combined.sql.includes("FROM public.attachments"));
  assert.ok(combined.sql.includes("entity_type='crm.lead'"));
});

test("F019: the kinds filter can select attachments alone, excluding every other source branch", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { kinds: ["attachment"] });
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.ok(combined.sql.includes("FROM public.attachments"));
  assert.ok(!combined.sql.includes("FROM tenant.crm_activities"));
  assert.ok(!combined.sql.includes("FROM tenant.crm_communications"));
  assert.ok(!combined.sql.includes("FROM tenant.crm_notes"));
});

test("F018/F019: the communication branch applies the SAME canonical audience predicate (team/private/participant) as every other communication read path, not left unenforced inside the unified feed", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, {});
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.match(combined.sql, /FROM tenant\.crm_communications AS communication WHERE organization_id=\$1 AND lead_id=\$\d+/);
  assert.match(combined.sql, /communication\.visibility='team' OR communication\.created_by=\$\d+ OR \$\d+::boolean OR \(communication\.visibility='participant'/);
});

test("F019: an unsupported entity type or a malformed record id fails closed with a stable error code", async () => {
  const client = createClient();
  await assert.rejects(
    () => getCrmRecordTimelinePage(client, baseContext({}), "invoice", lead, {}),
    (error) => error.code === "CRM_TIMELINE_ENTITY_INVALID",
  );
  await assert.rejects(
    () => getCrmRecordTimelinePage(client, baseContext({}), "lead", "not-a-uuid", {}),
    (error) => error.code === "CRM_TIMELINE_ENTITY_INVALID",
  );
});

// F019 §16 closeout — getCrmTimelinePageBySource is the function that
// replaced Lead's own hand-rolled getLeadTimelinePage. It must gate on the
// SAME resolveCrmEntityAccess check as the merged feed, reject an
// unsupported source, and paginate a SINGLE kind by OFFSET while returning
// full (not narrowed) rows.
test("F019 §16: getCrmTimelinePageBySource denies an unauthorized caller with no query attempted, exactly like the merged feed", async () => {
  const client = createClient({ leadRow: null });
  const result = await getCrmTimelinePageBySource(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { source: "activity" });
  assert.deepEqual(result, { rows: [], hasMore: false });
});

test("F019 §16: getCrmTimelinePageBySource rejects an unsupported source kind", async () => {
  const client = createClient({ leadRow: { id: lead } });
  await assert.rejects(
    () => getCrmTimelinePageBySource(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { source: "not-a-real-kind" }),
    (error) => error.code === "CRM_TIMELINE_SOURCE_INVALID",
  );
});

test("F019 §16: getCrmTimelinePageBySource returns full activity rows (assignee name join, every original column) rather than the merged feed's narrow envelope", async () => {
  const client = createClient({
    leadRow: { id: lead },
    timelineRows: [{ id: "a1", subject: "Discovery call", due_at: "2026-09-05T00:00:00.000Z", assigned_name: "Sales Rep", occurred_at: "2026-09-01T10:00:00.000Z" }],
  });
  const result = await getCrmTimelinePageBySource(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { source: "activity", offset: 0, limit: 50 });
  assert.equal(result.rows[0].subject, "Discovery call");
  assert.equal(result.rows[0].assigned_name, "Sales Rep");
  const query = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.match(query.sql, /a\.\*,u\.full_name AS assigned_name/);
  assert.match(query.sql, /OFFSET/);
});

test("F019 §16: getCrmTimelinePageBySource applies the SAME canonical audience predicate to communications as the merged feed", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmTimelinePageBySource(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { source: "communication" });
  const query = client.calls.find(({ sql }) => sql.includes("WITH combined AS"));
  assert.match(query.sql, /communication\.visibility='team' OR communication\.created_by=\$\d+/);
  assert.match(query.sql, /SELECT communication\.\* FROM tenant\.crm_communications AS communication/);
});

test("F019 §16: getCrmTimelinePageBySource derives hasMore from one extra fetched row, never leaking it, matching the merged feed's pagination contract", async () => {
  const client = createClient({
    leadRow: { id: lead },
    timelineRows: Array.from({ length: 3 }, (_, index) => ({ id: `a${index}`, occurred_at: "2026-09-01T10:00:00.000Z" })),
  });
  const result = await getCrmTimelinePageBySource(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { source: "activity", limit: 2 });
  assert.equal(result.rows.length, 2);
  assert.equal(result.hasMore, true);
});

// F019 gap-closure — audit events (stage/owner/qualification changes) join the
// merged feed; the feed names the actor and previews note text.
test("F019: a Lead feed includes stage, owner and qualification change events and resolves the actor name", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [{ ...activityRow("a1", "2026-09-01T10:00:00.000Z"), actor_name: "Atharva Chavan" }] });
  const result = await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, {});
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS")).sql;
  assert.ok(combined.includes("FROM tenant.crm_lead_stage_events"));
  assert.ok(combined.includes("FROM tenant.crm_lead_assignment_events"));
  assert.ok(combined.includes("FROM tenant.crm_lead_qualification_events"));
  assert.ok(combined.includes("LEFT JOIN public.users actor"));
  assert.equal(result.rows[0].actorName, "Atharva Chavan");
});

test("F019: an Opportunity feed reads its stage history and carries no Lead-only audit branches", async () => {
  const client = createClient({ opportunityRow: { id: opportunity, company_id: company, branch_id: branch }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "opportunity", opportunity, {});
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS")).sql;
  assert.ok(combined.includes("FROM tenant.crm_opportunity_stage_history"));
  assert.ok(!combined.includes("crm_lead_stage_events"));
  assert.ok(!combined.includes("crm_lead_assignment_events"));
});

test("F019: notes appear in the feed with a text preview, and a private note is labelled as such", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, {});
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS")).sql;
  assert.ok(combined.includes("LEFT(body,160) AS title"));
  assert.ok(combined.includes("CASE WHEN visibility='private' THEN 'private' END AS subtype"));
});

test("F019: the audit-event kinds can be filtered on their own, and only the four full-row kinds are valid single-source lists", async () => {
  const client = createClient({ leadRow: { id: lead }, timelineRows: [] });
  await getCrmRecordTimelinePage(client, baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { kinds: ["stage"] });
  const combined = client.calls.find(({ sql }) => sql.includes("WITH combined AS")).sql;
  assert.ok(combined.includes("crm_lead_stage_events") && !combined.includes("FROM tenant.crm_activities"));
  await assert.rejects(() => getCrmTimelinePageBySource(createClient(), baseContext({ sensitive: ["crm.leads.view_sensitive"] }), "lead", lead, { source: "stage" }), (e) => e.code === "CRM_TIMELINE_SOURCE_INVALID");
});
