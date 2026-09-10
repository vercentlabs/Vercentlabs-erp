import assert from "node:assert/strict";
import test from "node:test";

import {
  communicationVisibilitySql,
  projectCrmCommunication,
  projectCrmCommunications,
  resolveCallerParticipantCommunicationIds,
  resolveCommunicationParticipants,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/communications/communication-projection.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const otherUser = "33333333-3333-4333-8333-333333333333";
const communicationId = "44444444-4444-4444-8444-444444444444";
const restrictedContext = { organizationId: org, userId: user, roleSlugs: [], permissions: [] };
const sensitiveContext = { organizationId: org, userId: user, roleSlugs: [], permissions: ["crm.leads.view_sensitive"] };

test("F018 §1: resolveCommunicationParticipants resolves an internal recipient to a real public.users id, and an unrecognized address to neither user nor contact (but still records the role+address)", async () => {
  const calls = [];
  const client = {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM public.users WHERE lower(email)")) return { rows: [{ id: otherUser, email: "internal@example.com" }] };
      if (sql.includes("FROM tenant.contacts WHERE organization_id")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.crm_communication_participants")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await resolveCommunicationParticipants(client, restrictedContext, communicationId, [
    { role: "sender", email: "internal@example.com" },
    { role: "recipient", email: "unknown-outsider@example.com" },
  ]);
  const inserts = calls.filter(({ sql }) => sql.includes("INSERT INTO tenant.crm_communication_participants"));
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].values[4], otherUser, "the internal address must resolve to a real user_id");
  assert.equal(inserts[1].values[4], null, "an unrecognized address must NOT be granted a user_id — never an application-access side effect");
  assert.equal(inserts[1].values[1], communicationId);
});

test("F018 §1: resolveCommunicationParticipants resolves an external CRM Contact's address to contact_id ONLY — never to a user_id, even if that Contact happens to share an email with a login", async () => {
  const contactId = "55555555-5555-4555-8555-555555555555";
  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM public.users WHERE lower(email)")) return { rows: [] };
      if (sql.includes("FROM tenant.contacts WHERE organization_id")) return { rows: [{ id: contactId, email: "buyer@customer.example" }] };
      if (sql.includes("INSERT INTO tenant.crm_communication_participants")) return { rows: [], rowCount: 1, __values: values };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  let captured;
  const spyClient = { async query(sql, values) { const result = await client.query(sql, values); if (sql.includes("INSERT INTO tenant.crm_communication_participants")) captured = values; return result; } };
  await resolveCommunicationParticipants(spyClient, restrictedContext, communicationId, [{ role: "recipient", email: "buyer@customer.example" }]);
  assert.equal(captured[4], null, "a Contact-matched address must never resolve to a user_id");
  assert.equal(captured[5], contactId, "a Contact-matched address resolves to contact_id (participant metadata only)");
});

test("F018 §4: communicationVisibilitySql's participant-tier EXISTS check is scoped by organization_id, communication_id AND the caller's own user_id — not a bare 'is anyone a participant' check", () => {
  const values = [];
  const sql = communicationVisibilitySql(restrictedContext, values, "communication");
  assert.match(sql, /participant\.organization_id=\$\d+ AND participant\.communication_id=communication\.id AND participant\.user_id=\$\d+/);
});

test("F018 §3: projectCrmCommunication separates audience (assumed already resolved by the caller) from content — a caller with the sensitive-content permission always sees full content regardless of participant status", () => {
  const row = { id: communicationId, channel: "email", direction: "inbound", status: "received", occurred_at: "2026-09-10T10:30:00.000Z", created_by: otherUser, subject: "Confidential", body: "Body text" };
  const result = projectCrmCommunication(row, sensitiveContext, { isParticipant: false });
  assert.equal(result.contentVisibility, "full");
  assert.equal(result.subject, "Confidential");
});

test("F018 §3: projectCrmCommunication redacts subject/body/from/to for a restricted, non-participant, non-sender caller — metadata (channel/direction/status/occurredAt) survives", () => {
  const row = { id: communicationId, channel: "email", direction: "inbound", status: "received", occurred_at: "2026-09-10T10:30:00.000Z", created_by: otherUser, subject: "Confidential pricing", body: "Discount structure...", from_address: "seller@example.com", to_addresses: ["buyer@example.com"] };
  const result = projectCrmCommunication(row, restrictedContext, { isParticipant: false });
  assert.equal(result.contentVisibility, "metadata");
  assert.equal(result.redacted, true);
  assert.equal(result.subject, undefined);
  assert.equal(result.body, undefined);
  assert.equal(result.from_address, undefined);
  assert.equal(result.to_addresses, undefined);
  assert.equal(result.channel, "email");
  assert.equal(result.direction, "inbound");
  assert.equal(result.status, "received");
  assert.equal(result.occurred_at, "2026-09-10T10:30:00.000Z");
});

test("F018 §3: projectCrmCommunication gives full content to a restricted caller who IS a participant on this specific communication (received it) — audience membership implies content access to your own correspondence", () => {
  const row = { id: communicationId, channel: "email", direction: "inbound", status: "received", occurred_at: "2026-09-10T10:30:00.000Z", created_by: otherUser, subject: "Confidential pricing", body: "Discount structure..." };
  const result = projectCrmCommunication(row, restrictedContext, { isParticipant: true });
  assert.equal(result.contentVisibility, "full");
  assert.equal(result.subject, "Confidential pricing");
});

test("F018 §3: projectCrmCommunication always gives the sender full content of their own communication, even without the sensitive-content permission or a resolved participant row", () => {
  const row = { id: communicationId, channel: "email", direction: "outbound", status: "sent", created_by: user, subject: "My own email", body: "My own body" };
  const result = projectCrmCommunication(row, restrictedContext, { isParticipant: false });
  assert.equal(result.contentVisibility, "full");
});

test("F018 §6: projectCrmCommunications short-circuits with zero queries for a caller who already holds the sensitive-content permission — full content for every row, no participant-membership lookup needed", async () => {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); throw new Error("must not query — sensitive-content callers skip the participant lookup entirely"); } };
  const rows = [{ id: communicationId, subject: "x", body: "y" }];
  const result = await projectCrmCommunications(client, sensitiveContext, rows);
  assert.equal(result[0].contentVisibility, "full");
  assert.equal(calls.length, 0);
});

test("F018 §6: projectCrmCommunications resolves participant membership in ONE batched query for a restricted caller across multiple rows, not one query per row", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [{ communication_id: "row-2" }] };
    },
  };
  const rows = [
    { id: "row-1", created_by: otherUser, subject: "a", body: "a-body" },
    { id: "row-2", created_by: otherUser, subject: "b", body: "b-body" },
  ];
  const result = await projectCrmCommunications(client, restrictedContext, rows);
  const participantQueries = calls.filter(({ sql }) => sql.includes("communication_id = ANY"));
  assert.equal(participantQueries.length, 1, "must resolve participant membership for the whole page in one query, not N+1");
  assert.equal(result[0].contentVisibility, "metadata", "row-1: not a participant, not sender, not sensitive-permitted");
  assert.equal(result[1].contentVisibility, "full", "row-2: resolved as a participant by the batched query");
});
