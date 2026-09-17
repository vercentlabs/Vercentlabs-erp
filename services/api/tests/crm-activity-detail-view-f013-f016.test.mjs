import assert from "node:assert/strict";
import test from "node:test";

import { getCrmCall, updateCrmCall } from "../src/modules/crm/seller-activity-and-follow-up-workspace/call-operations.js";
import { getCrmMeeting, updateCrmMeeting } from "../src/modules/crm/seller-activity-and-follow-up-workspace/meeting-operations.js";
import { getCrmTask, updateCrmTask } from "../src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js";
import { getCrmFollowUp, updateCrmFollowUp } from "../src/modules/crm/seller-activity-and-follow-up-workspace/follow-ups/follow-up-operations.js";

// F013-F016 Tranche J — getCrmCall/getCrmMeeting/getCrmTask/getCrmFollowUp
// and their update counterparts already existed and were already routed
// (/api/crm/{calls,meetings,tasks,follow-ups}/[id] GET/PATCH), but had
// ZERO real function-level test coverage anywhere in the suite before
// this pass — confirmed by grep for actual invocations (not just
// comment mentions) across every services/api/tests/*.mjs file. This
// pass's new detail-view UI is the first real consumer of get*, and the
// Edit button's visibility now depends on knowing each type's editable-
// status set (EDITABLE_STATUSES for Call/Meeting, TERMINAL for Task/
// Follow-up) — these tests lock down that exact boundary rather than
// shipping UI on top of an unverified assumption about it.
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const activityId = "55555555-5555-4555-8555-555555555555";

const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: branch, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.view", "crm.leads.view_sensitive", "crm.activities.manage"] };

function baseRow(overrides = {}) {
  return {
    id: activityId, organization_id: org, company_id: company, branch_id: branch,
    entity_type: "general", entity_id: null, subject: "Test activity", description: null,
    priority: "medium", assigned_to: user, assigned_name: "Seller",
    start_at: null, due_at: "2026-09-20T10:00:00.000Z", reminder_at: null,
    completed_at: null, updated_at: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

function createClient({ activityTypeMatch, row, missing = false }) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes(activityTypeMatch)) return missing ? { rows: [] } : { rows: [row] };
      return { rows: [] };
    },
  };
}

test("F013: getCrmCall returns the call when found", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='call'", row: baseRow({ activity_type: "call", status: "planned", call_direction: "outbound" }) });
  const call = await getCrmCall(client, context, activityId);
  assert.equal(call.id, activityId);
  assert.equal(call.status, "planned");
});

test("F013: getCrmCall 404s for a nonexistent call", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='call'", missing: true });
  await assert.rejects(() => getCrmCall(client, context, activityId), (error) => error.code === "CRM_CALL_NOT_FOUND");
});

test("F013: updateCrmCall rejects editing a call that is not planned/overdue", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='call'", row: baseRow({ activity_type: "call", status: "completed" }) });
  await assert.rejects(
    () => updateCrmCall(client, context, activityId, { subject: "Renamed" }),
    (error) => error.code === "CRM_CALL_READ_ONLY",
  );
});

test("F014: getCrmMeeting returns the meeting when found", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='meeting'", row: baseRow({ activity_type: "meeting", status: "planned" }) });
  const meeting = await getCrmMeeting(client, context, activityId);
  assert.equal(meeting.id, activityId);
});

test("F014: getCrmMeeting 404s for a nonexistent meeting", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='meeting'", missing: true });
  await assert.rejects(() => getCrmMeeting(client, context, activityId), (error) => error.code === "CRM_MEETING_NOT_FOUND");
});

test("F014: updateCrmMeeting rejects editing a meeting that is not planned/overdue", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='meeting'", row: baseRow({ activity_type: "meeting", status: "in_progress" }) });
  await assert.rejects(
    () => updateCrmMeeting(client, context, activityId, { subject: "Renamed" }),
    (error) => error.code === "CRM_MEETING_READ_ONLY",
  );
});

test("F015: getCrmTask returns the task when found", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='task'", row: baseRow({ activity_type: "task", status: "planned" }) });
  const task = await getCrmTask(client, context, activityId);
  assert.equal(task.id, activityId);
});

test("F015: getCrmTask 404s for a nonexistent task", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='task'", missing: true });
  await assert.rejects(() => getCrmTask(client, context, activityId), (error) => error.code === "CRM_TASK_NOT_FOUND");
});

test("F015: updateCrmTask rejects editing a completed task", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='task'", row: baseRow({ activity_type: "task", status: "completed" }) });
  await assert.rejects(
    () => updateCrmTask(client, context, activityId, { subject: "Renamed" }),
    (error) => error.code === "CRM_TASK_READ_ONLY",
  );
});

test("F016: getCrmFollowUp returns the follow-up when found", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='follow_up'", row: baseRow({ activity_type: "follow_up", status: "planned", follow_up_snooze_count: 0 }) });
  const followUp = await getCrmFollowUp(client, context, activityId);
  assert.equal(followUp.id, activityId);
});

test("F016: getCrmFollowUp 404s for a nonexistent follow-up", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='follow_up'", missing: true });
  await assert.rejects(() => getCrmFollowUp(client, context, activityId), (error) => error.code === "CRM_FOLLOW_UP_NOT_FOUND");
});

test("F016: updateCrmFollowUp rejects editing a cancelled follow-up", async () => {
  const client = createClient({ activityTypeMatch: "activity.activity_type='follow_up'", row: baseRow({ activity_type: "follow_up", status: "cancelled" }) });
  await assert.rejects(
    () => updateCrmFollowUp(client, context, activityId, { subject: "Renamed" }),
    (error) => error.code === "CRM_FOLLOW_UP_READ_ONLY",
  );
});
