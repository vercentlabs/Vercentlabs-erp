import assert from "node:assert/strict";
import test from "node:test";

import { dispatchFollowUpRemindersHandler } from "../src/handlers/crm-follow-up-reminder-dispatch.js";

const org = "11111111-1111-4111-8111-111111111111";
const followUp = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";

function fakeRuntime({ stuck = 0, claimed = [], activities = new Map(), escalated = 0 } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE tenant.crm_activity_reminders SET status='pending',updated_at=now()"))
        return { rows: Array.from({ length: stuck }, (_v, i) => ({ id: `stuck-${i}` })) };
      if (sql.includes("UPDATE tenant.crm_activity_reminders reminder"))
        return { rows: claimed };
      if (sql.includes("SELECT activity.id,activity.subject,activity.entity_type")) {
        const ids = values[1];
        return { rows: ids.map((id) => activities.get(id)).filter(Boolean) };
      }
      if (sql.includes("SET status=$3,sent_at=CASE"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO notifications("))
        return { rows: [{ id: "notif-1" }] };
      if (sql.includes("SELECT activity.* FROM tenant.crm_activities activity") && sql.includes("follow_up_escalate_after_minutes IS NOT NULL"))
        return { rows: Array.from({ length: escalated }, (_v, i) => ({ id: `escalate-${i}`, organization_id: org, activity_type: "follow_up", status: "planned", assigned_to: user, subject: "Overdue", follow_up_escalate_after_minutes: 60 })) };
      if (sql.includes("FROM tenant.crm_sales_team_members member"))
        return { rows: [] };
      if (sql.includes("UPDATE tenant.crm_activities SET follow_up_escalated_at=now()"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_follow_up_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return {
    calls,
    runtime: {
      pool: {},
      organizationId: org,
      async withTenantClient(_pool, _orgId, callback) {
        return callback(client);
      },
    },
  };
}

test("F016 worker: an idle tick with nothing due is a clean no-op", async () => {
  const { runtime } = fakeRuntime();
  const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.deepEqual(result, { recovered: 0, claimed: 0, sent: 0, failed: 0, escalated: 0 });
});

test("F016 worker: recovers reminders stuck 'dispatching' from a crashed prior tick before claiming new ones", async () => {
  const { runtime } = fakeRuntime({ stuck: 3 });
  const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.equal(result.recovered, 3);
});

test("F016 worker: an in-app reminder with a resolvable assignee is delivered and marked sent", async () => {
  const activities = new Map([[followUp, { id: followUp, subject: "Call the customer back", entity_type: "general", entity_id: null, due_at: "2026-09-20T10:00:00.000Z", assigned_to: user, assigned_name: "Seller", assigned_email: "seller@example.com" }]]);
  const claimed = [{ id: "reminder-1", organization_id: org, activity_id: followUp, offset_minutes: 60, channel: "in_app", status: "dispatching" }];
  const { runtime, calls } = fakeRuntime({ claimed, activities });
  const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.equal(result.claimed, 1);
  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.ok(calls.some(({ sql }) => sql.includes("INSERT INTO notifications(")));
  assert.ok(calls.some(({ sql, values }) => sql.includes("SET status=$3,sent_at=CASE") && values[2] === "sent"));
});

test("F016 worker: an email reminder with no resolvable email address fails honestly, without attempting delivery", async () => {
  const activities = new Map([[followUp, { id: followUp, subject: "Call the customer back", entity_type: "general", entity_id: null, due_at: "2026-09-20T10:00:00.000Z", assigned_to: user, assigned_name: "Seller", assigned_email: null }]]);
  const claimed = [{ id: "reminder-1", organization_id: org, activity_id: followUp, offset_minutes: 60, channel: "email", status: "dispatching" }];
  const { runtime, calls } = fakeRuntime({ claimed, activities });
  const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.ok(calls.some(({ sql, values }) => sql.includes("SET status=$3,sent_at=CASE") && values[2] === "failed" && values[3] === "NO_EMAIL_ADDRESS"));
});

test("F016 worker: an email reminder with an address but no SMTP configuration in this environment is an honest failure, never a fabricated send", async () => {
  const previous = { host: process.env.SMTP_HOST, user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD, from: process.env.AUTH_EMAIL_FROM };
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_PASSWORD; delete process.env.AUTH_EMAIL_FROM;
  try {
    const activities = new Map([[followUp, { id: followUp, subject: "Call the customer back", entity_type: "general", entity_id: null, due_at: "2026-09-20T10:00:00.000Z", assigned_to: user, assigned_name: "Seller", assigned_email: "seller@example.com" }]]);
    const claimed = [{ id: "reminder-1", organization_id: org, activity_id: followUp, offset_minutes: 60, channel: "email", status: "dispatching" }];
    const { runtime, calls } = fakeRuntime({ claimed, activities });
    const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.ok(calls.some(({ sql, values }) => sql.includes("SET status=$3,sent_at=CASE") && values[2] === "failed" && values[3] === "SMTP_NOT_CONFIGURED"));
  } finally {
    if (previous.host !== undefined) process.env.SMTP_HOST = previous.host;
    if (previous.user !== undefined) process.env.SMTP_USER = previous.user;
    if (previous.password !== undefined) process.env.SMTP_PASSWORD = previous.password;
    if (previous.from !== undefined) process.env.AUTH_EMAIL_FROM = previous.from;
  }
});

test("F016 worker: a claimed reminder whose parent activity has no assignee fails closed rather than delivering to nobody", async () => {
  const claimed = [{ id: "reminder-1", organization_id: org, activity_id: followUp, offset_minutes: 60, channel: "in_app", status: "dispatching" }];
  const { runtime, calls } = fakeRuntime({ claimed, activities: new Map() });
  const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.equal(result.failed, 1);
  assert.ok(calls.some(({ sql, values }) => sql.includes("SET status=$3,sent_at=CASE") && values[3] === "NO_ASSIGNEE"));
});

test("F016 worker: overdue-Follow-up escalation runs every tick and is reported in the result", async () => {
  const { runtime } = fakeRuntime({ escalated: 2 });
  const result = await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.equal(result.escalated, 2);
});

// F016 gap-closure — two defects found by reading the worker against the
// feature's promise ("a useful link"; "retrying a failed delivery does not
// create duplicate alerts"):
//  1. the in-app reminder linked to /crm/activities, a page that does not exist;
//  2. the notification INSERT and the "sent" mark were separate transactions,
//     so a crash between them left a delivered alert behind a reminder that
//     recovery would then deliver a second time.
test("F016 worker: an in-app reminder links to the real Follow-up page and delivers + marks sent in ONE transaction", async () => {
  const activities = new Map([[followUp, { id: followUp, subject: "Call the customer back", entity_type: "general", entity_id: null, due_at: "2026-09-20T10:00:00.000Z", assigned_to: user, assigned_name: "Seller", assigned_email: "seller@example.com" }]]);
  const claimed = [{ id: "reminder-1", organization_id: org, activity_id: followUp, offset_minutes: 60, channel: "in_app", status: "dispatching" }];
  const { runtime, calls } = fakeRuntime({ claimed, activities });
  const scopeOf = new Map();
  let scope = 0;
  const originalWith = runtime.withTenantClient;
  runtime.withTenantClient = async (pool, orgId, callback) => {
    const id = ++scope;
    return originalWith(pool, orgId, async (client) =>
      callback({ query: async (sql, values) => { scopeOf.set(sql.includes("INSERT INTO notifications(") ? "notify" : sql.includes("SET status=$3,sent_at=CASE") ? "mark" : `other-${id}-${scopeOf.size}`, id); return client.query(sql, values); } }),
    );
  };
  await dispatchFollowUpRemindersHandler(null, null, {}, runtime);
  assert.equal(scopeOf.get("notify"), scopeOf.get("mark"), "notification insert and sent-mark must share one tenant transaction");
  const notification = calls.find(({ sql }) => sql.includes("INSERT INTO notifications("));
  assert.ok(notification.values.includes(`/crm/follow-ups/${followUp}`), "reminder must link to /crm/follow-ups/<id>");
  assert.ok(!notification.values.some((v) => String(v).includes("/crm/activities")));
});

test("F016: no notification links to the nonexistent /crm/activities page", async () => {
  const fs = await import("node:fs");
  for (const file of ["services/api/src/modules/crm/seller-activity-and-follow-up-workspace/follow-ups/follow-up-operations.js", "services/worker/src/handlers/crm-follow-up-reminder-dispatch.js"]) {
    const source = fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/crm\/activities\?/, `${file} still links to /crm/activities`);
  }
});
