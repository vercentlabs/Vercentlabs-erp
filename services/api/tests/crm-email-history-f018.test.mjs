import assert from "node:assert/strict";
import test from "node:test";

import { getCrmEmailHistory, getCrmEmailThread } from "../src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const lead = "44444444-4444-4444-8444-444444444444";
const party = "55555555-5555-4555-8555-555555555555";
const owner = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: ["organization_owner"], permissions: [] };
const limited = { ...owner, roleSlugs: [], permissions: [] };

function client(handler) {
  const calls = [];
  return { calls, query: async (sql, values) => { calls.push(sql); return handler(sql, values); } };
}

test("getCrmEmailHistory rejects an unsupported record type", async () => {
  await assert.rejects(() => getCrmEmailHistory(client(() => ({ rows: [] })), owner, "campaign", lead), (e) => e.code === "CRM_EMAIL_HISTORY_ENTITY_INVALID");
});

test("getCrmEmailHistory returns an empty history, without reading communications, when the caller cannot access the parent Account", async () => {
  const c = client(() => ({ rows: [] }));
  const rows = await getCrmEmailHistory(c, limited, "party", party);
  assert.deepEqual(rows, []);
  assert.ok(!c.calls.some((sql) => sql.includes("crm_communications")));
});

test("getCrmEmailHistory gates a non-lead parent through the shared entity-access check before reading communications", async () => {
  const c = client((sql) => (sql.includes("business_parties") ? { rows: [] } : { rows: [{ id: "should-not-be-read" }] }));
  const rows = await getCrmEmailHistory(c, owner, "party", party);
  assert.deepEqual(rows, []);
  assert.ok(c.calls.some((sql) => sql.includes("business_parties")));
  assert.ok(!c.calls.some((sql) => sql.includes("crm_communications")));
});

test("getCrmEmailHistory camelizes email, thread and engagement fields for the lead 360", async () => {
  const c = client((sql) => {
    if (sql.includes("crm_leads")) return { rows: [{ id: lead }] };
    return {
      rows: [{ id: "c1", channel: "email", direction: "inbound", subject: "Pricing", from_address: "a@x.example", occurred_at: "2026-09-01T10:00:00Z", email_status: "received", thread_id: "t1", assigned_user_id: user, first_response_due_at: null, engagement_events: [{ type: "open", occurredAt: "2026-09-01T11:00:00Z", url: null }], created_by: user }],
    };
  });
  const rows = await getCrmEmailHistory(c, owner, "lead", lead);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromAddress, "a@x.example");
  assert.equal(rows[0].threadId, "t1");
  assert.equal(rows[0].emailStatus, "received");
  assert.equal(rows[0].contentVisibility, "full");
  assert.equal(rows[0].engagementEvents[0].type, "open");
});

test("getCrmEmailThread camelizes the thread and its messages", async () => {
  const c = client((sql) => {
    if (sql.includes("crm_email_threads")) return { rows: [{ id: "t1", inbox_id: null, subject: "Pricing", last_message_at: "2026-09-01T10:00:00Z" }] };
    if (sql.includes("crm_email_messages")) return { rows: [{ id: "m1", thread_id: "t1", communication_id: null, communication_id_resolved: null, direction: "inbound", from_address: "a@x.example", body_text: "Hi", created_at: "2026-09-01T10:00:00Z" }] };
    return { rows: [] };
  });
  const result = await getCrmEmailThread(c, owner, "66666666-6666-4666-8666-666666666666");
  assert.equal(result.thread.lastMessageAt, "2026-09-01T10:00:00Z");
  assert.equal(result.messages[0].bodyText, "Hi");
  assert.equal(result.messages[0].fromAddress, "a@x.example");
});

test("an outbound reply stamps the thread's first response so an answered conversation stops counting as overdue", async () => {
  const { ingestMailboxDelta } = await import("../src/modules/crm/seller-activity-and-follow-up-workspace/communications.js");
  const threadSql = [];
  const c = {
    query: async (sql) => {
      if (sql.includes("crm_sync_accounts") && sql.startsWith("SELECT")) return { rows: [{ id: "77777777-7777-4777-8777-777777777777", provider: "other", company_id: null, sync_cursor: null }] };
      if (sql.includes("INTO tenant.crm_email_threads")) { threadSql.push(sql); return { rows: [{ id: "t1" }] }; }
      if (sql.includes("INTO tenant.crm_communications")) return { rows: [{ id: "c1" }] };
      if (sql.includes("INTO tenant.crm_email_messages")) return { rows: [{ id: "m1" }] };
      return { rows: [] };
    },
  };
  await ingestMailboxDelta(c, owner, "77777777-7777-4777-8777-777777777777", { provider: "other", messages: [{ providerMessageId: "p1", externalThreadId: "th1", direction: "outbound", fromAddress: "a@x.example", toAddresses: ["b@x.example"], subject: "RE: hi" }] });
  assert.ok(threadSql[0].includes("first_responded_at=CASE WHEN $14='outbound' AND tenant.crm_email_threads.first_response_due_at IS NOT NULL"));
});

test("thread messages are ordered by when each message actually happened, not by sent-before-received column order", async () => {
  let messageSql = "";
  const c = {
    query: async (sql) => {
      if (sql.includes("FROM tenant.crm_email_threads")) return { rows: [{ id: "t1", inbox_id: null }] };
      if (sql.includes("FROM tenant.crm_email_messages")) { messageSql = sql; return { rows: [] }; }
      return { rows: [] };
    },
  };
  await getCrmEmailThread(c, owner, "66666666-6666-4666-8666-666666666666");
  assert.ok(messageSql.includes("ORDER BY COALESCE(message.sent_at, message.received_at, message.created_at) ASC"));
  assert.ok(!messageSql.includes("sent_at ASC NULLS LAST"));
});
