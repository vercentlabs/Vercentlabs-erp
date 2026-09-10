import assert from "node:assert/strict";
import test from "node:test";

import {
  pushProviderCalendarEvent,
  prepareMeetingCalendarPush,
  recordMeetingCalendarPushResult,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";

// CRM vNext Prompt 6 (F014 — Meetings). DEC-CRM-P1-F014 lists "calendar
// sync" as REQUIRED enterprise scope; a research pass confirmed the
// pre-existing implementation only ever PULLED external events in
// (fetchProviderCalendarDelta) — bookMeeting hardcoded
// provider='vercentlabs' on its own internal crm_calendar_events row,
// never pushing OUT to the host's real calendar. This is the outbound
// counterpart. Real Google Calendar / Microsoft Graph API calls, exercised
// here with a deterministic mock fetchImpl — never a paid external
// account — per the explicit "testable without external paid accounts"
// requirement.

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const activityId = "33333333-3333-4333-8333-333333333333";
const calendarEventId = "44444444-4444-4444-8444-444444444444";
const context = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: [] };

function fakeFetch(responses) {
  let call = 0;
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const response = responses[call] || responses[responses.length - 1];
      call += 1;
      return {
        ok: response.status < 400,
        status: response.status,
        json: async () => response.body,
        text: async () => JSON.stringify(response.body || {}),
      };
    },
  };
}

const gmailAccount = { provider: "gmail", credential_reference: "" };
const credentialOptions = { credential: { accessToken: "fake-token" } };

test("F014: pushProviderCalendarEvent creates a Gmail event via POST when no externalEventId exists yet", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { id: "gcal-event-1", etag: '"abc"', status: "confirmed" } }]);
  const result = await pushProviderCalendarEvent(
    gmailAccount,
    { title: "Discovery call", startsAt: "2026-09-20T10:00:00.000Z", endsAt: "2026-09-20T10:30:00.000Z", timezone: "UTC", attendees: [{ email: "guest@example.com", name: "Guest" }] },
    "create",
    { ...credentialOptions, fetchImpl },
  );
  assert.equal(result.externalEventId, "gcal-event-1");
  assert.equal(result.providerStatus, "confirmed");
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /calendars\/primary\/events$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.summary, "Discovery call");
  assert.deepEqual(body.attendees, [{ email: "guest@example.com", displayName: "Guest" }]);
});

test("F014: pushProviderCalendarEvent updates an existing Gmail event via PATCH when an externalEventId already exists", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { id: "gcal-event-1", etag: '"def"', status: "confirmed" } }]);
  await pushProviderCalendarEvent(
    gmailAccount,
    { externalEventId: "gcal-event-1", title: "Discovery call (rescheduled)", startsAt: "2026-09-21T10:00:00.000Z", endsAt: "2026-09-21T10:30:00.000Z", timezone: "UTC", attendees: [] },
    "update",
    { ...credentialOptions, fetchImpl },
  );
  assert.equal(calls[0].init.method, "PATCH");
  assert.match(calls[0].url, /calendars\/primary\/events\/gcal-event-1$/);
});

test("F014: pushProviderCalendarEvent deletes a Gmail event on cancel and clears the external linkage", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 204, body: {} }]);
  const result = await pushProviderCalendarEvent(
    gmailAccount,
    { externalEventId: "gcal-event-1" },
    "cancel",
    { ...credentialOptions, fetchImpl },
  );
  assert.equal(calls[0].init.method, "DELETE");
  assert.deepEqual(result, { externalEventId: null, etag: null, providerStatus: "cancelled" });
});

test("F014: pushProviderCalendarEvent cancelling a Meeting that was never actually pushed is a clean no-op, not a request", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 200, body: {} }]);
  const result = await pushProviderCalendarEvent(gmailAccount, { externalEventId: null }, "cancel", { ...credentialOptions, fetchImpl });
  assert.deepEqual(result, { externalEventId: null, etag: null, providerStatus: "cancelled" });
  assert.equal(calls.length, 0);
});

test("F014: pushProviderCalendarEvent creates a Microsoft 365 event via POST to /me/events", async () => {
  const { fetchImpl, calls } = fakeFetch([{ status: 201, body: { id: "graph-event-1", "@odata.etag": 'W/"xyz"' } }]);
  const result = await pushProviderCalendarEvent(
    { provider: "microsoft365", credential_reference: "" },
    { title: "Kickoff", startsAt: "2026-09-20T10:00:00.000Z", endsAt: "2026-09-20T10:30:00.000Z", attendees: [{ email: "guest@example.com" }] },
    "create",
    { ...credentialOptions, fetchImpl },
  );
  assert.equal(result.externalEventId, "graph-event-1");
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /graph\.microsoft\.com\/v1\.0\/me\/events$/);
});

test("F014: an unsupported provider is rejected rather than silently no-op'd", async () => {
  await assert.rejects(
    () => pushProviderCalendarEvent({ provider: "imap", credential_reference: "" }, { title: "x", startsAt: "2026-09-20T10:00:00.000Z", endsAt: "2026-09-20T10:30:00.000Z" }, "create", credentialOptions),
    (error) => error.code === "CRM_PROVIDER_UNSUPPORTED",
  );
});

function mockClient({ meetingRow, syncAccountRow, attendees = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_activities activity")) return { rows: meetingRow ? [meetingRow] : [] };
      if (sql.includes("FROM tenant.crm_sync_accounts")) return { rows: syncAccountRow ? [syncAccountRow] : [] };
      if (sql.includes("FROM tenant.crm_activity_attendees")) return { rows: attendees };
      if (sql.includes("UPDATE tenant.crm_calendar_events")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F014: prepareMeetingCalendarPush returns null (a clean no-op) when the Meeting's host has no connected outbound-capable calendar account", async () => {
  const client = mockClient({ meetingRow: { id: activityId, assigned_to: user, subject: "Call", start_at: "2026-09-20T10:00:00.000Z", end_at: "2026-09-20T10:30:00.000Z", calendar_event_id: null }, syncAccountRow: null });
  const prepared = await prepareMeetingCalendarPush(client, context, activityId);
  assert.equal(prepared, null);
});

test("F014: prepareMeetingCalendarPush returns null when the Meeting has no assignee at all", async () => {
  const client = mockClient({ meetingRow: { id: activityId, assigned_to: null } });
  const prepared = await prepareMeetingCalendarPush(client, context, activityId);
  assert.equal(prepared, null);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("FROM tenant.crm_sync_accounts")), "must not even look up a sync account without an assignee");
});

test("F014: prepareMeetingCalendarPush resolves the connected account and shapes the event, including attendees", async () => {
  const client = mockClient({
    meetingRow: { id: activityId, assigned_to: user, subject: "Discovery call", description: null, start_at: "2026-09-20T10:00:00.000Z", due_at: "2026-09-20T10:00:00.000Z", end_at: "2026-09-20T10:30:00.000Z", location: null, meeting_url: "https://meet.example.com/abc", calendar_event_id: calendarEventId, calendar_provider: "vercentlabs", external_event_id: null },
    syncAccountRow: { id: "sync-1", provider: "gmail", credential_reference: "env:GMAIL_TOKEN" },
    attendees: [{ name: "Guest", email: "guest@example.com" }],
  });
  const prepared = await prepareMeetingCalendarPush(client, context, activityId);
  assert.equal(prepared.account.provider, "gmail");
  assert.equal(prepared.event.title, "Discovery call");
  assert.equal(prepared.event.onlineMeetingUrl, "https://meet.example.com/abc");
  assert.deepEqual(prepared.event.attendees, [{ name: "Guest", email: "guest@example.com" }]);
  assert.equal(prepared.calendarEventId, calendarEventId);
  // A pre-existing internal-only 'vercentlabs' provider must NOT be treated
  // as a real external event id to PATCH against — this is exactly the
  // fake-sync pattern being fixed; a first real push must POST (create).
  assert.equal(prepared.event.externalEventId, null);
});

test("F014: recordMeetingCalendarPushResult is a no-op when there is no internal calendar_events row to update", async () => {
  const client = mockClient();
  await recordMeetingCalendarPushResult(client, context, null, "gmail", { externalEventId: "x", etag: "y", providerStatus: "confirmed" });
  assert.equal(client.calls.length, 0);
});

test("F014: recordMeetingCalendarPushResult persists the real provider and external event id, replacing the internal placeholder", async () => {
  const client = mockClient();
  await recordMeetingCalendarPushResult(client, context, calendarEventId, "gmail", { externalEventId: "gcal-event-1", etag: '"abc"', providerStatus: "confirmed" });
  const update = client.calls.find(({ sql }) => sql.includes("UPDATE tenant.crm_calendar_events"));
  assert.ok(update);
  assert.deepEqual(update.values, [org, calendarEventId, "gmail", "gcal-event-1", '"abc"', "confirmed"]);
});
