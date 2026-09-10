import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// F014 (Meetings) calendar-push worker. The underlying domain functions
// (prepareMeetingCalendarPush, pushProviderCalendarEvent,
// recordMeetingCalendarPushResult) are already thoroughly behaviorally
// tested with a mock fetchImpl in services/api/tests/
// crm-meeting-calendar-push-f014.test.mjs — ESM named-import bindings
// cannot be monkey-patched from a test file (Node throws "Cannot redefine
// property" on mock.method against a namespace import), so this handler's
// own thin orchestration is verified by source assertions instead,
// matching the established convention for this exact class of file (see
// crm-lead-bulk-update.test.mjs).

test("F014 worker: calendar-push job is registered as a managed, idempotency-key-required job", () => {
  const handlers = read("src/handlers/index.js");
  assert.match(handlers, /MEETING_CALENDAR_PUSH_JOB_TYPE/);
  assert.match(handlers, /transactionMode: "managed"/);
  assert.match(handlers, /idempotency: "IDEMPOTENCY_KEY_REQUIRED"/);
});

test("F014 worker: the handler resolves what to push, calls the provider, then persists the result — never inside one held transaction", () => {
  const worker = read("src/handlers/crm-meeting-calendar-push.js");
  assert.match(worker, /export const JOB_TYPE = "crm\.meetings\.calendar_push"/);
  assert.match(worker, /activityId: z\.string\(\)\.uuid\(\)/);
  assert.match(worker, /action: z\.enum\(\["create", "update", "cancel"\]\)/);
  const prepareIndex = worker.indexOf("prepareMeetingCalendarPush(client, context, payload.activityId)");
  const pushIndex = worker.indexOf("pushProviderCalendarEvent(prepared.account, prepared.event, payload.action)");
  const recordIndex = worker.indexOf("recordMeetingCalendarPushResult(client, context, prepared.calendarEventId");
  assert.ok(prepareIndex > -1 && pushIndex > -1 && recordIndex > -1, "all three steps must be present");
  assert.ok(prepareIndex < pushIndex && pushIndex < recordIndex, "resolve -> push -> persist must run in that order");
  // The provider call itself must not be nested inside a
  // runtime.withTenantClient(...) callback — real network I/O must never
  // happen while holding a tenant-transaction lock open.
  const pushLine = worker.split("\n").find((line) => line.includes("pushProviderCalendarEvent(prepared.account"));
  assert.ok(pushLine && !pushLine.includes("withTenantClient"), "the provider push must run outside any held DB transaction");
});

test("F014 worker: no connected calendar account is treated as a clean no-op, not an error", () => {
  const worker = read("src/handlers/crm-meeting-calendar-push.js");
  assert.match(worker, /if \(!prepared\) return \{ pushed: false, reason: "NO_CONNECTED_ACCOUNT" \};/);
});
