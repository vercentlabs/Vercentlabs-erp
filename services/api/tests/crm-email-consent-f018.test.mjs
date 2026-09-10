import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { assertEmailConsent, queueOutboundEmail, getCommunicationTimeline, listThreadMessages, updateSharedInboxThreadStatus } from "../src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";
import { resources, recordScope } from "../src/modules/crm/index.js";

// CRM vNext Prompt 6 (F018 — Email): a research pass confirmed
// queueOutboundEmail/outboundSendDecision checked only crm_email_suppressions
// (a narrower, provider-bounce/complaint/manual-unsubscribe concept) before
// every send — Prompt-3's real consent ledger (crm_consent_events) and the
// Lead do_not_contact flag (already enforced for outbound Calls) were never
// consulted. This closes that gap without introducing a broader opt-in-
// required redesign — see communications.js's own comment on
// assertEmailConsent for why "no consent recorded" must NOT block (default
// consent_email=false on virtually every existing Lead would break ordinary
// business email).

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const lead = "33333333-3333-4333-8333-333333333333";
const contact = "44444444-4444-4444-8444-444444444444";
const context = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: [] };

function mockClient({ leadDoNotContact = false, latestConsentAction = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads WHERE")) return { rows: [{ do_not_contact: leadDoNotContact }] };
      if (sql.includes("FROM tenant.crm_consent_events")) return { rows: latestConsentAction ? [{ action: latestConsentAction }] : [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F018: a Lead marked do-not-contact blocks outbound email, mirroring the existing Call precedent", async () => {
  const client = mockClient({ leadDoNotContact: true });
  const decision = await assertEmailConsent(client, context, { leadId: lead, contactId: null, partyId: null });
  assert.deepEqual(decision, { allowed: false, reason: "do_not_contact" });
  assert.ok(!client.calls.some(({ sql }) => sql.includes("FROM tenant.crm_consent_events")), "the do-not-contact check must short-circuit before the consent-ledger lookup");
});

test("F018: an explicit consent withdrawal in crm_consent_events blocks outbound email", async () => {
  const client = mockClient({ latestConsentAction: "withdrawn" });
  const decision = await assertEmailConsent(client, context, { leadId: null, contactId: contact, partyId: null });
  assert.deepEqual(decision, { allowed: false, reason: "consent_withdrawn" });
});

test("F018: an explicit consent suppression in crm_consent_events blocks outbound email", async () => {
  const client = mockClient({ latestConsentAction: "suppressed" });
  const decision = await assertEmailConsent(client, context, { leadId: null, contactId: contact, partyId: null });
  assert.deepEqual(decision, { allowed: false, reason: "consent_withdrawn" });
});

test("F018: a granted or resubscribed consent event, or no consent event at all, allows the send — this is not an opt-in-required gate", async () => {
  const granted = await assertEmailConsent(mockClient({ latestConsentAction: "granted" }), context, { leadId: null, contactId: contact, partyId: null });
  assert.deepEqual(granted, { allowed: true, reason: null });
  const resubscribed = await assertEmailConsent(mockClient({ latestConsentAction: "resubscribed" }), context, { leadId: null, contactId: contact, partyId: null });
  assert.deepEqual(resubscribed, { allowed: true, reason: null });
  const noEvent = await assertEmailConsent(mockClient({ latestConsentAction: null }), context, { leadId: null, contactId: contact, partyId: null });
  assert.deepEqual(noEvent, { allowed: true, reason: null });
});

test("F018: an email with no lead/contact/party linkage skips the consent lookup entirely and is allowed", async () => {
  const client = mockClient();
  const decision = await assertEmailConsent(client, context, { leadId: null, contactId: null, partyId: null });
  assert.deepEqual(decision, { allowed: true, reason: null });
  assert.equal(client.calls.length, 0);
});

test("F018: queueOutboundEmail rejects a do-not-contact Lead before any thread/communication/message row is written", async () => {
  const calls = [];
  const client = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads WHERE")) return { rows: [{ do_not_contact: true }] };
      throw new Error(`Unexpected query — write attempted before the consent gate: ${sql}`);
    },
  };
  await assert.rejects(
    () => queueOutboundEmail(client, context, { leadId: lead, toAddresses: ["customer@example.com"], subject: "Hello", bodyText: "Hi" }),
    (error) => error.code === "CRM_EMAIL_DO_NOT_CONTACT",
  );
  assert.ok(!calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_email_threads")));
  assert.ok(!calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_communications")));
});

test("F018: recordScope adds the canonical team/private/participant audience clause for communications, on top of the existing parent-scope gate — a caller without the org-wide view-all override cannot see another sender's private communication even with full record access", () => {
  const sensitiveContext = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive"] };
  const values = [org];
  const clause = recordScope(resources.communications, sensitiveContext, values, "record");
  assert.match(clause, /record\.visibility='team' OR record\.created_by=\$\d+/, "must gate on the canonical audience predicate for a caller without the view-all override");
  assert.match(clause, /record\.visibility='participant' AND EXISTS/, "must also support the participant tier, not just team/private");
  const viewAllValueIndex = clause.match(/record\.created_by=\$(\d+) OR \$(\d+)/)?.[2];
  assert.equal(values[Number(viewAllValueIndex) - 1], false);
});

test("F018: recordScope's audience predicate evaluates unconditionally true (via $viewAll) for a caller holding the organization-wide view-all override, rather than omitting the clause", () => {
  const managerContext = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive", "crm.records.view_all"] };
  const values = [org];
  const clause = recordScope(resources.communications, managerContext, values, "record");
  const viewAllValueIndex = clause.match(/record\.created_by=\$(\d+) OR \$(\d+)/)?.[2];
  assert.equal(values[Number(viewAllValueIndex) - 1], true, "an organization-wide view-all override's $viewAll parameter must be true");
});

test("F018: queueOutboundEmail persists the caller's visibility choice (team/private/participant), defaulting to 'team' (today's real-world behavior) when not specified", () => {
  const source = fs.readFileSync(new URL("../src/modules/crm/seller-activity-and-follow-up-workspace/communications.js", import.meta.url), "utf8");
  assert.match(source, /\["private", "participant"\]\.includes\(input\.visibility\) \? input\.visibility : "team"/);
});

test("F018 closeout: getCommunicationTimeline (the Lead/Opportunity Communications-tab query) applies the same canonical audience predicate recordScope already enforces for the generic resource route — this dedicated query previously had none at all", async () => {
  const calls = [];
  const client = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const viewAllContext = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive"] };
  await getCommunicationTimeline(client, viewAllContext, { opportunityId: "55555555-5555-4555-8555-555555555555" });
  const select = calls.find(({ sql }) => sql.includes("FROM tenant.crm_communications communication"));
  assert.match(select.sql, /communication\.visibility='team' OR communication\.created_by=\$\d+/);
  const viewAllValueIndex = select.sql.match(/communication\.created_by=\$(\d+) OR \$(\d+)/)?.[2];
  assert.equal(select.values[Number(viewAllValueIndex) - 1], false, "a non-view-all caller's $viewAll parameter must be false");
});

test("F018 closeout: getCommunicationTimeline's audience predicate always evaluates true for a caller holding the organization-wide view-all override (via the $viewAll parameter, not a conditionally-omitted clause)", async () => {
  const calls = [];
  const client = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const managerContext = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive", "crm.records.view_all"] };
  await getCommunicationTimeline(client, managerContext, { opportunityId: "55555555-5555-4555-8555-555555555555" });
  const select = calls.find(({ sql }) => sql.includes("FROM tenant.crm_communications communication"));
  const viewAllValueIndex = select.sql.match(/communication\.created_by=\$(\d+) OR \$(\d+)/)?.[2];
  assert.equal(select.values[Number(viewAllValueIndex) - 1], true, "an organization_owner-equivalent view-all caller's $viewAll parameter must be true, satisfying the audience OR unconditionally");
});

test("F018: queueOutboundEmail rejects a withdrawn-consent Contact before any thread/communication/message row is written", async () => {
  const calls = [];
  const client = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_consent_events")) return { rows: [{ action: "withdrawn" }] };
      throw new Error(`Unexpected query — write attempted before the consent gate: ${sql}`);
    },
  };
  await assert.rejects(
    () => queueOutboundEmail(client, context, { contactId: contact, toAddresses: ["customer@example.com"], subject: "Hello", bodyText: "Hi" }),
    (error) => error.code === "CRM_EMAIL_CONSENT_WITHDRAWN",
  );
  assert.ok(!calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_email_threads")));
});

// --- F018 §33 shared-inbox reachability: listThreadMessages / updateSharedInboxThreadStatus ---

const thread = "77777777-7777-4777-8777-777777777777";

const inbox = "88888888-8888-4888-8888-888888888888";

test("F018: listThreadMessages 404s a nonexistent thread", async () => {
  const client = { async query(sql) {
    if (sql.includes("FROM tenant.crm_email_threads WHERE")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => listThreadMessages(client, context, thread), (error) => error.code === "CRM_INBOX_THREAD_NOT_FOUND");
});

test("F018 §9: listThreadMessages 403s a caller who is not a member of the thread's shared inbox", async () => {
  const client = { async query(sql) {
    if (sql.includes("FROM tenant.crm_email_threads WHERE")) return { rows: [{ id: thread, inbox_id: inbox }] };
    if (sql.includes("FROM tenant.crm_shared_inbox_members WHERE")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => listThreadMessages(client, context, thread), (error) => error.code === "CRM_INBOX_SCOPE_FORBIDDEN");
});

test("F018: listThreadMessages applies the same canonical audience predicate (team/private/participant) as every other communication read path", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_email_threads WHERE")) return { rows: [{ id: thread, inbox_id: inbox }] };
      if (sql.includes("FROM tenant.crm_shared_inbox_members WHERE")) return { rows: [{ user_id: user }] };
      if (sql.includes("FROM tenant.crm_email_messages message")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_communication_participants") && sql.includes("communication_id = ANY")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await listThreadMessages(client, context, thread);
  const messagesQuery = calls.find(({ sql }) => sql.includes("FROM tenant.crm_email_messages message"));
  assert.match(messagesQuery.sql, /communication\.visibility='team' OR communication\.created_by=\$\d+/);
});

test("F018: updateSharedInboxThreadStatus rejects an unsupported status value", async () => {
  const client = { async query() { throw new Error("must not query for an invalid status"); } };
  await assert.rejects(() => updateSharedInboxThreadStatus(client, context, thread, "resolved"), (error) => error.code === "CRM_INBOX_THREAD_STATUS_INVALID");
});

test("F018: updateSharedInboxThreadStatus 404s a nonexistent thread", async () => {
  const client = { async query(sql) {
    if (sql.includes("SELECT inbox_id FROM tenant.crm_email_threads WHERE")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => updateSharedInboxThreadStatus(client, context, thread, "closed"), (error) => error.code === "CRM_INBOX_THREAD_NOT_FOUND");
});

test("F018 §9: updateSharedInboxThreadStatus 403s a caller who is not a member of the thread's shared inbox", async () => {
  const client = { async query(sql) {
    if (sql.includes("SELECT inbox_id FROM tenant.crm_email_threads WHERE")) return { rows: [{ inbox_id: inbox }] };
    if (sql.includes("FROM tenant.crm_shared_inbox_members WHERE")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => updateSharedInboxThreadStatus(client, context, thread, "closed"), (error) => error.code === "CRM_INBOX_SCOPE_FORBIDDEN");
});

test("F018: updateSharedInboxThreadStatus accepts every real status in the migration 031 enum", async () => {
  const client = { async query(sql, values) {
    if (sql.includes("SELECT inbox_id FROM tenant.crm_email_threads WHERE")) return { rows: [{ inbox_id: inbox }] };
    if (sql.includes("FROM tenant.crm_shared_inbox_members WHERE")) return { rows: [{ user_id: user }] };
    if (sql.includes("UPDATE tenant.crm_email_threads SET status=$3")) return { rows: [{ id: thread, status: values[2] }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  for (const status of ["open", "pending", "closed", "spam", "archived"]) {
    const result = await updateSharedInboxThreadStatus(client, context, thread, status);
    assert.equal(result.status, status);
  }
});

// F018 §8 closeout — "a thread must not become an authorization bypass":
// each message's visibility/content is derived from its OWN linked
// communication, not the thread as a whole. This proves the mixed case —
// one team-visible message this restricted caller cannot read the body of,
// and one message this same caller IS a participant on and can read in
// full — are projected independently within the SAME listThreadMessages
// response, not all-or-nothing at the thread level.
test("F018 §8: a mixed thread (one team-visible message this caller is not privy to, one message this caller participates in) projects each message independently — not all-or-nothing", async () => {
  const otherUser = "99999999-9999-4999-8999-999999999999";
  const teamCommunicationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const participantCommunicationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM tenant.crm_email_threads WHERE")) return { rows: [{ id: thread, inbox_id: inbox }] };
      if (sql.includes("FROM tenant.crm_shared_inbox_members WHERE")) return { rows: [{ user_id: user }] };
      if (sql.includes("FROM tenant.crm_email_messages message")) {
        return {
          rows: [
            {
              id: "msg-team", thread_id: thread, communication_id: teamCommunicationId,
              communication_id_resolved: teamCommunicationId, communication_visibility: "team", communication_created_by: otherUser,
              direction: "inbound", status: "received", subject: "Team-visible but not mine to read", body_text: "sensitive body",
            },
            {
              id: "msg-participant", thread_id: thread, communication_id: participantCommunicationId,
              communication_id_resolved: participantCommunicationId, communication_visibility: "participant", communication_created_by: otherUser,
              direction: "inbound", status: "received", subject: "A conversation I'm part of", body_text: "readable body",
            },
          ],
        };
      }
      if (sql.includes("FROM tenant.crm_communication_participants") && sql.includes("communication_id = ANY"))
        return { rows: [{ communication_id: participantCommunicationId }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await listThreadMessages(client, context, thread);
  const teamMessage = result.messages.find((message) => message.id === "msg-team");
  const participantMessage = result.messages.find((message) => message.id === "msg-participant");
  assert.equal(teamMessage.redacted, true, "the team-visible message this restricted, non-participant caller did not send must be redacted");
  assert.equal(teamMessage.subject, undefined);
  assert.equal(participantMessage.redacted, undefined, "the message this caller participates in must NOT be redacted");
  assert.equal(participantMessage.subject, "A conversation I'm part of");
});
