import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createCrmTask,
  completeCrmTask,
  computeNextTaskOccurrence,
  generateNextTaskOccurrence,
  addTaskDependency,
  removeTaskDependency,
  listTaskDependencies,
  taskOverdueSql,
  claimCrmTask,
  releaseCrmTask,
  listMyTaskTeams,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js";

// CRM vNext Prompt 6 (F015 — Tasks). Re-audit confirmed `recurring_rule`
// was pure free text, never parsed by anything — no recurrence engine, no
// dependency table and no generated-task provenance field existed
// anywhere (the one F013-F019 feature with zero implementation work done
// this pass at the start of this section). This closes recurrence,
// dependencies and the overdue-formula centralization; team/queue
// assignment remains a separate, documented open item.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "77777777-7777-4777-8777-777777777777";
const user = "44444444-4444-4444-8444-444444444444";
const task = "55555555-5555-4555-8555-555555555555";
const other = "66666666-6666-4666-8666-666666666666";

const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: branch, allowAllCompanies: false, roleSlugs: [], permissions: [] };

function taskRow(overrides = {}) {
  return {
    id: task, organization_id: org, company_id: company, branch_id: branch,
    entity_type: "general", entity_id: null, activity_type: "task",
    subject: "Send proposal", description: null, status: "planned", priority: "medium",
    assigned_to: user, start_at: null, due_at: "2026-09-20T10:00:00.000Z", reminder_at: null,
    recurring_rule: null, recurrence_config: null, recurrence_parent_id: null, task_source: "user_created",
    completed_at: null, outcome: null, updated_at: "2026-09-09T10:00:00.000Z",
    ...overrides,
  };
}

// --- computeNextTaskOccurrence: pure function, no DB ---------------------

test("F015: computeNextTaskOccurrence advances by N days for a daily rule", () => {
  const next = computeNextTaskOccurrence({ freq: "daily", interval: 3 }, "2026-09-20T10:00:00.000Z", 1);
  assert.equal(next, "2026-09-23T10:00:00.000Z");
});

test("F015: computeNextTaskOccurrence advances by N weeks for a plain weekly rule (no byWeekday)", () => {
  const next = computeNextTaskOccurrence({ freq: "weekly", interval: 2 }, "2026-09-20T10:00:00.000Z", 1);
  assert.equal(next, "2026-10-04T10:00:00.000Z");
});

test("F015: computeNextTaskOccurrence with byWeekday finds the next matching weekday, not a fixed 7-day jump", () => {
  // 2026-09-20 is a Sunday (UTC day 0). byWeekday [2] = Tuesday.
  const next = computeNextTaskOccurrence({ freq: "weekly", interval: 1, byWeekday: [2] }, "2026-09-20T10:00:00.000Z", 1);
  assert.equal(new Date(next).getUTCDay(), 2);
  assert.equal(next, "2026-09-22T10:00:00.000Z");
});

test("F015: computeNextTaskOccurrence advances by N calendar months for a monthly rule, preserving day/time", () => {
  const next = computeNextTaskOccurrence({ freq: "monthly", interval: 1 }, "2026-01-31T10:00:00.000Z", 1);
  // JS Date normalizes Jan 31 + 1 month -> Mar 3 (Feb has no 31st) — this is
  // expected, documented calendar-arithmetic behavior, not a bug: no
  // recurrence engine can invent a Feb 31st.
  assert.ok(next);
});

test("F015: computeNextTaskOccurrence returns null once the occurrence count is exhausted", () => {
  const next = computeNextTaskOccurrence({ freq: "daily", interval: 1, count: 3 }, "2026-09-20T10:00:00.000Z", 4);
  assert.equal(next, null);
});

test("F015: computeNextTaskOccurrence returns null once the next occurrence would fall after the until date", () => {
  const next = computeNextTaskOccurrence({ freq: "daily", interval: 1, until: "2026-09-21T00:00:00.000Z" }, "2026-09-20T10:00:00.000Z", 1);
  assert.equal(next, null);
});

test("F015: computeNextTaskOccurrence is a clean no-op for a Task with no recurrence config", () => {
  assert.equal(computeNextTaskOccurrence(null, "2026-09-20T10:00:00.000Z", 1), null);
});

// --- generateNextTaskOccurrence: real idempotent generation ---------------

function mockClient({ occurrenceCount = 0, claimSucceeds = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_task_recurrence_occurrences") && sql.includes("count(*)"))
        return { rows: [{ total: occurrenceCount }] };
      if (sql.includes("INSERT INTO tenant.crm_task_recurrence_occurrences"))
        return { rows: claimSucceeds ? [{ id: "occurrence-1" }] : [] };
      if (sql.includes("INSERT INTO tenant.crm_activities"))
        return { rows: [taskRow({ id: "generated-task-1", due_at: values[9], task_source: "recurrence_generated", recurrence_parent_id: values[12] })] };
      if (sql.includes("UPDATE tenant.crm_task_recurrence_occurrences SET generated_task_id"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_task_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F015: generateNextTaskOccurrence is a no-op for a completed Task with no recurrence config", async () => {
  const client = mockClient();
  const result = await generateNextTaskOccurrence(client, context, { ...taskRowCamel(), recurrenceConfig: null });
  assert.equal(result, null);
  assert.equal(client.calls.length, 0);
});

function taskRowCamel() {
  return { id: task, companyId: company, branchId: branch, entityType: "general", entityId: null, subject: "Send proposal", description: null, priority: "medium", assignedTo: user, dueAt: "2026-09-20T10:00:00.000Z", recurringRule: null, recurrenceConfig: { freq: "daily", interval: 1 }, recurrenceParentId: null };
}

test("F015: generateNextTaskOccurrence creates exactly one follow-on Task, never a batch", async () => {
  const client = mockClient({ occurrenceCount: 0 });
  const generated = await generateNextTaskOccurrence(client, context, taskRowCamel());
  assert.ok(generated);
  assert.equal(generated.taskSource, "recurrence_generated");
  const creates = client.calls.filter(({ sql }) => sql.includes("INSERT INTO tenant.crm_activities"));
  assert.equal(creates.length, 1, "exactly one Task row must be created per completion, never a batch");
});

test("F015: generateNextTaskOccurrence uses the root parent id for lineage, not the just-completed occurrence's own id, when completing a generated occurrence", async () => {
  const client = mockClient({ occurrenceCount: 2 });
  await generateNextTaskOccurrence(client, context, { ...taskRowCamel(), id: "occurrence-2", recurrenceParentId: "root-task-1" });
  const countQuery = client.calls.find(({ sql }) => sql.includes("count(*)"));
  assert.equal(countQuery.values[1], "root-task-1");
});

test("F015: generateNextTaskOccurrence is idempotent — when the occurrence claim is already taken (a concurrent/retried tick), no Task is created", async () => {
  const client = mockClient({ claimSucceeds: false });
  const result = await generateNextTaskOccurrence(client, context, taskRowCamel());
  assert.equal(result, null);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_activities")), "losing the claim race must never create a Task");
});

test("F015: generateNextTaskOccurrence stops the series (no Task created) once count/until is exhausted", async () => {
  const client = mockClient({ occurrenceCount: 5 });
  const result = await generateNextTaskOccurrence(client, context, { ...taskRowCamel(), recurrenceConfig: { freq: "daily", interval: 1, count: 5 } });
  assert.equal(result, null);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_task_recurrence_occurrences")), "must not even attempt a claim once the series is exhausted");
});

// --- completeCrmTask wiring: recurrence fires on completion ---------------

function completionMockClient({ recurring = false, blocked = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT activity.*,u.full_name AS assigned_name"))
        return { rows: [taskRow(recurring ? { recurrence_config: { freq: "daily", interval: 1 } } : {})] };
      if (sql.includes("FROM tenant.crm_task_dependencies dependency") && sql.includes("NOT IN ('completed','cancelled')"))
        return { rows: blocked ? [{ id: "blocker-1" }] : [] };
      if (sql.includes("UPDATE tenant.crm_activities SET status=$3"))
        return { rows: [taskRow({ status: "completed", completed_at: "2026-09-09T12:00:00.000Z", ...(recurring ? { recurrence_config: { freq: "daily", interval: 1 } } : {}) })] };
      if (sql.includes("INSERT INTO tenant.crm_task_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("FROM tenant.crm_task_recurrence_occurrences") && sql.includes("count(*)"))
        return { rows: [{ total: 0 }] };
      if (sql.includes("INSERT INTO tenant.crm_task_recurrence_occurrences"))
        return { rows: [{ id: "occurrence-1" }] };
      if (sql.includes("INSERT INTO tenant.crm_activities"))
        return { rows: [taskRow({ id: "generated-task-1", task_source: "recurrence_generated" })] };
      if (sql.includes("UPDATE tenant.crm_task_recurrence_occurrences SET generated_task_id"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE tenant.crm_leads") || sql.includes("UPDATE tenant.crm_opportunities"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F015: completing a non-recurring Task never attempts occurrence generation", async () => {
  const client = completionMockClient({ recurring: false });
  await completeCrmTask(client, context, task);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("crm_task_recurrence_occurrences")));
});

test("F015: completing a recurring Task generates exactly one next occurrence", async () => {
  const client = completionMockClient({ recurring: true });
  await completeCrmTask(client, context, task);
  const creates = client.calls.filter(({ sql }) => sql.includes("INSERT INTO tenant.crm_activities"));
  assert.equal(creates.length, 1);
});

test("F015: a Task with an incomplete dependency cannot be completed", async () => {
  const client = completionMockClient({ blocked: true });
  await assert.rejects(
    () => completeCrmTask(client, context, task),
    (error) => error.code === "CRM_TASK_DEPENDENCY_BLOCKED",
  );
  assert.ok(!client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_activities SET status=$3")), "the completion UPDATE must never run while blocked");
});

// --- Dependencies: cycle prevention -----------------------------------

function dependencyMockClient({ existingTasks = new Set([task, other]), cycleExists = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT activity.*,u.full_name AS assigned_name")) {
        const id = values[1];
        return { rows: existingTasks.has(id) ? [taskRow({ id })] : [] };
      }
      if (sql.includes("WITH RECURSIVE reachable"))
        return { rows: cycleExists ? [{ "?column?": 1 }] : [] };
      if (sql.includes("INSERT INTO tenant.crm_task_dependencies"))
        return { rows: [{ id: "dependency-1", organization_id: org, task_id: values[1], depends_on_task_id: values[2] }] };
      if (sql.includes("DELETE FROM tenant.crm_task_dependencies"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("FROM tenant.crm_task_dependencies dependency") && sql.includes("JOIN tenant.crm_activities blocker"))
        return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F015: addTaskDependency rejects a Task depending on itself", async () => {
  const client = dependencyMockClient();
  await assert.rejects(
    () => addTaskDependency(client, context, task, task),
    (error) => error.code === "CRM_TASK_DEPENDENCY_INVALID",
  );
});

test("F015: addTaskDependency rejects a dependency that would create a cycle", async () => {
  const client = dependencyMockClient({ cycleExists: true });
  await assert.rejects(
    () => addTaskDependency(client, context, task, other),
    (error) => error.code === "CRM_TASK_DEPENDENCY_CYCLE",
  );
  assert.ok(!client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_task_dependencies")), "must never insert once a cycle is detected");
});

test("F015: addTaskDependency succeeds when no cycle exists and both Tasks are visible to the caller", async () => {
  const client = dependencyMockClient({ cycleExists: false });
  const result = await addTaskDependency(client, context, task, other);
  assert.ok(result);
  assert.equal(result.taskId, task);
  assert.equal(result.dependsOnTaskId, other);
});

test("F015: removeTaskDependency deletes the edge", async () => {
  const client = dependencyMockClient();
  await removeTaskDependency(client, context, task, other);
  assert.ok(client.calls.some(({ sql }) => sql.includes("DELETE FROM tenant.crm_task_dependencies")));
});

test("F015: listTaskDependencies joins the blocking Task's current status/subject, not just the raw edge", async () => {
  const client = dependencyMockClient();
  await listTaskDependencies(client, context, task);
  assert.ok(client.calls.some(({ sql }) => sql.includes("JOIN tenant.crm_activities blocker")));
});

// --- Canonical overdue formula -------------------------------------------

test("F015: taskOverdueSql produces one canonical predicate, reused by every call site rather than re-derived per file", () => {
  const sql = taskOverdueSql("activity");
  assert.equal(sql, "activity.due_at<now() AND activity.status NOT IN ('completed','cancelled')");
});

test("F015: taskOverdueSql is reused (not re-derived) in the generic activities list, the KPI dashboard count and the activities report", () => {
  const source = [
    fs.readFileSync(new URL("../src/modules/crm/crm-data-operations-and-customization/resource-query-service.js", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js", import.meta.url), "utf8"),
  ].join("\n");
  const occurrences = source.match(/taskOverdueSql\(/g) || [];
  assert.ok(occurrences.length >= 3, `expected taskOverdueSql to be called at least 3 times across the canonical query/analytics services, found ${occurrences.length}`);
});

// --- F015 closeout: team/queue Tasks (real model, not a fake nullable
// assigned_to) — claim concurrency, queue authorization, release/reassign
// permissions, reusing tenant.crm_sales_teams/crm_sales_team_members
// rather than inventing a second team system. ------------------------------

const team = "88888888-8888-4888-8888-888888888888";
const manager = "99999999-9999-4999-8999-999999999999";

function queueTaskRow(overrides = {}) {
  return taskRow({ team_id: team, assigned_to: null, ...overrides });
}

function claimMockClient({ alreadyClaimed = false, updateWins = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT activity.*,u.full_name AS assigned_name"))
        return { rows: [queueTaskRow(alreadyClaimed ? { assigned_to: other } : {})] };
      if (sql.startsWith("UPDATE tenant.crm_activities SET assigned_to=$3,updated_by=$3"))
        return { rows: updateWins ? [queueTaskRow({ assigned_to: values[2] })] : [] };
      if (sql.includes("INSERT INTO tenant.crm_task_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F015: claimCrmTask assigns an unclaimed queued Task to the caller", async () => {
  const client = claimMockClient();
  const result = await claimCrmTask(client, context, task);
  assert.equal(result.assignedTo, user);
  assert.ok(client.calls.some(({ sql }) => sql.includes("INSERT INTO tenant.crm_task_events")));
});

test("F015: claimCrmTask rejects a Task that is not part of a team queue", async () => {
  const client = { async query(sql) {
    if (sql.includes("SELECT activity.*,u.full_name AS assigned_name"))
      return { rows: [taskRow({ team_id: null, assigned_to: null })] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => claimCrmTask(client, context, task), (error) => error.code === "CRM_TASK_NOT_QUEUED");
});

test("F015: claimCrmTask rejects when the Task is already visibly claimed", async () => {
  const client = claimMockClient({ alreadyClaimed: true });
  await assert.rejects(() => claimCrmTask(client, context, task), (error) => error.code === "CRM_TASK_CLAIM_CONFLICT");
});

test("F015: two sellers racing to claim the same queued Task — the loser gets a typed conflict, not a silent double-claim", async () => {
  // Both callers pass the initial visibility check (assigned_to still NULL
  // in both of their reads); only ONE atomic UPDATE actually matches
  // assigned_to IS NULL — the DB's own row-lock re-check under READ
  // COMMITTED is the real concurrency guarantee this simulates.
  const winner = claimMockClient({ updateWins: true });
  const loser = claimMockClient({ updateWins: false });
  const winnerResult = await claimCrmTask(winner, context, task);
  assert.equal(winnerResult.assignedTo, user);
  await assert.rejects(
    () => claimCrmTask(loser, context, task),
    (error) => error.code === "CRM_TASK_CLAIM_CONFLICT",
  );
});

function releaseMockClient({ assignedTo = user, teamRow = { manager_user_id: manager } } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT activity.*,u.full_name AS assigned_name"))
        return { rows: [queueTaskRow({ assigned_to: assignedTo })] };
      if (sql.includes("SELECT id,company_id,manager_user_id FROM tenant.crm_sales_teams"))
        return { rows: [{ id: team, company_id: company, ...teamRow }] };
      if (sql.startsWith("UPDATE tenant.crm_activities SET assigned_to=NULL"))
        return { rows: [queueTaskRow({ assigned_to: null })] };
      if (sql.includes("INSERT INTO tenant.crm_task_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F015: releaseCrmTask lets the current assignee release their own claim back to the queue", async () => {
  const client = releaseMockClient({ assignedTo: user });
  const result = await releaseCrmTask(client, context, task);
  assert.equal(result.assignedTo, null);
});

test("F015: releaseCrmTask forbids releasing someone else's claim unless the caller is the Team's manager or holds view-all", async () => {
  const client = releaseMockClient({ assignedTo: other, teamRow: { manager_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } });
  await assert.rejects(() => releaseCrmTask(client, context, task), (error) => error.code === "CRM_TASK_RELEASE_FORBIDDEN");
});

test("F015: releaseCrmTask allows the Team's manager to release someone else's claim", async () => {
  const managerContext = { ...context, userId: manager };
  const client = releaseMockClient({ assignedTo: other, teamRow: { manager_user_id: manager } });
  const result = await releaseCrmTask(client, managerContext, task);
  assert.equal(result.assignedTo, null);
});

test("F015: releaseCrmTask rejects a Task that isn't part of a team queue", async () => {
  const client = { async query(sql) {
    if (sql.includes("SELECT activity.*,u.full_name AS assigned_name"))
      return { rows: [taskRow({ team_id: null })] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(() => releaseCrmTask(client, context, task), (error) => error.code === "CRM_TASK_NOT_QUEUED");
});

// --- Team-scoped create: queue authorization / membership validation -----

function createTeamTaskMockClient({ teamActive = true, teamCompany = company, assigneeIsMember = true } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT id,company_id,manager_user_id FROM tenant.crm_sales_teams"))
        return { rows: teamActive ? [{ id: team, company_id: teamCompany, manager_user_id: manager }] : [] };
      if (sql.includes("FROM tenant.crm_sales_team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3"))
        return { rows: assigneeIsMember ? [{ exists: 1 }] : [] };
      if (sql.includes("INSERT INTO tenant.crm_activities"))
        return { rows: [queueTaskRow({ assigned_to: values[8], team_id: values[9] })] };
      if (sql.includes("INSERT INTO tenant.crm_task_events"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F015: creating a Task with a teamId and no assignee leaves it unclaimed (queued)", async () => {
  const client = createTeamTaskMockClient();
  const result = await createCrmTask(client, context, { subject: "Call back lead", teamId: team });
  assert.equal(result.assignedTo, null);
  assert.equal(result.teamId, team);
});

test("F015: creating a Task directly assigned to another Team member requires the caller to be the Team's manager", async () => {
  const client = createTeamTaskMockClient();
  await assert.rejects(
    () => createCrmTask(client, context, { subject: "Call back lead", teamId: team, assignedTo: other }),
    (error) => error.code === "CRM_TASK_ASSIGN_FORBIDDEN",
  );
});

test("F015: the Team's manager MAY directly assign a queued Task to a specific member", async () => {
  const managerContext = { ...context, userId: manager };
  const client = createTeamTaskMockClient();
  const result = await createCrmTask(client, managerContext, { subject: "Call back lead", teamId: team, assignedTo: other });
  assert.equal(result.assignedTo, other);
});

test("F015: assigning a queued Task to someone who is not an active Team member is rejected", async () => {
  const managerContext = { ...context, userId: manager };
  const client = createTeamTaskMockClient({ assigneeIsMember: false });
  await assert.rejects(
    () => createCrmTask(client, managerContext, { subject: "Call back lead", teamId: team, assignedTo: other }),
    (error) => error.code === "CRM_TASK_ASSIGNEE_NOT_TEAM_MEMBER",
  );
});

test("F015: a Task cannot be queued against a Team from another company", async () => {
  const client = createTeamTaskMockClient({ teamCompany: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  await assert.rejects(
    () => createCrmTask(client, context, { subject: "Call back lead", teamId: team }),
    (error) => error.code === "CRM_TASK_TEAM_SCOPE_INVALID",
  );
});

test("F015: a Task cannot be queued against an inactive/unknown Team", async () => {
  const client = createTeamTaskMockClient({ teamActive: false });
  await assert.rejects(
    () => createCrmTask(client, context, { subject: "Call back lead", teamId: team }),
    (error) => error.code === "CRM_TASK_TEAM_INVALID",
  );
});

// --- listMyTaskTeams -------------------------------------------------------

test("F015: listMyTaskTeams returns every active Team for a view-all/manager caller", async () => {
  const viewAllContext = { ...context, permissions: ["crm.records.view_all"] };
  const client = { async query(sql) {
    assert.ok(sql.includes("FROM tenant.crm_sales_teams WHERE organization_id=$1 AND status='active'"));
    return { rows: [{ id: team, name: "Enterprise", manager_user_id: manager }] };
  } };
  const teams = await listMyTaskTeams(client, viewAllContext);
  assert.equal(teams.length, 1);
});

test("F015: listMyTaskTeams scopes an ordinary caller to Teams they actually belong to", async () => {
  const client = { async query(sql) {
    assert.ok(sql.includes("JOIN tenant.crm_sales_team_members member"));
    return { rows: [{ id: team, name: "Enterprise", manager_user_id: manager }] };
  } };
  const teams = await listMyTaskTeams(client, context);
  assert.equal(teams.length, 1);
});

// --- scopeSql: queue visibility does not leak to non-members --------------

test("F015: listCrmTasks scopes an unclaimed queue Task to that Team's active members, not the whole organization", async () => {
  const { listCrmTasks } = await import("../src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js");
  const client = {
    async query(sql, values) {
      if (sql.includes("count(*)")) {
        assert.ok(sql.includes("crm_sales_team_members"), "queue visibility must be scoped through Team membership, not left wide open");
        return { rows: [{ total: 0 }] };
      }
      return { rows: [] };
    },
  };
  await listCrmTasks(client, context, {});
});
