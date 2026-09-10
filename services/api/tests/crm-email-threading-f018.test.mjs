import assert from "node:assert/strict";
import test from "node:test";

import { ingestMailboxDelta, queueOutboundEmail } from "../src/modules/crm/communications.js";

// F018 §14 closeout — the underlying thread/message upsert SQL
// (ON CONFLICT (organization_id,provider,external_thread_id) for threads,
// ON CONFLICT (organization_id,provider,provider_message_id) DO NOTHING
// for messages) was already real and correct, but had zero dedicated
// tests proving it — a re-audit found no existing coverage for inbound
// provider thread grouping, outbound-reply-reuses-thread, same-subject
// non-collision, or inbound replay idempotency. This file closes that gap
// without changing behavior: it pins the SQL/idempotency contract that was
// already there.

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const syncAccountId = "33333333-3333-4333-8333-333333333333";
const lead = "44444444-4444-4444-8444-444444444444";
const context = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: [] };

function gmailMessage({ id, threadId, subject, snippet = "Hello", labelIds = ["INBOX"] }) {
  return {
    id,
    threadId,
    labelIds,
    snippet,
    internalDate: String(Date.parse("2026-09-01T10:00:00.000Z")),
    payload: {
      headers: [
        { name: "From", value: "customer@example.com" },
        { name: "To", value: "sales@vercentlabs.example" },
        { name: "Subject", value: subject },
      ],
      body: { data: Buffer.from(snippet).toString("base64url") },
      mimeType: "text/plain",
    },
  };
}

// Simulates the real ON CONFLICT upsert semantics of
// crm_email_threads(organization_id,provider,external_thread_id) and
// crm_email_messages(organization_id,provider,provider_message_id) so the
// tests below observe the SAME grouping/idempotency behavior the live
// unique indexes enforce, without a live database.
function mockIngestClient() {
  const calls = [];
  const threadsByKey = new Map();
  const messagesByKey = new Set();
  let nextThreadSeq = 1;
  return {
    calls,
    threadsByKey,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_sync_accounts WHERE"))
        return { rows: [{ id: syncAccountId, provider: "gmail", company_id: null, sync_cursor: null }] };
      if (sql.includes("INSERT INTO tenant.crm_email_threads")) {
        const [, , , , provider, externalThreadId] = values;
        const key = `${provider}:${externalThreadId}`;
        if (!threadsByKey.has(key)) threadsByKey.set(key, { id: `thread-${nextThreadSeq++}` });
        return { rows: [threadsByKey.get(key)] };
      }
      if (sql.includes("INSERT INTO tenant.crm_communications"))
        return { rows: [{ id: `comm-${calls.length}` }] };
      if (sql.includes("FROM public.users WHERE lower(email)")) return { rows: [] };
      if (sql.includes("FROM tenant.contacts WHERE organization_id")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_communication_participants")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_email_messages")) {
        const provider = values[4];
        const providerMessageId = values[5];
        const key = `${provider}:${providerMessageId}`;
        if (messagesByKey.has(key)) return { rows: [] }; // ON CONFLICT DO NOTHING — no row returned
        messagesByKey.add(key);
        return { rows: [{ id: `msg-${key}` }] };
      }
      if (sql.includes("UPDATE tenant.crm_sync_accounts SET sync_cursor"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F018 §14: an inbound message creates a thread keyed by the provider's own thread id", async () => {
  const client = mockIngestClient();
  const result = await ingestMailboxDelta(client, context, syncAccountId, {
    provider: "gmail",
    messages: [gmailMessage({ id: "msg-1", threadId: "thread-abc", subject: "Pricing question" })],
  });
  assert.equal(result.inserted, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(client.threadsByKey.size, 1);
});

test("F018 §14: a reply carrying the SAME provider thread id groups into the SAME thread row, not a new one", async () => {
  const client = mockIngestClient();
  await ingestMailboxDelta(client, context, syncAccountId, {
    provider: "gmail",
    messages: [gmailMessage({ id: "msg-1", threadId: "thread-abc", subject: "Pricing question" })],
  });
  await ingestMailboxDelta(client, context, syncAccountId, {
    provider: "gmail",
    messages: [gmailMessage({ id: "msg-2", threadId: "thread-abc", subject: "Re: Pricing question", snippet: "Following up" })],
  });
  assert.equal(client.threadsByKey.size, 1, "both messages must resolve to the same thread row");
  const threadInserts = client.calls.filter(({ sql }) => sql.includes("INSERT INTO tenant.crm_email_threads"));
  assert.equal(threadInserts.length, 2, "the upsert is attempted twice (once per message) but resolves to one row");
});

test("F018 §14: two messages with the SAME SUBJECT but DIFFERENT provider thread ids do NOT collide into one thread", async () => {
  const client = mockIngestClient();
  await ingestMailboxDelta(client, context, syncAccountId, {
    provider: "gmail",
    messages: [gmailMessage({ id: "msg-1", threadId: "thread-one", subject: "Quarterly check-in" })],
  });
  await ingestMailboxDelta(client, context, syncAccountId, {
    provider: "gmail",
    messages: [gmailMessage({ id: "msg-2", threadId: "thread-two", subject: "Quarterly check-in" })],
  });
  assert.equal(client.threadsByKey.size, 2, "identical subjects on unrelated threads must never be merged by subject-string inference");
});

test("F018 §14: replaying the exact same inbound message a second time (e.g. a re-delivered webhook/sync event) does not create a duplicate message row", async () => {
  const client = mockIngestClient();
  const message = gmailMessage({ id: "msg-1", threadId: "thread-abc", subject: "Pricing question" });
  const first = await ingestMailboxDelta(client, context, syncAccountId, { provider: "gmail", messages: [message] });
  const replay = await ingestMailboxDelta(client, context, syncAccountId, { provider: "gmail", messages: [message] });
  assert.equal(first.inserted, 1);
  assert.equal(first.duplicates, 0);
  assert.equal(replay.inserted, 0, "a replayed message must be counted as a duplicate, not inserted again");
  assert.equal(replay.duplicates, 1);
});

test("F018 §14: an outbound reply that supplies the inbound thread's externalThreadId reuses that SAME thread row rather than starting a new one — this is what makes a shared-inbox reply land in the existing thread", async () => {
  const calls = [];
  const threadsByKey = new Map();
  let nextThreadSeq = 1;
  const client = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads WHERE")) return { rows: [{ do_not_contact: false }] };
      if (sql.includes("FROM tenant.crm_consent_events")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_email_suppressions")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_email_messages WHERE organization_id=$1 AND direction='outbound'")) return { rows: [{ total: 0 }] };
      if (sql.includes("INSERT INTO tenant.crm_email_threads")) {
        const provider = values[4];
        const externalThreadId = values[5];
        const key = `${provider}:${externalThreadId}`;
        if (!threadsByKey.has(key)) threadsByKey.set(key, { id: `thread-${nextThreadSeq++}` });
        return { rows: [threadsByKey.get(key)] };
      }
      if (sql.includes("INSERT INTO tenant.crm_communications")) return { rows: [{ id: "comm-1" }] };
      if (sql.includes("FROM public.users WHERE lower(email)")) return { rows: [] };
      if (sql.includes("FROM tenant.contacts WHERE organization_id")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_communication_participants")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_email_messages")) return { rows: [{ id: "msg-out-1" }] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  // Simulates: customer emailed in on Gmail thread "thread-abc" (created by
  // a prior ingestMailboxDelta call); the seller now replies from the
  // shared inbox, supplying that SAME externalThreadId.
  threadsByKey.set("gmail:thread-abc", { id: "thread-1" });
  const message = await queueOutboundEmail(client, context, {
    leadId: lead,
    provider: "gmail",
    externalThreadId: "thread-abc",
    toAddresses: ["customer@example.com"],
    fromAddress: "sales@vercentlabs.example",
    subject: "Re: Pricing question",
    bodyText: "Here's the pricing you asked about.",
    now: "2026-09-01T12:00:00.000Z",
    timezone: "UTC",
  });
  assert.equal(threadsByKey.size, 1, "the reply must reuse the existing thread, not create a second one");
  const threadInsert = calls.find(({ sql }) => sql.includes("INSERT INTO tenant.crm_email_threads"));
  assert.equal(threadInsert.values[5], "thread-abc");
  assert.ok(message);
});
