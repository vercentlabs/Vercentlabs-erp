import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createCrmFollowUp,
  updateCrmFollowUp,
  snoozeCrmFollowUp,
  completeCrmFollowUp,
  cancelCrmFollowUp,
  createRemindersForActivity,
  claimDueReminders,
  markReminderOutcome,
  resetStuckDispatchingReminders,
  escalateOverdueFollowUps,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/follow-ups/follow-up-operations.js";
import { addBusinessMinutes } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const manager = "55555555-5555-4555-8555-555555555555";
const lead = "66666666-6666-4666-8666-666666666666";
const opportunity = "77777777-7777-4777-8777-777777777777";
const followUp = "88888888-8888-4888-8888-888888888888";

const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: branch, allowAllCompanies: false, roleSlugs: [], permissions: ["crm.view", "crm.leads.view_sensitive"] };
const contextNoSensitive = { ...context, permissions: ["crm.view"] };

const DEFAULT_BUSINESS_HOURS = { timezone: "Asia/Kolkata", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

function activityRow(overrides = {}) {
  return {
    id: followUp, organization_id: org, company_id: company, branch_id: branch,
    entity_type: "general", entity_id: null, activity_type: "follow_up",
    subject: "Call back next week", description: null, status: "planned", priority: "medium",
    assigned_to: user, due_at: "2026-09-20T10:00:00.000Z",
    follow_up_reason: null, follow_up_channel: null, follow_up_snooze_count: 0,
    follow_up_escalate_after_minutes: null, follow_up_escalated_at: null, follow_up_escalated_to: null,
    completed_at: null, updated_at: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

// A single dispatcher shared by every test below, mirroring the mock-client
// pattern crm-calls-f013.test.mjs already established: match on the real SQL
// this module issues (see follow-up-operations.js), never re-derive it.
function createClient({ leadRow, activity = {}, managerUserId, reminderInsertReturnsRow = true, claimedRow, claimedActivity, notificationInserted = true } = {}) {
  const calls = [];
  let reminderSeq = 0;
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM public.organization_memberships membership"))
        return { rows: [{ id: user, name: "Seller", email: "seller@example.com" }] };
      if (sql.includes("FROM tenant.crm_leads lead"))
        return { rows: leadRow ? [leadRow] : [] };
      if (sql.includes("INSERT INTO tenant.crm_activities("))
        return { rows: [activityRow(activity)] };
      if (sql.includes("INSERT INTO tenant.crm_follow_up_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_activity_reminders(")) {
        reminderSeq += 1;
        if (!reminderInsertReturnsRow) return { rows: [] };
        return { rows: [{ id: `reminder-${reminderSeq}`, organization_id: org, activity_id: values[1], offset_minutes: values[2], channel: values[3], fire_at: values[4], status: "pending", created_by: values[5] }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE tenant.crm_activities SET due_at=$3,follow_up_snooze_count"))
        return { rows: [activityRow({ ...activity, due_at: values[2], follow_up_snooze_count: (activity.follow_up_snooze_count || 0) + 1, follow_up_escalated_at: null, follow_up_escalated_to: null })] };
      if (sql.includes("UPDATE tenant.crm_activities SET status=$3,completed_at="))
        return { rows: [activityRow({ ...activity, status: values[2], completed_at: values[2] === "completed" ? "2026-09-09T12:00:00.000Z" : null })] };
      if (sql.includes("UPDATE tenant.crm_activities SET") && sql.includes("activity_type='follow_up'"))
        return { rows: [activityRow(activity)] };
      if (sql.includes("SELECT activity.*,u.full_name AS assigned_name FROM tenant.crm_activities activity"))
        return { rows: [activityRow(activity)] };
      if (sql.includes("UPDATE tenant.crm_activity_reminders SET status='cancelled'"))
        return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE tenant.crm_activity_reminders reminder"))
        return { rows: claimedRow ? [claimedRow] : [] };
      if (sql.includes("SELECT activity.id,activity.subject,activity.entity_type"))
        return { rows: claimedActivity ? [claimedActivity] : [] };
      if (sql.includes("SET status=$3,sent_at=CASE"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE tenant.crm_activity_reminders SET status='pending',updated_at=now()"))
        return { rows: [{ id: "reminder-stuck-1" }] };
      if (sql.includes("SELECT activity.* FROM tenant.crm_activities activity") && sql.includes("follow_up_escalate_after_minutes IS NOT NULL"))
        return { rows: [activityRow(activity)] };
      if (sql.includes("FROM tenant.crm_sales_team_members member"))
        return { rows: managerUserId ? [{ manager_user_id: managerUserId }] : [] };
      if (sql.includes("UPDATE tenant.crm_activities SET follow_up_escalated_at=now()"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO notifications("))
        return { rows: notificationInserted ? [{ id: "notif-1" }] : [] };
      if (sql.includes("UPDATE tenant.crm_leads SET updated_at=now()"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE tenant.crm_opportunities SET last_activity_at=now()"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F016: creating a general Follow-up writes the activity row, a created event, default reminders and an outbox event", async () => {
  const client = createClient();
  const result = await createCrmFollowUp(client, context, { subject: "Call back next week", dueAt: "2026-09-20T10:00:00.000Z" });
  assert.equal(result.id, followUp);
  assert.equal(result.activityType, "follow_up");
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_follow_up_events")));
  const reminderInserts = client.calls.filter(({ sql }) => sql.includes("INSERT INTO tenant.crm_activity_reminders("));
  assert.equal(reminderInserts.length, 3); // DEFAULT_REMINDER_OFFSETS = [1440, 60, 0]
  assert.deepEqual(reminderInserts.map(({ values }) => values[2]).sort((a, b) => a - b), [0, 60, 1440]);
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_outbox_events")));
});

test("F016: a Lead-related Follow-up requires Lead sensitive-content permission before touching the Lead", async () => {
  const client = createClient();
  await assert.rejects(
    () => createCrmFollowUp(client, contextNoSensitive, { subject: "Follow up with lead", dueAt: "2026-09-20T10:00:00.000Z", entityType: "lead", entityId: lead }),
    (error) => error.code === "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
  assert.equal(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_activities(")), false);
});

test("F016: a Lead-related Follow-up with permission resolves and scopes to the Lead's company/branch", async () => {
  const client = createClient({ leadRow: { id: lead, company_id: company, branch_id: branch } });
  const result = await createCrmFollowUp(client, context, { subject: "Follow up with lead", dueAt: "2026-09-20T10:00:00.000Z", entityType: "lead", entityId: lead });
  assert.equal(result.id, followUp);
  assert.ok(client.calls.some(({ sql }) => sql.includes("FROM tenant.crm_leads lead")));
});

test("F016: custom reminder offsets are deduped, clamped to 30 days and sorted descending, using the requested channel", async () => {
  const client = createClient();
  await createCrmFollowUp(client, context, {
    subject: "Custom reminders", dueAt: "2026-09-20T10:00:00.000Z",
    reminderOffsets: [30, 30, 999999, -5, 60], reminderChannel: "email",
  });
  const reminderInserts = client.calls.filter(({ sql }) => sql.includes("INSERT INTO tenant.crm_activity_reminders("));
  assert.deepEqual(reminderInserts.map(({ values }) => values[2]), [60, 30]);
  assert.ok(reminderInserts.every(({ values }) => values[3] === "email"));
});

test("F016: createRemindersForActivity rejects when every requested offset is out of range", async () => {
  const client = createClient();
  await assert.rejects(
    () => createRemindersForActivity(client, context, followUp, "2026-09-20T10:00:00.000Z", { offsets: [999999, -1] }),
    (error) => error.code === "CRM_FOLLOW_UP_REMINDER_INVALID",
  );
});

test("F016: reminder creation is idempotent — a replayed insert that hits the UNIQUE constraint (ON CONFLICT DO NOTHING) is silently excluded, not an error", async () => {
  const client = createClient({ reminderInsertReturnsRow: false });
  const created = await createRemindersForActivity(client, context, followUp, "2026-09-20T10:00:00.000Z", { offsets: [60] });
  assert.deepEqual(created, []);
});

test("F016: a reminder due outside working hours is deferred using the same addBusinessMinutes logic F005 SLA timers use", async () => {
  const client = createClient();
  const dueAt = "2026-09-13T03:00:00.000Z"; // a Sunday well outside any weekday window
  const created = await createRemindersForActivity(client, context, followUp, dueAt, { offsets: [0], channel: "in_app" });
  const expected = addBusinessMinutes(new Date(dueAt), 1, DEFAULT_BUSINESS_HOURS).toISOString();
  assert.equal(created[0].fireAt, expected);
  assert.notEqual(created[0].fireAt, new Date(dueAt).toISOString());
});

test("F016: snoozing a Follow-up moves the due date, increments snooze_count, clears prior escalation and regenerates reminders", async () => {
  const client = createClient({ activity: { follow_up_escalated_at: "2026-09-08T00:00:00.000Z", follow_up_escalated_to: manager } });
  const result = await snoozeCrmFollowUp(client, context, followUp, { dueAt: "2099-01-01T10:00:00.000Z" });
  assert.equal(result.followUpSnoozeCount, 1);
  assert.equal(result.followUpEscalatedAt, null);
  assert.ok(client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_activity_reminders SET status='cancelled'")));
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_activity_reminders(")));
});

test("F016: snoozing into the past is rejected", async () => {
  const client = createClient();
  await assert.rejects(
    () => snoozeCrmFollowUp(client, context, followUp, { dueAt: "2020-01-01T00:00:00.000Z" }),
    (error) => error.code === "CRM_FOLLOW_UP_SCHEDULE_INVALID",
  );
});

test("F016: completing an Opportunity-related Follow-up touches the Opportunity and cancels pending reminders", async () => {
  const client = createClient({ activity: { entity_type: "opportunity", entity_id: opportunity } });
  const result = await completeCrmFollowUp(client, context, followUp);
  assert.equal(result.status, "completed");
  assert.ok(client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_opportunities SET last_activity_at=now()")));
  assert.ok(client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_activity_reminders SET status='cancelled'")));
});

test("F016: an already-closed Follow-up cannot be cancelled again", async () => {
  const client = createClient({ activity: { status: "completed", completed_at: "2026-09-09T09:00:00.000Z" } });
  await assert.rejects(
    () => cancelCrmFollowUp(client, context, followUp),
    (error) => error.code === "CRM_FOLLOW_UP_ALREADY_CLOSED",
  );
});

test("F016: a stale expectedUpdatedAt is rejected before any mutation is attempted", async () => {
  const client = createClient();
  await assert.rejects(
    () => updateCrmFollowUp(client, context, followUp, { subject: "Renamed", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
    (error) => error.code === "CRM_FOLLOW_UP_STALE_WRITE",
  );
  assert.equal(client.calls.some(({ sql }) => sql.startsWith("UPDATE tenant.crm_activities SET subject")), false);
});

test("F016: changing dueAt on update cancels stale reminders and regenerates them against the new due date", async () => {
  const client = createClient();
  await updateCrmFollowUp(client, context, followUp, { dueAt: "2099-06-01T10:00:00.000Z" });
  assert.ok(client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_activity_reminders SET status='cancelled'")));
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_activity_reminders(")));
});

test("F016: escalation resolves the assignee's sales-team manager and notifies them", async () => {
  const client = createClient({
    activity: { follow_up_escalate_after_minutes: 60, due_at: "2026-09-01T00:00:00.000Z" },
    managerUserId: manager,
  });
  const escalated = await escalateOverdueFollowUps(client, context);
  assert.equal(escalated, 1);
  assert.ok(client.calls.some(({ sql, values }) => sql.includes("UPDATE tenant.crm_activities SET follow_up_escalated_at=now()") && values[2] === manager));
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO notifications(")));
});

test("F016: escalation with no resolvable manager is a logged non-error outcome, not a notification to an unrelated admin", async () => {
  const client = createClient({
    activity: { follow_up_escalate_after_minutes: 60, due_at: "2026-09-01T00:00:00.000Z" },
    managerUserId: null,
  });
  const escalated = await escalateOverdueFollowUps(client, context);
  assert.equal(escalated, 1);
  assert.ok(client.calls.some(({ sql, values }) => sql.includes("UPDATE tenant.crm_activities SET follow_up_escalated_at=now()") && values[2] === null));
  assert.equal(client.calls.some(({ sql }) => sql.includes("INSERT INTO notifications(")), false);
});

test("F016: claiming due reminders moves them pending -> dispatching atomically and returns delivery context in one round trip", async () => {
  const client = createClient({
    claimedRow: { id: "reminder-1", organization_id: org, activity_id: followUp, offset_minutes: 60, channel: "email", status: "dispatching", fire_at: "2026-09-09T09:00:00.000Z" },
    claimedActivity: { id: followUp, subject: "Call back next week", entity_type: "general", entity_id: null, due_at: "2026-09-20T10:00:00.000Z", assigned_to: user, assigned_name: "Seller", assigned_email: "seller@example.com" },
  });
  const claimed = await claimDueReminders(client, context, { limit: 10 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, "dispatching");
  assert.equal(claimed[0].activity.assignedEmail, "seller@example.com");
  await markReminderOutcome(client, context, "reminder-1", { status: "sent" });
  assert.ok(client.calls.some(({ sql, values }) => sql.includes("SET status=$3,sent_at=CASE") && values[2] === "sent"));
});

test("F016: a reminder left 'dispatching' by a crashed worker is recovered back to 'pending'", async () => {
  const client = createClient();
  const recovered = await resetStuckDispatchingReminders(client, context, { olderThanMinutes: 15 });
  assert.equal(recovered, 1);
});

test("F016: the generic Activity create/update/archive/complete routes cannot bypass governed Follow-ups", () => {
  const source = [
    read("services/api/src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js"),
    read("services/api/src/modules/crm/seller-activity-and-follow-up-workspace/activity-commands.js"),
  ].join("\n");
  assert.match(source, /if \(activityType === "follow_up"\)\s*throw new CrmError\(410, "Use the governed Follow-ups operations\.", "CRM_FOLLOW_UP_API_MOVED"\);/);
  assert.match(source, /if \(before\.activityType === "follow_up" \|\| requestedActivityType === "follow_up"\)\s*throw new CrmError\(410, "Use the governed Follow-ups operations\.", "CRM_FOLLOW_UP_API_MOVED"\);/);
  assert.match(source, /if \(resource === "activities" && before\.activityType === "follow_up"\)\s*throw new CrmError\(410, "Use the governed Follow-ups operations\.", "CRM_FOLLOW_UP_API_MOVED"\);/);
  assert.match(source, /if \(current\.activity_type === "follow_up"\)\s*throw new CrmError\(410, "Use the governed Follow-up completion action\.", "CRM_FOLLOW_UP_API_MOVED"\);/);
});

test("F016 migrations specialize crm_activities, add an immutable Follow-up event ledger and an RLS-protected reminders table", () => {
  const schema = read("database/tenant/migrations/101_f016_follow_ups_and_reminders.sql");
  for (const column of ["follow_up_reason", "follow_up_channel", "follow_up_snooze_count", "follow_up_escalate_after_minutes", "follow_up_escalated_at", "follow_up_escalated_to"])
    assert.match(schema, new RegExp(column));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS tenant\.crm_follow_up_events/);
  assert.match(schema, /BEFORE UPDATE OR DELETE ON tenant\.crm_follow_up_events/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS tenant\.crm_activity_reminders/);
  assert.match(schema, /UNIQUE \(organization_id, activity_id, offset_minutes, channel\)/);
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /FORCE ROW LEVEL SECURITY/);
  const dispatchingWidening = read("database/tenant/migrations/102_f016_reminder_dispatching_status.sql");
  assert.match(dispatchingWidening, /'dispatching'/);
});
