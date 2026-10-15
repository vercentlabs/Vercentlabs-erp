// Projects — Milestones, the commands: a milestone created (once per request; singly or as a plan with its sequence), edited, given an owner,
// started, blocked and unblocked, its deliverables checked off (with evidence) or waived, tasks and prerequisite milestones linked, submitted
// as an immutable snapshot, approved internally, accepted by the customer (recorded from the evidence received), completed once every
// condition holds, reopened with a reason, cancelled after reviewing what depends on it, waived for project completion, and handed to Sales
// for billing — never invoiced here. Every change is versioned, recorded in the milestone's history and announced to automation.
import { publishDomainEvent } from "../../core/platform/events/index.js";
import { archiveFile, listFiles, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { createNotification } from "../../core/platform/notifications/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { PRIORITIES, eligibleUsers, has, isoDay, projectError, projectEvent, text, uuid, visibleProject } from "./project-core.js";
import {
  approvalsOf, billingRequestOf, criteriaOf, currentLineOf, dependentsOf, milestoneScope, orgDay, prerequisitesOf, projectScope, readinessFor, tasksOf,
} from "./project-milestone-read.js";
import {
  BLOCKER_CATEGORIES, MILESTONE_ENTITY, MILESTONE_STATUS_LABEL, MILESTONE_TYPES, OPEN_STATUSES, approvalAfter, createsCycle, milestoneAccess, needsApproval, taskSource,
} from "./project-milestone-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const need = (can, key) => { if (!can[key]) throw err(403, "MILESTONE_PERMISSION_DENIED"); };
const day = (value) => (value ? isoDay(value) : null);
const keyOf = (input) => text(input.idempotencyKey, 200) || null;
const reasonOf = (value, message = "Give a reason.") => {
  const reason = text(value, 2000);
  if (reason.length < 3) throw err(400, "MILESTONE_REASON_REQUIRED", message);
  return reason;
};
const versionCheck = (milestone, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(milestone.row_version)) throw err(409, "MILESTONE_VERSION_CONFLICT");
};

// ------------------------------------------------------------------ history, notifications, automation
async function milestoneEvent(client, c, milestone, action, summary, { from = null, to = null, details = {}, key = null } = {}) {
  await client.query(`INSERT INTO tenant.project_milestone_events (organization_id, milestone_id, project_id, action, summary, details, from_status, to_status, actor_user_id, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
    [c.organizationId, milestone.id, milestone.project_id, action, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), from, to, c.userId ?? null, key]);
  await publishDomainEvent(client, { organizationId: c.organizationId, moduleKey: "projects", eventType: `projects.milestone.${action.toLowerCase()}`, entityType: MILESTONE_ENTITY,
    entityId: milestone.id, payload: { milestoneCode: milestone.milestone_code, projectId: milestone.project_id, status: to ?? milestone.status, ...details } });
}
// A command already applied under this key answers as it did, without doing it again.
async function replay(client, c, key) {
  if (!key) return null;
  const row = (await client.query(`SELECT milestone_id, to_status, details FROM tenant.project_milestone_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  return row ? { milestoneId: row.milestone_id, status: row.to_status ?? undefined, replayed: true, ...(row.details?.result ?? {}) } : null;
}
async function notify(client, c, milestone, userIds, { category = "project_milestone", title, message }) {
  const users = new Set(userIds.filter(Boolean));
  users.delete(c.userId);
  for (const userId of users) {
    await createNotification(client, { organizationId: c.organizationId, userId, category, title, message, href: `/projects/milestones/${milestone.id}`, entityType: MILESTONE_ENTITY, entityId: milestone.id });
  }
}
// Update the milestone, bumping its version; `sets` maps column -> value.
async function write(client, c, milestone, sets) {
  const columns = ["row_version = row_version + 1", "updated_by = $3", "updated_at = now()"];
  const values = [c.organizationId, milestone.id, c.userId ?? null];
  for (const [column, value] of Object.entries(sets)) { values.push(value); columns.push(`${column} = $${values.length}`); }
  return (await client.query(`UPDATE tenant.project_milestones SET ${columns.join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING *`, values)).rows[0];
}

// ------------------------------------------------------------------ guards
// Planning and evidence work happen while the project is open; starting, submitting and completing while it is in progress.
function projectOpen(project) {
  if (["COMPLETED", "CANCELLED"].includes(project.status) || project.archived_at || project.deleted_at) throw err(409, "MILESTONE_PROJECT_CLOSED");
}
function projectWorking(project) {
  projectOpen(project);
  if (project.status === "ON_HOLD") throw err(409, "MILESTONE_PROJECT_ON_HOLD");
  if (project.status !== "IN_PROGRESS") throw err(409, "MILESTONE_STATUS_INVALID", "Start the project before starting, submitting or completing its milestones.");
}
function milestoneOpen(milestone) {
  if (milestone.status === "COMPLETED") throw err(409, "MILESTONE_ALREADY_COMPLETED");
  if (milestone.status === "CANCELLED") throw err(409, "MILESTONE_STATUS_INVALID", "This milestone is cancelled.");
}
// A change to what is reviewed: refused while it is under review unless the submission is withdrawn; afterwards an older approval no
// longer counts (the scope version moves on).
async function changeScope(client, c, milestone, input, what) {
  milestoneOpen(milestone);
  let row = milestone;
  if (milestone.status === "SUBMITTED") {
    if (!input.withdrawSubmission) throw err(409, "MILESTONE_SUBMITTED_LOCKED");
    row = await write(client, c, milestone, { status: "IN_PROGRESS", approval_status: "NOT_SUBMITTED", scope_version: milestone.scope_version + 1 });
    await milestoneEvent(client, c, row, "SUBMISSION_WITHDRAWN", `Submission withdrawn to change ${what}`, { from: "SUBMITTED", to: "IN_PROGRESS" });
    return row;
  }
  return write(client, c, milestone, { scope_version: milestone.scope_version + 1,
    ...(milestone.approval_status === "APPROVED" ? { approval_status: needsApproval(milestone) ? "NOT_SUBMITTED" : "NOT_REQUIRED" } : {}) });
}

// ------------------------------------------------------------------ the fields, checked
// The owner is an active company user who can see projects and is on this project (its manager or a contributing member).
async function ownerOf(client, c, project, userId) {
  const id = uuid(userId, "Milestone owner");
  if (!(await eligibleUsers(client, c, [id])).has(id)) throw err(400, "MILESTONE_OWNER_INVALID", undefined, { field: "ownerUserId" });
  if (project.manager_user_id !== id) {
    const member = (await client.query(`SELECT role FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND user_id = $3 AND left_at IS NULL`,
      [c.organizationId, project.id, id])).rows[0];
    if (!member || !["MANAGER", "MEMBER"].includes(member.role)) throw err(400, "MILESTONE_OWNER_INVALID", "The owner must be the Project Manager or a member who works on the project.", { field: "ownerUserId" });
  }
  return id;
}
// The customer's person who accepts: one of the project's active customer contacts.
async function acceptanceContactOf(client, c, project, contactId) {
  if (project.classification !== "CUSTOMER" || !project.customer_id) throw err(400, "MILESTONE_CUSTOMER_CONTACT_INVALID", "Customer acceptance needs a customer project with its customer chosen.");
  const id = uuid(contactId, "Customer contact");
  const row = (await client.query(`SELECT 1 FROM tenant.project_customer_contacts WHERE organization_id = $1 AND project_id = $2 AND contact_id = $3 AND status = 'ACTIVE' LIMIT 1`,
    [c.organizationId, project.id, id])).rows[0];
  if (!row) throw err(400, "MILESTONE_CUSTOMER_CONTACT_INVALID", undefined, { field: "customerContactId" });
  return id;
}
// Dates: due on or before the project's target end, not before the project's planned start; a planned start not after the due date.
function checkDates(project, { plannedStart, due }) {
  const target = day(project.target_end_date);
  const start = day(project.planned_start_date);
  if (target && due > target) throw err(400, "MILESTONE_DATE_INVALID", `The milestone is due after the project's target date (${target}). Move the project's target first.`, { field: "dueDate" });
  if (start && due < start) throw err(400, "MILESTONE_DATE_INVALID", `The milestone is due before the project's planned start (${start}).`, { field: "dueDate" });
  if (plannedStart && plannedStart > due) throw err(400, "MILESTONE_DATE_INVALID", "The planned start cannot be after the due date.", { field: "plannedStartDate" });
}
const enumOf = (value, allowed, fallback, message, field) => {
  if (value === undefined || value === null || value === "") return fallback;
  const upper = String(value).toUpperCase();
  if (!allowed.includes(upper)) throw err(400, "MILESTONE_INPUT_INVALID", message, { field });
  return upper;
};
function criterionInput(input) {
  const description = text(input.description, 500);
  if (description.length < 2) throw err(400, "MILESTONE_INPUT_INVALID", "Describe the deliverable (2 to 500 characters).", { field: "description" });
  return { description, isRequired: input.isRequired !== false, evidenceRequired: Boolean(input.evidenceRequired) };
}

// ------------------------------------------------------------------ create
// input: { name, description?, milestoneType?, ownerUserId, dueDate, plannedStartDate?, priority?, sequence?, internalApprovalRequired?,
// customerAcceptanceRequired?, customerContactId?, requiredForCompletion?, criteria?: [{ description, isRequired?, evidenceRequired? }],
// prerequisiteIds?: [], idempotencyKey? }. The project comes from the route; the code from the company's numbering.
export async function createProjectMilestone(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, milestone_code, status FROM tenant.project_milestones WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { milestoneId: existing.id, milestoneCode: existing.milestone_code, status: existing.status, replayed: true };
  }
  const { project, can } = await projectScope(client, c, projectId);
  need(can, "create");
  projectOpen(project);
  return insertMilestone(client, c, project, input, key);
}
async function insertMilestone(client, c, project, input, key) {
  const name = text(input.name, 300);
  if (name.length < 2 || name.length > 200) throw err(400, "MILESTONE_NAME_REQUIRED", undefined, { field: "name" });
  if (!input.ownerUserId) throw err(400, "MILESTONE_OWNER_INVALID", "Choose the milestone owner.", { field: "ownerUserId" });
  const owner = await ownerOf(client, c, project, input.ownerUserId);
  if (!input.dueDate) throw err(400, "MILESTONE_DATE_INVALID", "Choose the target date.", { field: "dueDate" });
  const due = isoDay(input.dueDate);
  const plannedStart = input.plannedStartDate ? isoDay(input.plannedStartDate) : null;
  checkDates(project, { plannedStart, due });
  const settings = (await client.query(`SELECT milestone_internal_approval_default FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const internal = input.internalApprovalRequired === undefined ? (settings?.milestone_internal_approval_default ?? true) : Boolean(input.internalApprovalRequired);
  const customer = Boolean(input.customerAcceptanceRequired);
  if (customer && (project.classification !== "CUSTOMER" || !project.customer_id)) throw err(400, "MILESTONE_CUSTOMER_CONTACT_INVALID", "Customer acceptance needs a customer project with its customer chosen.");
  const contact = input.customerContactId ? await acceptanceContactOf(client, c, project, input.customerContactId) : null;
  const type = enumOf(input.milestoneType, Object.keys(MILESTONE_TYPES), "DELIVERABLE", "Choose deliverable, approval, phase gate or other.", "milestoneType");
  const priority = enumOf(input.priority, PRIORITIES, "NORMAL", "Choose low, normal, high or urgent.", "priority");
  const criteria = (Array.isArray(input.criteria) ? input.criteria : []).map(criterionInput);
  if (criteria.length > 50) throw err(400, "MILESTONE_INPUT_INVALID", "Use at most 50 completion criteria.", { field: "criteria" });
  const sequence = input.sequence ? Math.max(1, Math.floor(Number(input.sequence)) || 1)
    : Number((await client.query(`SELECT COALESCE(max(sequence), 0) + 1 AS n FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2`, [c.organizationId, project.id])).rows[0].n);
  const code = await nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "project_milestone" });
  const row = (await client.query(
    `INSERT INTO tenant.project_milestones (organization_id, project_id, milestone_code, name, description, milestone_type, owner_user_id, approval_status, internal_approval_required,
       customer_acceptance_required, customer_contact_id, priority, sequence, planned_start_date, original_due_date, current_due_date, required_for_completion, create_key, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,$17,$18,$18) RETURNING *`,
    [c.organizationId, project.id, code, name, text(input.description, 10000) || null, type, owner, internal || customer ? "NOT_SUBMITTED" : "NOT_REQUIRED", internal, customer, contact,
      priority, sequence, plannedStart, due, input.requiredForCompletion !== false, key, c.userId ?? null])).rows[0];
  let order = 0;
  for (const criterion of criteria) {
    order += 1;
    await client.query(`INSERT INTO tenant.project_milestone_criteria (organization_id, milestone_id, sequence, description, is_required, evidence_required, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [c.organizationId, row.id, order, criterion.description, criterion.isRequired, criterion.evidenceRequired, c.userId ?? null]);
  }
  await milestoneEvent(client, c, row, "CREATED", `Milestone ${code} created: ${name}, due ${due}`, { to: row.status, details: { dueDate: due, ownerUserId: owner } });
  await projectEvent(client, c, project.id, "MILESTONE_ADDED", `${code} ${name} (due ${due})`);
  for (const prerequisiteId of Array.isArray(input.prerequisiteIds) ? input.prerequisiteIds : []) await insertDependency(client, c, row, prerequisiteId);
  await notify(client, c, row, [owner], { title: `You own milestone ${code}`, message: `${name} — due ${due}.` });
  return { milestoneId: row.id, milestoneCode: code, status: row.status };
}
// A planned set of milestones in their order (from a template or a project plan): each may name earlier ones (by position) as prerequisites.
// input: { milestones: [{ ...createInput, prerequisites?: [index] }], idempotencyKey? }
export async function applyProjectMilestonePlan(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, milestone_code FROM tenant.project_milestones WHERE organization_id = $1 AND create_key LIKE $2 ORDER BY sequence`, [c.organizationId, `${key}:%`])).rows;
    if (existing.length) return { milestones: existing.map((row) => ({ milestoneId: row.id, milestoneCode: row.milestone_code })), replayed: true };
  }
  const { project, can } = await projectScope(client, c, projectId);
  need(can, "create");
  projectOpen(project);
  const plan = Array.isArray(input.milestones) ? input.milestones : [];
  if (!plan.length || plan.length > 50) throw err(400, "MILESTONE_INPUT_INVALID", "Give between 1 and 50 milestones.");
  const created = [];
  for (const [index, entry] of plan.entries()) {
    const prerequisites = (Array.isArray(entry.prerequisites) ? entry.prerequisites : []).map((position) => {
      const target = created[Number(position)];
      if (!target || Number(position) >= index) throw err(400, "MILESTONE_DEPENDENCY_INVALID", "A milestone may depend only on milestones earlier in the plan.");
      return target.milestoneId;
    });
    const result = await insertMilestone(client, c, project, { ...entry, prerequisiteIds: prerequisites }, key ? `${key}:${index}` : null);
    created.push(result);
  }
  return { milestones: created };
}

// ------------------------------------------------------------------ edit
// input: { name?, description?, milestoneType?, priority?, sequence?, plannedStartDate?, dueDate?, dueDateReason?, internalApprovalRequired?,
// customerAcceptanceRequired?, customerContactId?, requiredForCompletion?, withdrawSubmission?, expectedVersion?, idempotencyKey? }
export async function updateProjectMilestone(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "edit");
  versionCheck(milestone, input.expectedVersion);
  projectOpen(project);
  milestoneOpen(milestone);
  const given = (name) => input[name] !== undefined;
  const sets = {};
  const changes = [];
  if (given("name")) {
    const name = text(input.name, 300);
    if (name.length < 2 || name.length > 200) throw err(400, "MILESTONE_NAME_REQUIRED", undefined, { field: "name" });
    if (name !== milestone.name) { sets.name = name; changes.push("name"); }
  }
  if (given("description")) { const value = text(input.description, 10000) || null; if (value !== milestone.description) { sets.description = value; changes.push("description"); } }
  if (given("milestoneType")) { const value = enumOf(input.milestoneType, Object.keys(MILESTONE_TYPES), milestone.milestone_type, "Choose deliverable, approval, phase gate or other.", "milestoneType"); if (value !== milestone.milestone_type) { sets.milestone_type = value; changes.push("type"); } }
  if (given("priority")) { const value = enumOf(input.priority, PRIORITIES, milestone.priority, "Choose low, normal, high or urgent.", "priority"); if (value !== milestone.priority) { sets.priority = value; changes.push("priority"); } }
  if (given("sequence")) { const value = Math.max(1, Math.floor(Number(input.sequence)) || 1); if (value !== milestone.sequence) { sets.sequence = value; changes.push("order"); } }
  if (given("requiredForCompletion")) { const value = Boolean(input.requiredForCompletion); if (value !== milestone.required_for_completion) { sets.required_for_completion = value; changes.push("required for completion"); } }
  const plannedStart = given("plannedStartDate") ? (input.plannedStartDate ? isoDay(input.plannedStartDate) : null) : day(milestone.planned_start_date);
  const due = given("dueDate") && input.dueDate ? isoDay(input.dueDate) : day(milestone.current_due_date);
  if (given("plannedStartDate") && plannedStart !== day(milestone.planned_start_date)) { sets.planned_start_date = plannedStart; changes.push("planned start"); }
  let dueChange = null;
  if (due !== day(milestone.current_due_date)) {
    dueChange = { from: day(milestone.current_due_date), to: due, reason: reasonOf(input.dueDateReason, "Say why the due date changes.") };
    sets.current_due_date = due;
  }
  checkDates(project, { plannedStart, due });
  // What the acceptance needs is part of what is reviewed.
  const material = [];
  if (given("internalApprovalRequired") && Boolean(input.internalApprovalRequired) !== milestone.internal_approval_required) { sets.internal_approval_required = Boolean(input.internalApprovalRequired); material.push("internal approval"); }
  if (given("customerAcceptanceRequired") && Boolean(input.customerAcceptanceRequired) !== milestone.customer_acceptance_required) {
    if (input.customerAcceptanceRequired && (project.classification !== "CUSTOMER" || !project.customer_id)) throw err(400, "MILESTONE_CUSTOMER_CONTACT_INVALID", "Customer acceptance needs a customer project with its customer chosen.");
    sets.customer_acceptance_required = Boolean(input.customerAcceptanceRequired); material.push("customer acceptance");
  }
  if (given("customerContactId")) {
    const value = input.customerContactId ? await acceptanceContactOf(client, c, project, input.customerContactId) : null;
    if (value !== milestone.customer_contact_id) { sets.customer_contact_id = value; material.push("acceptance contact"); }
  }
  if (!changes.length && !material.length && !dueChange) return { milestoneId: milestone.id, version: milestone.row_version, changed: [] };
  let row = milestone;
  if (material.length) row = await changeScope(client, c, milestone, input, material.join(", "));
  else if (milestone.status === "SUBMITTED" && (changes.includes("name") || changes.includes("description"))) row = await changeScope(client, c, milestone, input, "the milestone's details");
  const internal = sets.internal_approval_required ?? row.internal_approval_required;
  const customer = sets.customer_acceptance_required ?? row.customer_acceptance_required;
  // Outside a review, the approval state follows what is now required.
  if (material.length && row.status !== "SUBMITTED") sets.approval_status = internal || customer ? "NOT_SUBMITTED" : "NOT_REQUIRED";
  row = await write(client, c, row, sets);
  if (dueChange) {
    await milestoneEvent(client, c, row, "DUE_DATE_CHANGED", `Due date ${dueChange.from} → ${dueChange.to}: ${dueChange.reason}`, { details: dueChange });
    await notify(client, c, row, [row.owner_user_id, project.manager_user_id], { title: `${row.milestone_code} is now due ${dueChange.to}`, message: `${row.name}: ${dueChange.reason}` });
  }
  if (changes.length || material.length) await milestoneEvent(client, c, row, "UPDATED", `Changed: ${[...changes, ...material].join(", ")}`, { details: { fields: [...changes, ...material] }, key: keyOf(input) });
  return { milestoneId: row.id, version: row.row_version, changed: [...changes, ...material, ...(dueChange ? ["due date"] : [])], status: row.status };
}

// input: { ownerUserId, note?, expectedVersion?, idempotencyKey? }
export async function assignMilestoneOwner(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "assign");
  versionCheck(milestone, input.expectedVersion);
  projectOpen(project);
  milestoneOpen(milestone);
  const owner = await ownerOf(client, c, project, input.ownerUserId);
  if (owner === milestone.owner_user_id) return { milestoneId: milestone.id, ownerUserId: owner, replayed: true };
  const row = await write(client, c, milestone, { owner_user_id: owner });
  await milestoneEvent(client, c, row, "ASSIGNED", `Owner changed${text(input.note, 500) ? `: ${text(input.note, 500)}` : ""}`, { details: { from: milestone.owner_user_id, to: owner }, key: keyOf(input) });
  await notify(client, c, row, [owner], { title: `You own milestone ${row.milestone_code}`, message: `${row.name} — due ${day(row.current_due_date)}.` });
  return { milestoneId: row.id, ownerUserId: owner, version: row.row_version };
}

// ------------------------------------------------------------------ lifecycle
// Not started → In progress. Unmet prerequisites stop it unless someone who may waive gives an exception. input: { exceptionReason?, expectedVersion?, idempotencyKey? }
export async function startProjectMilestone(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "work");
  versionCheck(milestone, input.expectedVersion);
  if (milestone.status === "IN_PROGRESS") return { milestoneId: milestone.id, status: milestone.status, replayed: true };
  projectWorking(project);
  if (milestone.status !== "NOT_STARTED") throw err(409, "MILESTONE_STATUS_INVALID", `A ${MILESTONE_STATUS_LABEL[milestone.status].toLowerCase()} milestone cannot be started.`);
  const unmet = (await prerequisitesOf(client, c, milestone.id)).filter((row) => row.status !== "COMPLETED");
  let exception = null;
  if (unmet.length) {
    if (!input.exceptionReason) throw err(409, "MILESTONE_DEPENDENCY_OPEN", `Complete ${unmet.map((row) => row.milestone_code).join(", ")} first.`, { prerequisites: unmet.map((row) => row.milestone_code) });
    need(can, "waive");
    exception = reasonOf(input.exceptionReason);
  }
  const row = await write(client, c, milestone, { status: "IN_PROGRESS", started_at: new Date() });
  await milestoneEvent(client, c, row, "STARTED", exception ? `Started before ${unmet.map((r) => r.milestone_code).join(", ")} by exception: ${exception}` : "Work started",
    { from: milestone.status, to: "IN_PROGRESS", key: keyOf(input), details: exception ? { exception, prerequisites: unmet.map((r) => r.milestone_code) } : {} });
  return { milestoneId: row.id, status: row.status };
}

// A blocker: who owns it, what it is. Raising one on a not-started or in-progress milestone marks it Blocked (resuming where it was once the
// last one is resolved); on a submitted milestone it holds back completion. input: { category?, description, ownerUserId?, idempotencyKey? }
export async function raiseMilestoneBlocker(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "work");
  projectOpen(project);
  milestoneOpen(milestone);
  const description = text(input.description, 1000);
  if (description.length < 3) throw err(400, "MILESTONE_INPUT_INVALID", "Describe what is blocking the milestone.", { field: "description" });
  const category = enumOf(input.category, Object.keys(BLOCKER_CATEGORIES), "OTHER", "Choose a blocker category.", "category");
  const owner = input.ownerUserId ? await ownerOf(client, c, project, input.ownerUserId) : milestone.owner_user_id;
  const blocker = (await client.query(`INSERT INTO tenant.project_milestone_blockers (organization_id, milestone_id, category, description, owner_user_id, raised_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [c.organizationId, milestone.id, category, description, owner, c.userId ?? null])).rows[0];
  let row = milestone;
  if (["NOT_STARTED", "IN_PROGRESS"].includes(milestone.status)) row = await write(client, c, milestone, { status: "BLOCKED", previous_status: milestone.status });
  else row = await write(client, c, milestone, {});
  await milestoneEvent(client, c, row, "BLOCKED", `${BLOCKER_CATEGORIES[category]}: ${description}`, { from: milestone.status, to: row.status, key: keyOf(input), details: { blockerId: blocker.id, result: { blockerId: blocker.id } } });
  await notify(client, c, row, [project.manager_user_id, owner], { title: `${row.milestone_code} is blocked`, message: `${row.name}: ${description}` });
  return { milestoneId: row.id, status: row.status, blockerId: blocker.id };
}
// input: { blockerId, resolution, idempotencyKey? }
export async function resolveMilestoneBlocker(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "work");
  projectOpen(project);
  const blocker = (await client.query(`SELECT * FROM tenant.project_milestone_blockers WHERE organization_id = $1 AND milestone_id = $2 AND id = $3`, [c.organizationId, milestone.id, uuid(input.blockerId, "Blocker")])).rows[0];
  if (!blocker) throw err(404, "MILESTONE_NOT_FOUND", "Blocker not found.");
  if (blocker.status === "RESOLVED") return { milestoneId: milestone.id, status: milestone.status, replayed: true };
  const resolution = reasonOf(input.resolution, "Say how the blocker was resolved.");
  await client.query(`UPDATE tenant.project_milestone_blockers SET status = 'RESOLVED', resolution = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, blocker.id, resolution, c.userId ?? null]);
  const stillOpen = Number((await client.query(`SELECT count(*) AS n FROM tenant.project_milestone_blockers WHERE organization_id = $1 AND milestone_id = $2 AND status = 'OPEN'`, [c.organizationId, milestone.id])).rows[0].n);
  let row = milestone;
  if (milestone.status === "BLOCKED" && !stillOpen) row = await write(client, c, milestone, { status: milestone.previous_status, previous_status: null });
  else row = await write(client, c, milestone, {});
  await milestoneEvent(client, c, row, "UNBLOCKED", `Blocker resolved: ${resolution}`, { from: milestone.status, to: row.status, key: keyOf(input), details: { blockerId: blocker.id } });
  return { milestoneId: row.id, status: row.status };
}

// ------------------------------------------------------------------ deliverables
async function criterionOf(client, c, milestone, criterionId, { lock = true } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.project_milestone_criteria WHERE organization_id = $1 AND milestone_id = $2 AND id = $3 AND removed_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [c.organizationId, milestone.id, uuid(criterionId, "Criterion")])).rows[0];
  if (!row) throw err(404, "MILESTONE_NOT_FOUND", "That deliverable is not on this milestone.");
  return row;
}
async function evidenceFileOf(client, c, milestone, fileId) {
  if (!fileId) return null;
  const row = (await client.query(`SELECT id FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND is_current AND lifecycle_status <> 'archived'`,
    [c.organizationId, MILESTONE_ENTITY, milestone.id, uuid(fileId, "Evidence file")])).rows[0];
  if (!row) throw err(400, "MILESTONE_EVIDENCE_MISSING", "Choose a file uploaded to this milestone as the evidence.");
  return row.id;
}
// input: { description, isRequired?, evidenceRequired?, withdrawSubmission?, idempotencyKey? }
export async function addMilestoneCriterion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "edit");
  projectOpen(project);
  const criterion = criterionInput(input);
  const row = await changeScope(client, c, milestone, input, "the deliverables");
  const sequence = Number((await client.query(`SELECT COALESCE(max(sequence), 0) + 1 AS n FROM tenant.project_milestone_criteria WHERE organization_id = $1 AND milestone_id = $2 AND removed_at IS NULL`, [c.organizationId, milestone.id])).rows[0].n);
  const added = (await client.query(`INSERT INTO tenant.project_milestone_criteria (organization_id, milestone_id, sequence, description, is_required, evidence_required, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [c.organizationId, milestone.id, sequence, criterion.description, criterion.isRequired, criterion.evidenceRequired, c.userId ?? null])).rows[0];
  await milestoneEvent(client, c, row, "CRITERION_ADDED", criterion.description, { key: keyOf(input), details: { criterionId: added.id, result: { criterionId: added.id } } });
  return { milestoneId: milestone.id, criterionId: added.id, version: row.row_version };
}
// input: { criterionId, description?, isRequired?, evidenceRequired?, withdrawSubmission?, expectedVersion? (the criterion's), idempotencyKey? }
export async function updateMilestoneCriterion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "edit");
  projectOpen(project);
  const criterion = await criterionOf(client, c, milestone, input.criterionId);
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== criterion.row_version) throw err(409, "MILESTONE_VERSION_CONFLICT");
  const next = criterionInput({ description: input.description ?? criterion.description, isRequired: input.isRequired ?? criterion.is_required, evidenceRequired: input.evidenceRequired ?? criterion.evidence_required });
  if (next.description === criterion.description && next.isRequired === criterion.is_required && next.evidenceRequired === criterion.evidence_required) return { milestoneId: milestone.id, criterionId: criterion.id, changed: false };
  const row = await changeScope(client, c, milestone, input, "the deliverables");
  await client.query(`UPDATE tenant.project_milestone_criteria SET description = $3, is_required = $4, evidence_required = $5, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, criterion.id, next.description, next.isRequired, next.evidenceRequired]);
  await milestoneEvent(client, c, row, "CRITERION_CHANGED", `${criterion.description} → ${next.description}${next.isRequired ? "" : " (optional)"}${next.evidenceRequired ? " (evidence required)" : ""}`, { key: keyOf(input), details: { criterionId: criterion.id } });
  return { milestoneId: milestone.id, criterionId: criterion.id, changed: true };
}
// input: { criterionId, withdrawSubmission?, idempotencyKey? }
export async function removeMilestoneCriterion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "edit");
  projectOpen(project);
  const criterion = await criterionOf(client, c, milestone, input.criterionId);
  const row = await changeScope(client, c, milestone, input, "the deliverables");
  await client.query(`UPDATE tenant.project_milestone_criteria SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, criterion.id, c.userId ?? null]);
  await milestoneEvent(client, c, row, "CRITERION_REMOVED", criterion.description, { key: keyOf(input), details: { criterionId: criterion.id } });
  return { milestoneId: milestone.id, removed: true };
}
// input: { order: [criterionId], withdrawSubmission?, idempotencyKey? }
export async function reorderMilestoneCriteria(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "edit");
  projectOpen(project);
  const live = await criteriaOf(client, c, milestone.id);
  const order = (Array.isArray(input.order) ? input.order : []).map((id) => uuid(id, "Criterion"));
  if (order.length !== live.length || new Set(order).size !== order.length || !order.every((id) => live.some((row) => row.id === id))) throw err(400, "MILESTONE_INPUT_INVALID", "List every deliverable once.");
  const row = await changeScope(client, c, milestone, input, "the order of the deliverables");
  for (const [index, id] of order.entries()) await client.query(`UPDATE tenant.project_milestone_criteria SET sequence = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, id, index + 1]);
  await milestoneEvent(client, c, row, "CRITERIA_REORDERED", "Deliverables reordered", { key: keyOf(input) });
  return { milestoneId: milestone.id, reordered: true };
}
// Done, with evidence when the deliverable asks for it (a file of this milestone, a reference, or both). input: { criterionId, evidenceFileId?, evidenceNote?, idempotencyKey? }
export async function completeMilestoneCriterion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "work");
  projectOpen(project);
  if (project.status === "ON_HOLD") throw err(409, "MILESTONE_PROJECT_ON_HOLD");
  milestoneOpen(milestone);
  if (milestone.status === "SUBMITTED") throw err(409, "MILESTONE_SUBMITTED_LOCKED");
  const criterion = await criterionOf(client, c, milestone, input.criterionId);
  if (criterion.status === "COMPLETED") return { milestoneId: milestone.id, criterionId: criterion.id, replayed: true };
  const fileId = await evidenceFileOf(client, c, milestone, input.evidenceFileId);
  const note = text(input.evidenceNote, 1000) || null;
  if (criterion.evidence_required && !fileId && !note) throw err(400, "MILESTONE_EVIDENCE_MISSING", `"${criterion.description}" needs evidence: attach a file or give a reference.`);
  await client.query(`UPDATE tenant.project_milestone_criteria SET status = 'COMPLETED', evidence_file_id = $3, evidence_note = $4, completed_by = $5, completed_at = clock_timestamp(),
      waived_by = NULL, waived_at = NULL, waiver_reason = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, criterion.id, fileId, note, c.userId ?? null]);
  // Work on a deliverable starts the milestone — unless it still waits for a prerequisite (starting early is an explicit exception).
  const waiting = milestone.status === "NOT_STARTED" && (await prerequisitesOf(client, c, milestone.id)).some((row) => row.status !== "COMPLETED");
  const row = await write(client, c, milestone, milestone.status === "NOT_STARTED" && project.status === "IN_PROGRESS" && !waiting ? { status: "IN_PROGRESS", started_at: new Date() } : {});
  await milestoneEvent(client, c, row, "CRITERION_COMPLETED", criterion.description, { from: milestone.status, to: row.status, key: keyOf(input), details: { criterionId: criterion.id, evidence: Boolean(fileId || note) } });
  return { milestoneId: milestone.id, criterionId: criterion.id, status: row.status };
}
// Back to outstanding (a mistake, or the deliverable needs more work). input: { criterionId, reason?, idempotencyKey? }
export async function reopenMilestoneCriterion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "work");
  projectOpen(project);
  milestoneOpen(milestone);
  if (milestone.status === "SUBMITTED") throw err(409, "MILESTONE_SUBMITTED_LOCKED");
  const criterion = await criterionOf(client, c, milestone, input.criterionId);
  if (criterion.status === "PENDING") return { milestoneId: milestone.id, criterionId: criterion.id, replayed: true };
  if (criterion.status === "WAIVED") need(can, "waive");
  await client.query(`UPDATE tenant.project_milestone_criteria SET status = 'PENDING', completed_by = NULL, completed_at = NULL, waived_by = NULL, waived_at = NULL, waiver_reason = NULL,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, criterion.id]);
  const row = await write(client, c, milestone, {});
  await milestoneEvent(client, c, row, "CRITERION_REOPENED", `${criterion.description}${text(input.reason, 500) ? `: ${text(input.reason, 500)}` : ""}`, { key: keyOf(input), details: { criterionId: criterion.id } });
  return { milestoneId: milestone.id, criterionId: criterion.id };
}
// A required deliverable waived by someone authorized, with the reason. input: { criterionId, reason, idempotencyKey? }
export async function waiveMilestoneCriterion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "waive");
  projectOpen(project);
  milestoneOpen(milestone);
  if (milestone.status === "SUBMITTED") throw err(409, "MILESTONE_SUBMITTED_LOCKED");
  const criterion = await criterionOf(client, c, milestone, input.criterionId);
  if (criterion.status === "WAIVED") return { milestoneId: milestone.id, criterionId: criterion.id, replayed: true };
  const reason = reasonOf(input.reason, "Say why the deliverable is waived.");
  await client.query(`UPDATE tenant.project_milestone_criteria SET status = 'WAIVED', waived_by = $3, waived_at = clock_timestamp(), waiver_reason = $4, completed_by = NULL, completed_at = NULL,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, criterion.id, c.userId ?? null, reason]);
  const row = await write(client, c, milestone, {});
  await milestoneEvent(client, c, row, "CRITERION_WAIVED", `${criterion.description}: ${reason}`, { key: keyOf(input), details: { criterionId: criterion.id, reason } });
  return { milestoneId: milestone.id, criterionId: criterion.id };
}

// ------------------------------------------------------------------ tasks and dependencies
// input: { taskId, isRequired?, withdrawSubmission?, idempotencyKey? }
export async function linkMilestoneTask(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "links");
  projectOpen(project);
  const source = taskSource();
  if (!source) throw err(409, "MILESTONE_TASKS_NOT_AVAILABLE");
  const taskId = uuid(input.taskId, "Task");
  const task = (await source.load(client, c, milestone.project_id, [taskId])).get(taskId);
  if (!task || task.projectId !== milestone.project_id) throw err(400, "MILESTONE_TASK_INVALID", "Link a task of this milestone's project.");
  const taken = (await client.query(`SELECT milestone_id FROM tenant.project_milestone_task_links WHERE organization_id = $1 AND task_id = $2 AND removed_at IS NULL`, [c.organizationId, taskId])).rows[0];
  if (taken) {
    if (taken.milestone_id === milestone.id) return { milestoneId: milestone.id, taskId, replayed: true };
    throw err(409, "MILESTONE_TASK_INVALID", "This task already counts toward another milestone.");
  }
  const required = input.isRequired !== false;
  const row = required ? await changeScope(client, c, milestone, input, "the required tasks") : (milestoneOpen(milestone), await write(client, c, milestone, {}));
  const link = (await client.query(`INSERT INTO tenant.project_milestone_task_links (organization_id, milestone_id, task_id, is_required, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [c.organizationId, milestone.id, taskId, required, c.userId ?? null])).rows[0];
  // The task is filed under this milestone too (Tasks keeps one primary milestone per task).
  await source.attach?.(client, c, taskId, milestone.id);
  await milestoneEvent(client, c, row, "TASK_LINKED", `${task.code ? `${task.code} ` : ""}${task.title}${required ? "" : " (optional)"}`, { key: keyOf(input), details: { taskId, linkId: link.id, result: { linkId: link.id } } });
  return { milestoneId: milestone.id, linkId: link.id };
}
// input: { linkId, isRequired?, disposition?, remove?, withdrawSubmission?, idempotencyKey? } — change a link, record what a cancelled required task means, or unlink.
export async function updateMilestoneTaskLink(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "links");
  projectOpen(project);
  const link = (await client.query(`SELECT * FROM tenant.project_milestone_task_links WHERE organization_id = $1 AND milestone_id = $2 AND id = $3 AND removed_at IS NULL`,
    [c.organizationId, milestone.id, uuid(input.linkId, "Task link")])).rows[0];
  if (!link) throw err(404, "MILESTONE_NOT_FOUND", "That task is not linked to this milestone.");
  const row = await changeScope(client, c, milestone, input, "the linked tasks");
  if (input.remove) {
    await client.query(`UPDATE tenant.project_milestone_task_links SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, link.id, c.userId ?? null]);
    await taskSource()?.attach?.(client, c, link.task_id, null);
    await milestoneEvent(client, c, row, "TASK_UNLINKED", "Task unlinked", { key: keyOf(input), details: { taskId: link.task_id } });
    return { milestoneId: milestone.id, removed: true };
  }
  const required = input.isRequired === undefined ? link.is_required : Boolean(input.isRequired);
  const disposition = input.disposition === undefined ? link.disposition : text(input.disposition, 500) || null;
  await client.query(`UPDATE tenant.project_milestone_task_links SET is_required = $3, disposition = $4 WHERE organization_id = $1 AND id = $2`, [c.organizationId, link.id, required, disposition]);
  await milestoneEvent(client, c, row, "TASK_LINK_CHANGED", `${required ? "Required" : "Optional"}${disposition ? `; disposition: ${disposition}` : ""}`, { key: keyOf(input), details: { taskId: link.task_id } });
  return { milestoneId: milestone.id, linkId: link.id };
}
async function insertDependency(client, c, milestone, prerequisiteId) {
  const id = uuid(prerequisiteId, "Prerequisite milestone");
  const prerequisite = (await client.query(`SELECT * FROM tenant.project_milestones WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!prerequisite || prerequisite.project_id !== milestone.project_id) throw err(400, "MILESTONE_DEPENDENCY_INVALID", "A prerequisite must be a milestone of the same project.");
  if (prerequisite.id === milestone.id) throw err(400, "MILESTONE_DEPENDENCY_INVALID", "A milestone cannot depend on itself.");
  if (prerequisite.status === "CANCELLED") throw err(400, "MILESTONE_DEPENDENCY_INVALID", "A cancelled milestone cannot be a prerequisite.");
  const exists = (await client.query(`SELECT 1 FROM tenant.project_milestone_dependencies WHERE milestone_id = $1 AND prerequisite_id = $2 AND removed_at IS NULL`, [milestone.id, prerequisite.id])).rows[0];
  if (exists) throw err(409, "MILESTONE_DEPENDENCY_INVALID", `${milestone.milestone_code} already depends on ${prerequisite.milestone_code}.`);
  // A milestone already under review or done cannot pick up a prerequisite that is still open.
  if (["SUBMITTED", "COMPLETED"].includes(milestone.status) && prerequisite.status !== "COMPLETED")
    throw err(409, "MILESTONE_DEPENDENCY_INVALID", `${milestone.milestone_code} is ${MILESTONE_STATUS_LABEL[milestone.status].toLowerCase()}; it cannot wait for ${prerequisite.milestone_code}.`);
  const edges = (await client.query(`SELECT dependency.milestone_id, dependency.prerequisite_id FROM tenant.project_milestone_dependencies dependency
     JOIN tenant.project_milestones milestone ON milestone.id = dependency.milestone_id WHERE dependency.organization_id = $1 AND milestone.project_id = $2 AND dependency.removed_at IS NULL`,
    [c.organizationId, milestone.project_id])).rows.map((row) => [row.milestone_id, row.prerequisite_id]);
  if (createsCycle(edges, milestone.id, prerequisite.id)) throw err(409, "MILESTONE_DEPENDENCY_CYCLE", `${prerequisite.milestone_code} already depends (directly or not) on ${milestone.milestone_code}.`);
  const row = (await client.query(`INSERT INTO tenant.project_milestone_dependencies (organization_id, milestone_id, prerequisite_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [c.organizationId, milestone.id, prerequisite.id, c.userId ?? null])).rows[0];
  await milestoneEvent(client, c, milestone, "DEPENDENCY_ADDED", `Depends on ${prerequisite.milestone_code} ${prerequisite.name}`, { details: { prerequisiteId: prerequisite.id } });
  return row.id;
}
// input: { prerequisiteId, idempotencyKey? }
export async function addMilestoneDependency(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "links");
  projectOpen(project);
  if (milestone.status === "CANCELLED") throw err(409, "MILESTONE_STATUS_INVALID", "This milestone is cancelled.");
  const dependencyId = await insertDependency(client, c, milestone, input.prerequisiteId);
  await write(client, c, milestone, {});
  if (keyOf(input)) await milestoneEvent(client, c, milestone, "DEPENDENCY_CONFIRMED", null, { key: keyOf(input), details: { result: { dependencyId } } });
  return { milestoneId: milestone.id, dependencyId };
}
// input: { dependencyId, idempotencyKey? }
export async function removeMilestoneDependency(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "links");
  projectOpen(project);
  const row = (await client.query(`SELECT dependency.*, prerequisite.milestone_code FROM tenant.project_milestone_dependencies dependency JOIN tenant.project_milestones prerequisite ON prerequisite.id = dependency.prerequisite_id
     WHERE dependency.organization_id = $1 AND dependency.milestone_id = $2 AND dependency.id = $3`, [c.organizationId, milestone.id, uuid(input.dependencyId, "Dependency")])).rows[0];
  if (!row) throw err(404, "MILESTONE_NOT_FOUND", "That dependency is not on this milestone.");
  if (row.removed_at) return { milestoneId: milestone.id, removed: true, replayed: true };
  await client.query(`UPDATE tenant.project_milestone_dependencies SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
  await write(client, c, milestone, {});
  await milestoneEvent(client, c, milestone, "DEPENDENCY_REMOVED", `No longer depends on ${row.milestone_code}`, { key: keyOf(input), details: { prerequisiteId: row.prerequisite_id } });
  return { milestoneId: milestone.id, removed: true };
}

// ------------------------------------------------------------------ submission and decisions
async function snapshotOf(client, c, milestone, readiness) {
  const files = (await client.query(`SELECT id, file_name, content_sha256 FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND is_current AND lifecycle_status <> 'archived'`,
    [c.organizationId, MILESTONE_ENTITY, milestone.id])).rows;
  return {
    milestone: { code: milestone.milestone_code, name: milestone.name, description: milestone.description, dueDate: day(milestone.current_due_date), ownerUserId: milestone.owner_user_id,
      internalApprovalRequired: milestone.internal_approval_required, customerAcceptanceRequired: milestone.customer_acceptance_required, customerContactId: milestone.customer_contact_id },
    criteria: readiness.criteria.map((row) => ({ id: row.id, description: row.description, required: row.is_required, evidenceRequired: row.evidence_required, status: row.status,
      evidenceFileId: row.evidence_file_id, evidenceNote: row.evidence_note, waiverReason: row.waiver_reason })),
    tasks: readiness.tasks === null ? null : readiness.tasks.map((row) => ({ taskId: row.task_id, required: row.is_required, title: row.task?.title ?? null, status: row.task?.status ?? null,
      completed: Boolean(row.task?.completed), disposition: row.disposition })),
    files: files.map((row) => ({ id: row.id, fileName: row.file_name, sha256: row.content_sha256 })),
    prerequisites: readiness.prerequisites.map((row) => ({ id: row.id, code: row.milestone_code, status: row.status })),
  };
}
// In progress → Submitted, as an immutable snapshot of what is reviewed. input: { note?, dependencyException?, expectedVersion?, idempotencyKey? }
export async function submitProjectMilestone(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "submit");
  versionCheck(milestone, input.expectedVersion);
  if (milestone.status === "SUBMITTED") return { milestoneId: milestone.id, status: milestone.status, replayed: true };
  projectWorking(project);
  milestoneOpen(milestone);
  if (!needsApproval(milestone)) throw err(409, "MILESTONE_APPROVAL_NOT_NEEDED");
  if (milestone.status !== "IN_PROGRESS") throw err(409, "MILESTONE_STATUS_INVALID", milestone.status === "BLOCKED" ? "Resolve the open blockers first." : "Start the milestone before submitting it.");
  if (milestone.customer_acceptance_required && !milestone.customer_contact_id) throw err(400, "MILESTONE_CUSTOMER_CONTACT_INVALID", "Choose the customer contact who accepts this milestone first.");
  const exceptions = {};
  if (input.dependencyException) { need(can, "waive"); exceptions.dependencies = reasonOf(input.dependencyException); }
  const readiness = await readinessFor(client, c, milestone, project, { stage: "submit", exceptions });
  const failing = readiness.checks.filter((row) => row.blocking);
  if (failing.length) throw readinessError(failing, readiness.checks);
  const number = Number((await client.query(`SELECT COALESCE(max(submission_number), 0) + 1 AS n FROM tenant.project_milestone_submissions WHERE milestone_id = $1`, [milestone.id])).rows[0].n);
  const snapshot = await snapshotOf(client, c, milestone, readiness);
  const submission = (await client.query(`INSERT INTO tenant.project_milestone_submissions (organization_id, milestone_id, submission_number, scope_version, snapshot, note, submitted_by)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`, [c.organizationId, milestone.id, number, milestone.scope_version, JSON.stringify(snapshot), text(input.note, 2000) || null, c.userId ?? null])).rows[0];
  const row = await write(client, c, milestone, { status: "SUBMITTED", approval_status: "PENDING", current_submission_id: submission.id, submitted_at: new Date() });
  await milestoneEvent(client, c, row, "SUBMITTED", `Submission ${number} for review${exceptions.dependencies ? ` (prerequisite exception: ${exceptions.dependencies})` : ""}`,
    { from: "IN_PROGRESS", to: "SUBMITTED", key: keyOf(input), details: { submissionId: submission.id, number, result: { submissionId: submission.id } } });
  await notify(client, c, row, [project.manager_user_id], { title: `${row.milestone_code} was submitted for review`, message: `${row.name}${text(input.note, 200) ? `: ${text(input.note, 200)}` : ""}` });
  return { milestoneId: row.id, status: row.status, submissionId: submission.id, submissionNumber: number };
}
// Submitted → In progress, the submission kept in the history (to change what is reviewed). input: { reason?, idempotencyKey? }
export async function withdrawMilestoneSubmission(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  if (!can.submit && !can.edit) throw err(403, "MILESTONE_PERMISSION_DENIED");
  projectOpen(project);
  if (milestone.status !== "SUBMITTED") throw err(409, "MILESTONE_STATUS_INVALID", "Only a submitted milestone is withdrawn.");
  const row = await write(client, c, milestone, { status: "IN_PROGRESS", approval_status: "NOT_SUBMITTED", scope_version: milestone.scope_version + 1 });
  await milestoneEvent(client, c, row, "SUBMISSION_WITHDRAWN", `Submission withdrawn${text(input.reason, 500) ? `: ${text(input.reason, 500)}` : ""}`, { from: "SUBMITTED", to: "IN_PROGRESS", key: keyOf(input) });
  return { milestoneId: row.id, status: row.status };
}
function readinessError(failing, checks) {
  const first = failing[0];
  const code = { criteria: "MILESTONE_CRITERIA_INCOMPLETE", evidence: "MILESTONE_EVIDENCE_MISSING", tasks: "MILESTONE_REQUIRED_TASKS_OPEN", dependencies: "MILESTONE_DEPENDENCY_OPEN",
    blockers: "MILESTONE_BLOCKED", internal: "MILESTONE_APPROVAL_REQUIRED", customer: "MILESTONE_CUSTOMER_ACCEPTANCE_REQUIRED",
    project: first.message.includes("Hold") ? "MILESTONE_PROJECT_ON_HOLD" : "MILESTONE_STATUS_INVALID" }[first.key] ?? "MILESTONE_STATUS_INVALID";
  return err(409, code, failing.map((row) => row.message).join(" "), { checks });
}
// The internal decision on the current submission. APPROVED keeps it submitted until every required decision is in; CHANGES_REQUESTED and
// REJECTED return it to In progress (the submission stays in the history). Whoever submitted does not approve unless the company allows it.
// input: { decision: APPROVED | CHANGES_REQUESTED | REJECTED, note?, expectedVersion?, idempotencyKey? }
export async function recordMilestoneApproval(client, c, milestoneId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT milestone_id, decision FROM tenant.project_milestone_approvals WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { milestoneId: existing.milestone_id, decision: existing.decision, replayed: true };
  }
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "approve");
  versionCheck(milestone, input.expectedVersion);
  projectOpen(project);
  if (milestone.status !== "SUBMITTED") throw err(409, "MILESTONE_STATUS_INVALID", "Only a submitted milestone is reviewed.");
  if (!milestone.internal_approval_required) throw err(409, "MILESTONE_INPUT_INVALID", "This milestone needs no internal approval.");
  const decision = enumOf(input.decision, ["APPROVED", "CHANGES_REQUESTED", "REJECTED"], null, "Approve, ask for changes or reject.", "decision");
  if (!decision) throw err(400, "MILESTONE_INPUT_INVALID", "Approve, ask for changes or reject.", { field: "decision" });
  const note = text(input.note, 2000) || null;
  if (decision !== "APPROVED" && (!note || note.length < 3)) throw err(400, "MILESTONE_REASON_REQUIRED", "Say what needs to change.");
  const submission = (await client.query(`SELECT * FROM tenant.project_milestone_submissions WHERE id = $1`, [milestone.current_submission_id])).rows[0];
  if (!submission || submission.scope_version !== milestone.scope_version) throw err(409, "MILESTONE_APPROVAL_STALE");
  const self = (await client.query(`SELECT milestone_self_approval_allowed FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.milestone_self_approval_allowed ?? false;
  if (!self && submission.submitted_by && submission.submitted_by === c.userId) throw err(403, "MILESTONE_SELF_APPROVAL");
  const already = (await client.query(`SELECT 1 FROM tenant.project_milestone_approvals WHERE submission_id = $1 AND reviewer_type = 'INTERNAL'`, [submission.id])).rows[0];
  if (already) throw err(409, "MILESTONE_ALREADY_DECIDED");
  await client.query(`INSERT INTO tenant.project_milestone_approvals (organization_id, milestone_id, submission_id, reviewer_type, decision, note, recorded_by, idempotency_key) VALUES ($1,$2,$3,'INTERNAL',$4,$5,$6,$7)`,
    [c.organizationId, milestone.id, submission.id, decision, note, c.userId ?? null, key]);
  return afterDecision(client, c, milestone, project, "INTERNAL", decision, note, submission);
}
// The customer's decision, recorded from the evidence received (a signed document, an email): who decided and when, and the evidence. It is a
// record of an external decision — nobody is treated as the customer for pressing a button here. input: { customerContactId?, decision?,
// decisionDate, evidenceFileId?, evidenceReference?, note?, expectedVersion?, idempotencyKey? }
export async function recordCustomerAcceptanceEvidence(client, c, milestoneId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT milestone_id, decision FROM tenant.project_milestone_approvals WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { milestoneId: existing.milestone_id, decision: existing.decision, replayed: true };
  }
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "customer");
  versionCheck(milestone, input.expectedVersion);
  projectOpen(project);
  if (milestone.status !== "SUBMITTED") throw err(409, "MILESTONE_STATUS_INVALID", "Submit the milestone before recording the customer's decision.");
  if (!milestone.customer_acceptance_required) throw err(409, "MILESTONE_INPUT_INVALID", "This milestone needs no customer acceptance.");
  const contact = await acceptanceContactOf(client, c, project, input.customerContactId ?? milestone.customer_contact_id);
  const decision = enumOf(input.decision, ["APPROVED", "CHANGES_REQUESTED", "REJECTED"], "APPROVED", "Record accepted, changes requested or rejected.", "decision");
  if (!input.decisionDate) throw err(400, "MILESTONE_DATE_INVALID", "Give the date of the customer's decision.", { field: "decisionDate" });
  const decided = isoDay(input.decisionDate);
  const submission = (await client.query(`SELECT * FROM tenant.project_milestone_submissions WHERE id = $1`, [milestone.current_submission_id])).rows[0];
  if (!submission || submission.scope_version !== milestone.scope_version) throw err(409, "MILESTONE_APPROVAL_STALE");
  if (decided > await orgDay(client, c)) throw err(400, "MILESTONE_DATE_INVALID", "The customer's decision cannot be in the future.", { field: "decisionDate" });
  const submittedDay = (await client.query(`SELECT to_char((submitted_at AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d
     FROM tenant.project_milestone_submissions WHERE id = $2`, [c.organizationId, submission.id])).rows[0].d;
  if (decided < submittedDay) throw err(400, "MILESTONE_DATE_INVALID", "The customer decided before the milestone was submitted: record the decision on what they reviewed.", { field: "decisionDate" });
  const fileId = await evidenceFileOf(client, c, milestone, input.evidenceFileId);
  const reference = text(input.evidenceReference, 500) || null;
  if (!fileId && (!reference || reference.length < 3)) throw err(400, "MILESTONE_EVIDENCE_MISSING", "Attach the customer's sign-off or give the reference of the communication.");
  const note = text(input.note, 2000) || null;
  if (decision !== "APPROVED" && (!note || note.length < 3)) throw err(400, "MILESTONE_REASON_REQUIRED", "Say what the customer asked to change.");
  const already = (await client.query(`SELECT 1 FROM tenant.project_milestone_approvals WHERE submission_id = $1 AND reviewer_type = 'CUSTOMER'`, [submission.id])).rows[0];
  if (already) throw err(409, "MILESTONE_ALREADY_DECIDED");
  await client.query(`INSERT INTO tenant.project_milestone_approvals (organization_id, milestone_id, submission_id, reviewer_type, decision, note, customer_contact_id, customer_decision_date,
      evidence_file_id, evidence_reference, recorded_by, idempotency_key) VALUES ($1,$2,$3,'CUSTOMER',$4,$5,$6,$7,$8,$9,$10,$11)`,
    [c.organizationId, milestone.id, submission.id, decision, note, contact, decided, fileId, reference, c.userId ?? null, key]);
  return afterDecision(client, c, milestone, project, "CUSTOMER", decision, note, submission);
}
async function afterDecision(client, c, milestone, project, reviewer, decision, note, submission) {
  const approvals = await approvalsOf(client, c, milestone.id);
  const state = approvalAfter(milestone, approvals);
  const sets = { approval_status: state };
  if (state === "CHANGES_REQUESTED" || state === "REJECTED") sets.status = "IN_PROGRESS";
  const row = await write(client, c, milestone, sets);
  const who = reviewer === "CUSTOMER" ? "Customer" : "Internal review";
  const verb = { APPROVED: reviewer === "CUSTOMER" ? "accepted" : "approved", CHANGES_REQUESTED: "asked for changes", REJECTED: "rejected" }[decision];
  await milestoneEvent(client, c, row, reviewer === "CUSTOMER" ? "CUSTOMER_DECISION" : "REVIEWED", `${who} ${verb} submission ${submission.submission_number}${note ? `: ${note}` : ""}`,
    { from: milestone.status, to: row.status, details: { decision, reviewer, submissionId: submission.id, approvalStatus: state } });
  const submitter = submission.submitted_by;
  await notify(client, c, row, [row.owner_user_id, submitter, project.manager_user_id], {
    title: decision === "APPROVED" ? `${row.milestone_code}: ${who.toLowerCase()} ${verb}` : `${row.milestone_code}: changes requested`,
    message: state === "APPROVED" ? `${row.name} is approved and can be completed.` : note ?? row.name,
  });
  return { milestoneId: row.id, status: row.status, approvalStatus: state, decision };
}

// ------------------------------------------------------------------ completion, reopening, cancelling
// The authoritative completion: every condition holds (deliverables, evidence, tasks, prerequisites, blockers, approvals on the current scope).
// input: { completionDate?, note?, dependencyException?, expectedVersion?, idempotencyKey? }
export async function completeProjectMilestone(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "complete");
  versionCheck(milestone, input.expectedVersion);
  if (milestone.status === "COMPLETED") throw err(409, "MILESTONE_ALREADY_COMPLETED");
  if (milestone.status === "CANCELLED") throw err(409, "MILESTONE_STATUS_INVALID", "This milestone is cancelled.");
  projectWorking(project);
  if (needsApproval(milestone)) {
    if (milestone.status !== "SUBMITTED") throw err(409, "MILESTONE_APPROVAL_REQUIRED", "Submit the milestone for approval first.");
    const submission = (await client.query(`SELECT scope_version FROM tenant.project_milestone_submissions WHERE id = $1`, [milestone.current_submission_id])).rows[0];
    if (!submission || submission.scope_version !== milestone.scope_version) throw err(409, "MILESTONE_APPROVAL_STALE");
  } else if (!["NOT_STARTED", "IN_PROGRESS"].includes(milestone.status)) throw err(409, "MILESTONE_BLOCKED");
  const exceptions = {};
  if (input.dependencyException) { need(can, "waive"); exceptions.dependencies = reasonOf(input.dependencyException); }
  const readiness = await readinessFor(client, c, milestone, project, { stage: "complete", exceptions });
  const failing = readiness.checks.filter((row) => row.blocking);
  if (failing.length) throw readinessError(failing, readiness.checks);
  const today = await orgDay(client, c);
  const completionDate = input.completionDate ? isoDay(input.completionDate) : today;
  if (completionDate > today) throw err(400, "MILESTONE_DATE_INVALID", "The completion date cannot be in the future.", { field: "completionDate" });
  const completedAt = completionDate === today ? new Date() : new Date(`${completionDate}T12:00:00Z`);
  const row = await write(client, c, milestone, { status: "COMPLETED", completed_at: completedAt, completed_by: c.userId ?? null,
    approved_submission_id: needsApproval(milestone) ? milestone.current_submission_id : null, previous_status: null });
  await milestoneEvent(client, c, row, "COMPLETED", `Completed on ${completionDate}${text(input.note, 500) ? `: ${text(input.note, 500)}` : ""}${exceptions.dependencies ? ` (prerequisite exception: ${exceptions.dependencies})` : ""}`,
    { from: milestone.status, to: "COMPLETED", key: keyOf(input), details: { completionDate, submissionId: milestone.current_submission_id } });
  await projectEvent(client, c, project.id, "MILESTONE_COMPLETED", `${row.milestone_code} ${row.name} completed`);
  const team = (await client.query(`SELECT user_id FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND left_at IS NULL AND role = 'MANAGER'`, [c.organizationId, project.id])).rows.map((r) => r.user_id);
  await notify(client, c, row, [project.manager_user_id, row.owner_user_id, ...team], { title: `${row.milestone_code} completed`,
    message: `${row.name} was completed on ${completionDate}.${row.sales_order_id ? " Its billing can now be requested from Sales." : ""}` });
  return { milestoneId: row.id, status: "COMPLETED", completionDate, billingEligible: Boolean(row.sales_order_id) };
}
// Completed → In progress, with a reason. The original completion, submissions and decisions stay in the history; a billing request stays with
// Sales (never cancelled here); milestones depending on it are reviewed. input: { reason, acknowledgeDependents?, acknowledgeBilling?, expectedVersion?, idempotencyKey? }
export async function reopenProjectMilestone(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "reopen");
  versionCheck(milestone, input.expectedVersion);
  projectOpen(project);
  if (milestone.status !== "COMPLETED") throw err(409, "MILESTONE_STATUS_INVALID", "Only a completed milestone is reopened.");
  const reason = reasonOf(input.reason, "Say why the milestone is reopened.");
  const dependents = (await dependentsOf(client, c, milestone.id)).filter((row) => ["SUBMITTED", "COMPLETED", "IN_PROGRESS"].includes(row.status));
  if (dependents.length && !input.acknowledgeDependents) throw err(409, "MILESTONE_DEPENDENTS_EXIST", `${dependents.map((row) => `${row.milestone_code} (${MILESTONE_STATUS_LABEL[row.status].toLowerCase()})`).join(", ")} depend on it.`,
    { dependents: dependents.map((row) => ({ id: row.id, code: row.milestone_code, status: row.status })) });
  const billing = await billingRequestOf(client, c, milestone.id);
  if (billing && !input.acknowledgeBilling) throw err(409, "MILESTONE_BILLING_REQUESTED", undefined, { billing: { status: billing.status } });
  const row = await write(client, c, milestone, { status: "IN_PROGRESS", completed_at: null, completed_by: null, approved_submission_id: null, scope_version: milestone.scope_version + 1,
    approval_status: needsApproval(milestone) ? "NOT_SUBMITTED" : "NOT_REQUIRED" });
  await milestoneEvent(client, c, row, "REOPENED", `Reopened (completed ${milestone.completed_at ? isoDay(milestone.completed_at) : ""}): ${reason}${billing ? " — the billing request stays with Sales" : ""}`,
    { from: "COMPLETED", to: "IN_PROGRESS", key: keyOf(input), details: { reason, previousCompletion: milestone.completed_at, dependents: dependents.map((r) => r.milestone_code), billingRequest: billing?.status ?? null } });
  await projectEvent(client, c, project.id, "MILESTONE_REOPENED", `${row.milestone_code} ${row.name} reopened: ${reason}`);
  await notify(client, c, row, [row.owner_user_id, project.manager_user_id], { title: `${row.milestone_code} reopened`, message: reason });
  return { milestoneId: row.id, status: row.status };
}
// Any open milestone → Cancelled, with a reason. Linked tasks are untouched; milestones that depend on it no longer wait for it (each is told);
// they are reviewed first. input: { reason, acknowledgeDependents?, expectedVersion?, idempotencyKey? }
export async function cancelProjectMilestone(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "cancel");
  versionCheck(milestone, input.expectedVersion);
  if (milestone.status === "CANCELLED") return { milestoneId: milestone.id, status: milestone.status, replayed: true };
  if (milestone.status === "COMPLETED") throw err(409, "MILESTONE_ALREADY_COMPLETED", "A completed milestone is reopened, not cancelled.");
  projectOpen(project);
  const reason = reasonOf(input.reason, "Say why the milestone is cancelled.");
  const dependents = (await dependentsOf(client, c, milestone.id)).filter((row) => row.status !== "CANCELLED");
  if (dependents.length && !input.acknowledgeDependents) throw err(409, "MILESTONE_DEPENDENTS_EXIST", `${dependents.map((row) => row.milestone_code).join(", ")} depend on it.`,
    { dependents: dependents.map((row) => ({ id: row.id, code: row.milestone_code, status: row.status })) });
  for (const dependent of dependents) {
    await client.query(`UPDATE tenant.project_milestone_dependencies SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, dependent.dependency_id, c.userId ?? null]);
    await milestoneEvent(client, c, dependent, "DEPENDENCY_REMOVED", `No longer waits for ${milestone.milestone_code}: it was cancelled (${reason})`, { details: { prerequisiteId: milestone.id } });
  }
  await client.query(`UPDATE tenant.project_milestone_blockers SET status = 'RESOLVED', resolution = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE organization_id = $1 AND milestone_id = $2 AND status = 'OPEN'`,
    [c.organizationId, milestone.id, `Milestone cancelled: ${reason}`.slice(0, 1000), c.userId ?? null]);
  const row = await write(client, c, milestone, { status: "CANCELLED", cancelled_at: new Date(), cancelled_by: c.userId ?? null, cancel_reason: reason, previous_status: null });
  await milestoneEvent(client, c, row, "CANCELLED", reason, { from: milestone.status, to: "CANCELLED", key: keyOf(input), details: { dependents: dependents.map((r) => r.milestone_code) } });
  await projectEvent(client, c, project.id, "MILESTONE_CANCELLED", `${row.milestone_code} ${row.name} cancelled: ${reason}`);
  await notify(client, c, row, [row.owner_user_id, project.manager_user_id, ...dependents.map((r) => r.owner_user_id)], { title: `${row.milestone_code} cancelled`, message: reason });
  return { milestoneId: row.id, status: "CANCELLED" };
}
// Let the project complete without this milestone (an explicit, authorized exception). input: { reason, idempotencyKey? }
export async function waiveMilestoneForProjectCompletion(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "waive");
  projectOpen(project);
  milestoneOpen(milestone);
  if (milestone.waived_at) return { milestoneId: milestone.id, waived: true, replayed: true };
  const reason = reasonOf(input.reason, "Say why the project may complete without this milestone.");
  const row = await write(client, c, milestone, { waived_at: new Date(), waived_by: c.userId ?? null, waiver_reason: reason });
  await milestoneEvent(client, c, row, "WAIVED_FOR_COMPLETION", reason, { key: keyOf(input), details: { reason } });
  await projectEvent(client, c, project.id, "MILESTONE_WAIVED", `${row.milestone_code} ${row.name} waived for project completion: ${reason}`);
  return { milestoneId: row.id, waived: true };
}

// ------------------------------------------------------------------ billing handoff (Sales owns the invoice)
// The Sales commercial stage the milestone bills against: a sales order linked to the project, of the project's customer, and optionally one of
// its lines (in the order's current version). input: { salesOrderId | null, salesOrderLineId?, reference?, idempotencyKey? }
export async function setMilestoneBillingStage(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "links");
  projectOpen(project);
  if (milestone.status === "CANCELLED") throw err(409, "MILESTONE_STATUS_INVALID", "This milestone is cancelled.");
  if (await billingRequestOf(client, c, milestone.id)) throw err(409, "MILESTONE_BILLING_ALREADY_REQUESTED", "Its billing was already requested: the stage stays as Sales received it.");
  if (!input.salesOrderId) {
    const row = await write(client, c, milestone, { sales_order_id: null, sales_order_line_id: null, billing_reference: null });
    await milestoneEvent(client, c, row, "BILLING_STAGE_CLEARED", "Billing stage removed", { key: keyOf(input) });
    return { milestoneId: row.id, salesOrderId: null };
  }
  if (project.classification !== "CUSTOMER" || !project.customer_id) throw err(409, "MILESTONE_BILLING_BLOCKED", "Only a customer project's milestones bill against a sales order.");
  const orderId = uuid(input.salesOrderId, "Sales order");
  const order = (await client.query(`SELECT id, sales_order_number, party_id, lifecycle_status, current_version_id FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [c.organizationId, orderId])).rows[0];
  if (!order) throw err(400, "MILESTONE_BILLING_BLOCKED", "That sales order could not be found.");
  if (order.party_id !== project.customer_id) throw err(400, "MILESTONE_BILLING_BLOCKED", "The sales order belongs to a different customer.");
  if (["cancelled", "draft"].includes(String(order.lifecycle_status).toLowerCase())) throw err(400, "MILESTONE_BILLING_BLOCKED", "Choose a confirmed sales order.");
  const linked = (await client.query(`SELECT 1 FROM tenant.project_links WHERE organization_id = $1 AND project_id = $2 AND source_type = 'SALES_ORDER' AND source_id = $3 AND removed_at IS NULL`,
    [c.organizationId, project.id, order.id])).rows[0];
  if (!linked) throw err(400, "MILESTONE_BILLING_BLOCKED", "Link the sales order to the project first.");
  let lineId = null;
  if (input.salesOrderLineId) {
    const line = (await client.query(`SELECT id FROM tenant.sales_order_lines WHERE organization_id = $1 AND id = $2 AND sales_order_version_id = $3`, [c.organizationId, uuid(input.salesOrderLineId, "Sales order line"), order.current_version_id])).rows[0];
    if (!line) throw err(400, "MILESTONE_BILLING_BLOCKED", "Choose a line of the sales order's current version.");
    lineId = line.id;
    const taken = (await client.query(`SELECT milestone_code FROM tenant.project_milestones WHERE organization_id = $1 AND sales_order_line_id = $2 AND id <> $3 AND status <> 'CANCELLED'`, [c.organizationId, lineId, milestone.id])).rows[0];
    if (taken) throw err(409, "MILESTONE_BILLING_BLOCKED", `That line already bills milestone ${taken.milestone_code}.`);
  }
  const reference = text(input.reference, 200) || null;
  const row = await write(client, c, milestone, { sales_order_id: order.id, sales_order_line_id: lineId, billing_reference: reference });
  await milestoneEvent(client, c, row, "BILLING_STAGE_SET", `Bills against ${order.sales_order_number}${reference ? ` · ${reference}` : ""}`, { key: keyOf(input), details: { salesOrderId: order.id, salesOrderLineId: lineId } });
  return { milestoneId: row.id, salesOrderId: order.id, salesOrderLineId: lineId };
}
// A completed milestone's billing handed to Sales, once: a non-financial request that Sales reviews and invoices (or not). Nothing financial
// happens here. input: { note?, idempotencyKey? }
export async function requestMilestoneBilling(client, c, milestoneId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "billingRequest");
  if (milestone.status !== "COMPLETED") throw err(409, "MILESTONE_BILLING_BLOCKED", "Complete the milestone before requesting its billing.");
  if (!milestone.sales_order_id) throw err(409, "MILESTONE_BILLING_BLOCKED", "Choose the sales order (and billing stage) the milestone bills against.");
  if (await billingRequestOf(client, c, milestone.id)) throw err(409, "MILESTONE_BILLING_ALREADY_REQUESTED");
  const order = (await client.query(`SELECT id, sales_order_number, party_id, lifecycle_status, current_version_id, created_by, owner_user_id FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [c.organizationId, milestone.sales_order_id])).rows[0];
  if (!order || order.party_id !== project.customer_id || String(order.lifecycle_status).toLowerCase() === "cancelled") throw err(409, "MILESTONE_BILLING_BLOCKED");
  let lineId = milestone.sales_order_line_id;
  if (lineId) {
    const line = await currentLineOf(client, c, order, lineId);
    if (!line || !line.current) throw err(409, "MILESTONE_BILLING_BLOCKED", "The billing stage line is no longer on the sales order's current version: choose it again.");
    lineId = line.id;
  }
  const request = (await client.query(`INSERT INTO tenant.project_milestone_billing_requests (organization_id, milestone_id, project_id, sales_order_id, sales_order_line_id, submission_id, note, requested_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
    [c.organizationId, milestone.id, project.id, order.id, lineId, milestone.approved_submission_id, text(input.note, 1000) || null, c.userId ?? null])).rows[0];
  if (!request) throw err(409, "MILESTONE_BILLING_ALREADY_REQUESTED");
  await milestoneEvent(client, c, milestone, "BILLING_REQUESTED", `Billing requested from Sales on ${order.sales_order_number}`, { key: keyOf(input), details: { requestId: request.id, salesOrderId: order.id, result: { requestId: request.id } } });
  await projectEvent(client, c, project.id, "MILESTONE_BILLING_REQUESTED", `${milestone.milestone_code} billing requested on ${order.sales_order_number}`);
  await notify(client, c, milestone, [order.owner_user_id, order.created_by, project.manager_user_id], { category: "project_milestone_billing", title: `Billing request: ${milestone.milestone_code}`,
    message: `${milestone.name} is complete and may be invoiced on ${order.sales_order_number}. Sales reviews the invoice details and taxes.` });
  return { milestoneId: milestone.id, requestId: request.id, status: "OPEN" };
}
// The project withdraws its request (made by mistake); Sales acknowledges one it has taken up. Neither touches an invoice. input: { note }
export async function withdrawMilestoneBilling(client, c, milestoneId, input = {}) {
  const { milestone, can } = await milestoneScope(client, c, milestoneId, { lock: true });
  need(can, "billingRequest");
  const request = await billingRequestOf(client, c, milestone.id);
  if (!request) return { milestoneId: milestone.id, replayed: true };
  if (request.status !== "OPEN") throw err(409, "MILESTONE_BILLING_BLOCKED", "Sales already took up this request; any change goes through Sales.");
  const note = reasonOf(input.note, "Say why the billing request is withdrawn.");
  await client.query(`UPDATE tenant.project_milestone_billing_requests SET status = 'WITHDRAWN', closed_by = $3, closed_at = clock_timestamp(), close_note = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, request.id, c.userId ?? null, note]);
  await milestoneEvent(client, c, milestone, "BILLING_WITHDRAWN", note, { details: { requestId: request.id } });
  return { milestoneId: milestone.id, status: "WITHDRAWN" };
}
export async function acknowledgeMilestoneBilling(client, c, milestoneId, input = {}) {
  const { milestone } = await milestoneScope(client, c, milestoneId, { lock: true });
  if (!has(c, "sales.invoice.create")) throw err(403, "MILESTONE_PERMISSION_DENIED");
  const request = await billingRequestOf(client, c, milestone.id);
  if (!request) throw err(404, "MILESTONE_NOT_FOUND", "There is no billing request.");
  if (request.status === "ACKNOWLEDGED") return { milestoneId: milestone.id, status: "ACKNOWLEDGED", replayed: true };
  await client.query(`UPDATE tenant.project_milestone_billing_requests SET status = 'ACKNOWLEDGED', closed_by = $3, closed_at = clock_timestamp(), close_note = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, request.id, c.userId ?? null, text(input.note, 1000) || null]);
  await milestoneEvent(client, c, milestone, "BILLING_ACKNOWLEDGED", `Sales took up the billing request${text(input.note, 300) ? `: ${text(input.note, 300)}` : ""}`, { details: { requestId: request.id } });
  return { milestoneId: milestone.id, status: "ACKNOWLEDGED" };
}

// ------------------------------------------------------------------ notes and files
export async function addMilestoneNote(client, c, milestoneId, input = {}) {
  const { milestone, access } = await milestoneScope(client, c, milestoneId);
  if (!access.can.contribute) throw err(403, "MILESTONE_PERMISSION_DENIED");
  const body = text(input.body, 5000);
  if (!body) throw err(400, "MILESTONE_INPUT_INVALID", "Write the note.", { field: "body" });
  const row = (await client.query(`INSERT INTO tenant.project_notes (organization_id, project_id, milestone_id, body, author_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [c.organizationId, milestone.project_id, milestone.id, body, c.userId ?? null])).rows[0];
  await milestoneEvent(client, c, milestone, "NOTE_ADDED", body.slice(0, 200));
  return { milestoneId: milestone.id, noteId: row.id };
}
export async function listMilestoneFiles(client, c, milestoneId) {
  const { milestone } = await milestoneScope(client, c, milestoneId);
  const rows = await listFiles(client, { organizationId: c.organizationId, entityType: MILESTONE_ENTITY, entityId: milestone.id });
  const ids = [...new Set(rows.map((row) => row.uploadedBy).filter(Boolean))];
  const names = ids.length ? new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [ids])).rows.map((row) => [row.id, row.name])) : new Map();
  return rows.map((row) => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes ?? 0), uploadedAt: row.createdAt, uploadedBy: names.get(row.uploadedBy) ?? null }));
}
export async function uploadMilestoneFile(client, c, milestoneId, input = {}, options = {}) {
  const { milestone, project, can } = await milestoneScope(client, c, milestoneId);
  if (!can.work && !can.customer) throw err(403, "MILESTONE_PERMISSION_DENIED");
  projectOpen(project);
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: MILESTONE_ENTITY, entityId: milestone.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await milestoneEvent(client, c, milestone, "FILE_ADDED", file.fileName ?? file.file_name, { details: { fileId: file.id } });
  return { id: file.id, fileName: file.fileName ?? file.file_name };
}
// A file used as evidence (on a deliverable or a customer decision) stays: the record it proves keeps it.
export async function removeMilestoneFile(client, c, milestoneId, fileId) {
  const { milestone, can } = await milestoneScope(client, c, milestoneId);
  const row = (await client.query(`SELECT id, uploaded_by, file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND is_current AND lifecycle_status <> 'archived'`,
    [c.organizationId, MILESTONE_ENTITY, milestone.id, uuid(fileId, "File")])).rows[0];
  if (!row) return { removed: true, replayed: true };
  if (row.uploaded_by !== c.userId && !can.edit) throw err(403, "MILESTONE_PERMISSION_DENIED");
  const used = (await client.query(`SELECT 1 FROM tenant.project_milestone_criteria WHERE organization_id = $1 AND evidence_file_id = $2 AND removed_at IS NULL
     UNION ALL SELECT 1 FROM tenant.project_milestone_approvals WHERE organization_id = $1 AND evidence_file_id = $2 LIMIT 1`, [c.organizationId, row.id])).rows[0];
  if (used) throw err(409, "MILESTONE_EVIDENCE_MISSING", "This file is evidence for a deliverable or a decision; it stays with the record.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: MILESTONE_ENTITY, entityId: milestone.id, fileId: row.id, actorUserId: c.userId ?? null });
  await milestoneEvent(client, c, milestone, "FILE_REMOVED", row.file_name, { details: { fileId: row.id } });
  return { removed: true };
}
export async function readMilestoneFile(client, c, milestoneId, fileId, options = {}) {
  const { milestone } = await milestoneScope(client, c, milestoneId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4`,
    [c.organizationId, MILESTONE_ENTITY, milestone.id, uuid(fileId, "File")])).rows[0];
  if (!row) throw err(404, "MILESTONE_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: MILESTONE_ENTITY, entityId: milestone.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}


