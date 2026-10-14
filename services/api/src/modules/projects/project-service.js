// Projects — the commands: a draft created (once per request; directly, from a confirmed sales order, or by import) and edited; activation
// checked and, where the company asks, approved by someone else; started, put on hold (resuming to the status it interrupted), completed
// once its closing checks pass, reopened with a reason, cancelled after its dependencies are reviewed, archived and restored, and an unused
// draft removed. The team (one accountable Project Manager), typed links to other modules' records, notes, files, saved views and the
// company's project policy and types. Every change is versioned, written to the activity timeline and announced to automation.
import { randomUUID } from "node:crypto";

import { archiveFile, listFiles, prepareFileUpload, readFileContent, storeFile } from "../../core/platform/files/index.js";
import {
  ACTIVE_STATUSES, PRIORITIES, PROJECT, ROLES, STATUS_LABEL, accessOf, activeMemberIds, eligibleUsers, ensureProjectTypes, has, isoDay, label, loadProject, need,
  nextProjectCode, notifyProject, projectError, projectEvent, projectSettings, publishProjectEvent, requireAccess, statusEvent, text, today, uuid, versionCheck, visibleProject,
} from "./project-core.js";
import { completionCheck, cancellationReview } from "./project-summary.js";

const FILE_ENTITY = "projects.project";

// ------------------------------------------------------------------ the fields of a project, checked
async function customerOf(client, c, customerId) {
  const row = (await client.query(`SELECT id, display_name, status, customer_number, party_type FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, uuid(customerId, "Customer")])).rows[0];
  if (!row || row.status === "archived" || !(row.customer_number || ["customer", "both"].includes(row.party_type))) throw projectError(400, "PROJECT_CUSTOMER_INVALID", undefined, { field: "customerId" });
  return row;
}
async function contactOf(client, c, contactId, customerId) {
  const row = (await client.query(
    `SELECT contact.id FROM tenant.contacts contact WHERE contact.organization_id = $1 AND contact.id = $2 AND contact.archived_at IS NULL
        AND (contact.party_id = $3 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships relation WHERE relation.contact_id = contact.id AND relation.party_id = $3))`,
    [c.organizationId, uuid(contactId, "Contact"), customerId])).rows[0];
  if (!row) throw projectError(400, "PROJECT_CUSTOMER_INVALID", "Choose a contact of this customer.", { field: "customerContactId" });
  return row.id;
}
async function typeOf(client, c, input) {
  await ensureProjectTypes(client, c);
  if (input.projectTypeId) {
    const row = (await client.query(`SELECT id FROM tenant.project_types WHERE organization_id = $1 AND id = $2 AND status = 'ACTIVE'`, [c.organizationId, uuid(input.projectTypeId, "Project type")])).rows[0];
    if (!row) throw projectError(400, "PROJECT_TYPE_REQUIRED", "That project type is not available.", { field: "projectTypeId" });
    return row.id;
  }
  if (input.projectType) {
    const row = (await client.query(`SELECT id FROM tenant.project_types WHERE organization_id = $1 AND status = 'ACTIVE' AND (code = upper($2) OR lower(name) = lower($2))`,
      [c.organizationId, text(input.projectType, 80)])).rows[0];
    if (!row) throw projectError(400, "PROJECT_TYPE_REQUIRED", `"${text(input.projectType, 80)}" is not a project type.`, { field: "projectTypeId" });
    return row.id;
  }
  return null;
}
async function managerOf(client, c, userId) {
  const id = uuid(userId, "Project Manager");
  if (!(await eligibleUsers(client, c, [id])).has(id)) throw projectError(400, "PROJECT_MANAGER_INVALID", undefined, { field: "managerUserId" });
  return id;
}
const tagsOf = (value) => {
  if (value === undefined) return undefined;
  const list = (Array.isArray(value) ? value : String(value ?? "").split(/[;,]/)).map((tag) => text(tag, 40)).filter(Boolean);
  if (list.length > 20) throw projectError(400, "PROJECT_INPUT_INVALID", "Use at most 20 tags.", { field: "tags" });
  return [...new Map(list.map((tag) => [tag.toLowerCase(), tag])).values()];
};
// The given fields merged over the current ones and checked; only what is given changes.
async function fieldsOf(client, c, input, current = {}) {
  const out = {};
  const given = (key) => input[key] !== undefined;
  if (given("name")) {
    const name = text(input.name, 300);
    if (name && (name.length < 2 || name.length > 200)) throw projectError(400, "PROJECT_NAME_REQUIRED", "Use 2 to 200 characters for the project name.", { field: "name" });
    out.name = name || null;
  }
  if (given("description")) out.description = text(input.description, 10000) || null;
  if (given("classification")) {
    const value = String(input.classification ?? "").toUpperCase();
    if (!["INTERNAL", "CUSTOMER"].includes(value)) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose internal or customer project.", { field: "classification" });
    out.classification = value;
  }
  const classification = out.classification ?? current.classification ?? "INTERNAL";
  if (given("projectTypeId") || given("projectType")) out.project_type_id = (input.projectTypeId || input.projectType) ? await typeOf(client, c, input) : null;
  if (given("customerId")) out.customer_id = input.customerId ? (await customerOf(client, c, input.customerId)).id : null;
  if (classification === "INTERNAL") { out.customer_id = null; out.customer_contact_id = null; }
  const customerId = out.customer_id !== undefined ? out.customer_id : current.customer_id ?? null;
  if (given("customerContactId")) {
    if (input.customerContactId && !customerId) throw projectError(400, "PROJECT_CUSTOMER_REQUIRED", "Choose the customer before the contact.", { field: "customerContactId" });
    out.customer_contact_id = input.customerContactId ? await contactOf(client, c, input.customerContactId, customerId) : null;
  } else if (out.customer_id !== undefined && out.customer_id !== current.customer_id && current.customer_contact_id) out.customer_contact_id = null;
  if (given("managerUserId")) out.manager_user_id = input.managerUserId ? await managerOf(client, c, input.managerUserId) : null;
  if (given("priority")) {
    const value = String(input.priority ?? "NORMAL").toUpperCase();
    if (!PRIORITIES.includes(value)) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose low, normal, high or urgent.", { field: "priority" });
    out.priority = value;
  }
  if (given("plannedStartDate")) out.planned_start_date = isoDay(input.plannedStartDate);
  if (given("targetEndDate")) out.target_end_date = isoDay(input.targetEndDate);
  const start = out.planned_start_date !== undefined ? out.planned_start_date : isoDayOr(current.planned_start_date);
  const end = out.target_end_date !== undefined ? out.target_end_date : isoDayOr(current.target_end_date);
  if (start && end && end < start) throw projectError(400, "PROJECT_DATE_INVALID", undefined, { field: "targetEndDate" });
  const tags = tagsOf(input.tags);
  if (tags !== undefined) out.tags = tags;
  if (given("templateId")) out.template_id = input.templateId ? uuid(input.templateId, "Template") : null;
  if (given("templateName")) out.template_name = text(input.templateName, 200) || null;
  return out;
}
const isoDayOr = (value) => (value ? isoDay(value) : null);

// What activation needs, each problem with the field to fix.
export function activationProblems(project) {
  const problems = [];
  if (!project.name) problems.push({ code: "PROJECT_NAME_REQUIRED", field: "name", message: "Enter a project name." });
  if (!project.project_type_id) problems.push({ code: "PROJECT_TYPE_REQUIRED", field: "projectTypeId", message: "Choose the project type." });
  if (project.classification === "CUSTOMER" && !project.customer_id) problems.push({ code: "PROJECT_CUSTOMER_REQUIRED", field: "customerId", message: "Select a customer for this project." });
  if (!project.manager_user_id) problems.push({ code: "PROJECT_MANAGER_REQUIRED", field: "managerUserId", message: "Assign a Project Manager before starting." });
  if (!project.planned_start_date) problems.push({ code: "PROJECT_DATE_INVALID", field: "plannedStartDate", message: "Enter the planned start date." });
  if (!project.target_end_date) problems.push({ code: "PROJECT_DATE_INVALID", field: "targetEndDate", message: "Enter the target end date." });
  return problems;
}
export async function validateProjectActivation(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  const problems = activationProblems(project);
  if (project.manager_user_id && !(await eligibleUsers(client, c, [project.manager_user_id])).has(project.manager_user_id)) {
    problems.push({ code: "PROJECT_MANAGER_INVALID", field: "managerUserId", message: "The Project Manager is no longer an active, authorized member: choose a replacement." });
  }
  if (project.customer_id) {
    try { await customerOf(client, c, project.customer_id); } catch { problems.push({ code: "PROJECT_CUSTOMER_INVALID", field: "customerId", message: "The customer is no longer available." }); }
  }
  return { ready: problems.length === 0, problems };
}

// ------------------------------------------------------------------ membership helpers
async function setManagerMembership(client, c, project, managerId, previousId) {
  if (previousId && previousId !== managerId) {
    await client.query(`UPDATE tenant.project_members SET role = 'MEMBER' WHERE organization_id = $1 AND project_id = $2 AND user_id = $3 AND left_at IS NULL AND role = 'MANAGER'`,
      [c.organizationId, project.id, previousId]);
  }
  if (!managerId) return;
  const existing = (await client.query(`SELECT id, role FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND user_id = $3 AND left_at IS NULL FOR UPDATE`,
    [c.organizationId, project.id, managerId])).rows[0];
  if (existing) {
    if (existing.role !== "MANAGER") await client.query(`UPDATE tenant.project_members SET role = 'MANAGER' WHERE id = $1`, [existing.id]);
  } else {
    await client.query(`INSERT INTO tenant.project_members (organization_id, project_id, user_id, role, added_by) VALUES ($1,$2,$3,'MANAGER',$4)`,
      [c.organizationId, project.id, managerId, c.userId ?? null]);
  }
}
const COLUMN_LABEL = { name: "name", description: "scope", classification: "classification", project_type_id: "type", customer_id: "customer", customer_contact_id: "customer contact",
  manager_user_id: "Project Manager", priority: "priority", planned_start_date: "start date", target_end_date: "target date", tags: "tags", template_id: "template", template_name: "template" };

// ------------------------------------------------------------------ create and edit
// input: { name?, classification, projectTypeId | projectType, customerId?, customerContactId?, managerUserId?, plannedStartDate?, targetEndDate?, priority?,
//          description?, tags?, members?: [{ userId, role }], templateId?, templateName?, idempotencyKey? } — a draft, saved quickly.
export async function createProjectDraft(client, c, input = {}, { source = "MANUAL", links = [] } = {}) {
  need(c, PROJECT.create);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const done = (await client.query(`SELECT id, project_code FROM tenant.projects WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { projectId: done.id, projectCode: done.project_code, replayed: true };
    // Two requests with one key: the second waits for the first and then replays it.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`project-create:${c.organizationId}:${key}`]);
    const raced = (await client.query(`SELECT id, project_code FROM tenant.projects WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (raced) return { projectId: raced.id, projectCode: raced.project_code, replayed: true };
  }
  const fields = await fieldsOf(client, c, { classification: "INTERNAL", priority: "NORMAL", ...input });
  if (fields.manager_user_id === undefined && c.userId && (await eligibleUsers(client, c, [c.userId])).has(c.userId)) fields.manager_user_id = c.userId;
  const memberInput = Array.isArray(input.members) ? input.members : [];
  const memberIds = memberInput.map((row) => uuid(row.userId, "Member"));
  const eligible = await eligibleUsers(client, c, memberIds);
  const notEligible = memberIds.filter((id) => !eligible.has(id));
  if (notEligible.length) throw projectError(400, "PROJECT_MANAGER_INVALID", "Every member must be an active colleague who can use Projects.", { field: "members" });
  const id = randomUUID();
  const code = await nextProjectCode(client, c);
  const columns = { id, organization_id: c.organizationId, project_code: code, source, create_key: key, created_by: c.userId ?? null, updated_by: c.userId ?? null, ...fields };
  const names = Object.keys(columns);
  await client.query(`INSERT INTO tenant.projects (${names.join(", ")}) VALUES (${names.map((_, index) => `$${index + 1}`).join(", ")})`, names.map((name) => columns[name]));
  const project = await loadProject(client, c, id);
  await setManagerMembership(client, c, project, project.manager_user_id, null);
  for (const row of memberInput) {
    const role = memberRole(row.role);
    if (row.userId === project.manager_user_id) continue;
    await client.query(`INSERT INTO tenant.project_members (organization_id, project_id, user_id, role, added_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [c.organizationId, id, row.userId, role, c.userId ?? null]);
  }
  for (const link of links) await insertLink(client, c, project, link);
  await statusEvent(client, c, { ...project, status: null }, "CREATED", "DRAFT");
  await projectEvent(client, c, id, "CREATED", `${label(project)} created as a draft${source === "SALES_ORDER" ? " from a sales order" : source === "IMPORT" ? " by import" : ""}`);
  await publishProjectEvent(client, c, project, "created", { source });
  await notifyProject(client, c, project, [project.manager_user_id, ...memberIds], { category: "project_assignment", title: `You were added to ${project.project_code}`,
    message: `${project.name ?? "A draft project"} — ${project.manager_user_id === c.userId ? "you manage it" : "you are on its team"}.` });
  return { projectId: id, projectCode: code };
}
const memberRole = (value) => {
  const role = String(value ?? "MEMBER").toUpperCase();
  if (!["MEMBER", "VIEWER", "FINANCIAL_VIEWER"].includes(role)) throw projectError(400, "PROJECT_INPUT_INVALID", "Choose member, viewer or financial viewer (the manager is set on the project).", { field: "role" });
  return role;
};

// input: the fields to change, expectedVersion. A completed, cancelled or archived project's details are kept as they were.
export async function updateProject(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "edit");
  versionCheck(project, input.expectedVersion);
  if (["COMPLETED", "CANCELLED"].includes(project.status) || project.archived_at) {
    throw projectError(409, "PROJECT_STATUS_INVALID", `${project.project_code} is ${STATUS_LABEL[project.status].toLowerCase()}: its details are kept as they were${project.status === "COMPLETED" ? " (reopen it to change them)" : ""}.`);
  }
  const fields = await fieldsOf(client, c, input, project);
  const changed = Object.keys(fields).filter((key) => JSON.stringify(normal(fields[key])) !== JSON.stringify(normal(project[key])));
  if (!changed.length) return { projectId: project.id, version: project.row_version, changed: [] };
  const merged = { ...project, ...fields };
  if (project.status !== "DRAFT") {
    const problems = activationProblems(merged);
    if (problems.length) throw projectError(400, problems[0].code, `${problems[0].message} A ${STATUS_LABEL[project.status].toLowerCase()} project keeps it.`, { problems });
  }
  const sets = changed.map((key, index) => `${key} = $${index + 3}`);
  await client.query(`UPDATE tenant.projects SET ${sets.join(", ")}, row_version = row_version + 1, updated_by = $${changed.length + 3}, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, project.id, ...changed.map((key) => fields[key]), c.userId ?? null]);
  if (changed.includes("manager_user_id")) {
    await setManagerMembership(client, c, project, fields.manager_user_id, project.manager_user_id);
    await projectEvent(client, c, project.id, "MANAGER_CHANGED", "Project Manager changed", { from: project.manager_user_id, to: fields.manager_user_id });
    await notifyProject(client, c, project, [fields.manager_user_id], { category: "project_assignment", title: `You now manage ${project.project_code}`, message: `${merged.name ?? "The project"} is yours to lead.` });
    await notifyProject(client, c, project, [project.manager_user_id], { category: "project_assignment", title: `${project.project_code} has a new manager`, message: "You stay on the team as a member." });
  }
  const dates = changed.filter((key) => ["planned_start_date", "target_end_date"].includes(key));
  if (dates.length) {
    await projectEvent(client, c, project.id, "DATES_CHANGED", dates.map((key) => `${COLUMN_LABEL[key]} ${isoDayOr(project[key]) ?? "—"} → ${fields[key] ?? "—"}`).join("; "));
    if (project.status !== "DRAFT") {
      await notifyProject(client, c, project, await activeMemberIds(client, c, project.id), { title: `${project.project_code}: dates changed`,
        message: dates.map((key) => `${COLUMN_LABEL[key]} now ${fields[key] ?? "not set"}`).join("; ") });
    }
  }
  const rest = changed.filter((key) => !["manager_user_id", "planned_start_date", "target_end_date"].includes(key));
  if (rest.length) await projectEvent(client, c, project.id, changed.includes("description") ? "SCOPE_EDITED" : "DETAILS_EDITED", `Changed ${rest.map((key) => COLUMN_LABEL[key] ?? key).join(", ")}`);
  await publishProjectEvent(client, c, merged, "updated", { changedFields: changed });
  return { projectId: project.id, version: project.row_version + 1, changed };
}
const normal = (value) => (value instanceof Date ? isoDay(value) : Array.isArray(value) ? value : value ?? null);

// ------------------------------------------------------------------ lifecycle
async function moveTo(client, c, project, status, action, { reason = null, key = null, extra = {}, event = null } = {}) {
  const sets = ["status = $3", "row_version = row_version + 1", "updated_by = $4", "updated_at = now()"];
  const values = [c.organizationId, project.id, status, c.userId ?? null];
  for (const [column, value] of Object.entries(extra)) { values.push(value); sets.push(`${column} = $${values.length}`); }
  await client.query(`UPDATE tenant.projects SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2`, values);
  await statusEvent(client, c, project, action, status, reason, key);
  await projectEvent(client, c, project.id, action, event ?? `${STATUS_LABEL[project.status]} → ${STATUS_LABEL[status]}${reason ? `: ${reason}` : ""}`);
  await publishProjectEvent(client, c, { ...project, status }, action.toLowerCase(), { status, previousStatus: project.status });
}
const replay = async (client, c, key) => {
  if (!key) return null;
  const row = (await client.query(`SELECT project_id, to_status FROM tenant.project_status_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  return row ? { projectId: row.project_id, status: row.to_status, replayed: true } : null;
};
const statusRefusal = (project, allowed, verb) => {
  if (!allowed.includes(project.status)) {
    throw projectError(409, project.status === "ON_HOLD" && !allowed.includes("ON_HOLD") ? "PROJECT_ACTIVE_HOLD" : "PROJECT_STATUS_INVALID",
      project.status === "ON_HOLD" && !allowed.includes("ON_HOLD") ? undefined : `${project.project_code} is ${STATUS_LABEL[project.status].toLowerCase()}: it cannot be ${verb}.`);
  }
  if (project.archived_at) throw projectError(409, "PROJECT_ALREADY_ARCHIVED", "Restore the project first.");
};

// Draft → Planned, or a request for approval where the company asks for it. input: { expectedVersion?, idempotencyKey? }
export async function activateProject(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "start");
  versionCheck(project, input.expectedVersion);
  if (project.status === "PLANNED") return { projectId: project.id, status: project.status, replayed: true };
  statusRefusal(project, ["DRAFT"], "activated");
  const check = await validateProjectActivation(client, c, project.id);
  if (!check.ready) throw projectError(400, check.problems[0].code, check.problems[0].message, { problems: check.problems });
  const settings = await projectSettings(client, c);
  if (settings.activationApprovalRequired && project.approval_status !== "APPROVED") {
    if (project.approval_status === "PENDING") return { projectId: project.id, status: "DRAFT", approval: "PENDING", replayed: true };
    await client.query(`UPDATE tenant.projects SET approval_status = 'PENDING', approval_requested_by = $3, approval_requested_at = now(), approval_note = NULL, row_version = row_version + 1, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id, c.userId ?? null]);
    await projectEvent(client, c, project.id, "APPROVAL_REQUESTED", "Activation sent for approval");
    return { projectId: project.id, status: "DRAFT", approval: "PENDING" };
  }
  await moveTo(client, c, project, "PLANNED", "ACTIVATED", { key: text(input.idempotencyKey, 200) || null });
  return { projectId: project.id, status: "PLANNED" };
}
// input: { decision: APPROVE | REJECT, note? } — someone other than the requester (unless the company allows self-approval).
export async function decideProjectActivation(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "approve");
  if (project.status !== "DRAFT" || project.approval_status !== "PENDING") throw projectError(409, "PROJECT_STATUS_INVALID", "This project is not waiting for approval.");
  const settings = await projectSettings(client, c);
  if (project.approval_requested_by === c.userId && !settings.selfApprovalAllowed) throw projectError(403, "PROJECT_PERMISSION_DENIED", "Someone other than the requester approves a project.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say why the project is not approved.");
    await client.query(`UPDATE tenant.projects SET approval_status = 'REJECTED', approval_note = $3, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, project.id, note]);
    await projectEvent(client, c, project.id, "APPROVAL_REJECTED", note);
    await notifyProject(client, c, project, [project.approval_requested_by, project.manager_user_id], { title: `${project.project_code} was not approved`, message: note });
    return { projectId: project.id, status: "DRAFT", approval: "REJECTED" };
  }
  if (decision !== "APPROVE") throw projectError(400, "PROJECT_INPUT_INVALID", "Approve or reject.");
  const check = await validateProjectActivation(client, c, project.id);
  if (!check.ready) throw projectError(400, check.problems[0].code, check.problems[0].message, { problems: check.problems });
  await moveTo(client, c, project, "PLANNED", "APPROVED", { reason: note, extra: { approval_status: "APPROVED", approved_by: c.userId ?? null, approved_at: new Date(), approval_note: note } });
  await notifyProject(client, c, project, [project.approval_requested_by, project.manager_user_id], { title: `${project.project_code} approved`, message: "The project is planned and ready to start." });
  return { projectId: project.id, status: "PLANNED", approval: "APPROVED" };
}
// Planned → In progress. input: { startDate?, expectedVersion?, idempotencyKey? }
export async function startProject(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "start");
  versionCheck(project, input.expectedVersion);
  if (project.status === "IN_PROGRESS") return { projectId: project.id, status: project.status, replayed: true };
  statusRefusal(project, ["PLANNED"], "started");
  if (!(await eligibleUsers(client, c, [project.manager_user_id])).has(project.manager_user_id)) throw projectError(409, "PROJECT_MANAGER_INVALID", "The Project Manager is no longer active: assign a replacement first.");
  const day = input.startDate ? isoDay(input.startDate) : await today(client);
  if (day > await today(client)) throw projectError(400, "PROJECT_DATE_INVALID", "A project starts today or on a past date.");
  await moveTo(client, c, project, "IN_PROGRESS", "STARTED", { key: text(input.idempotencyKey, 200) || null, extra: { actual_start_date: day } });
  await notifyProject(client, c, project, await activeMemberIds(client, c, project.id), { title: `${project.project_code} has started`, message: `${project.name} is in progress.` });
  return { projectId: project.id, status: "IN_PROGRESS" };
}
// Planned or In progress → On hold, remembering which. input: { reason, ownerUserId?, expectedResolutionDate?, expectedVersion?, idempotencyKey? }
export async function placeProjectOnHold(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "hold");
  versionCheck(project, input.expectedVersion);
  if (project.status === "ON_HOLD") throw projectError(409, "PROJECT_ACTIVE_HOLD", "The project is already on hold.");
  statusRefusal(project, ["PLANNED", "IN_PROGRESS"], "put on hold");
  const reason = text(input.reason, 2000);
  if (reason.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say why the project is paused.");
  const owner = input.ownerUserId ? await managerOf(client, c, input.ownerUserId) : project.manager_user_id;
  const expected = input.expectedResolutionDate ? isoDay(input.expectedResolutionDate) : null;
  await client.query(`INSERT INTO tenant.project_holds (organization_id, project_id, previous_status, reason, owner_user_id, expected_resolution_date, started_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, project.id, project.status, reason, owner, expected, c.userId ?? null]);
  await moveTo(client, c, project, "ON_HOLD", "HELD", { reason, key: text(input.idempotencyKey, 200) || null, extra: { previous_status: project.status } });
  await notifyProject(client, c, project, [...await activeMemberIds(client, c, project.id), owner], { title: `${project.project_code} is on hold`, message: reason });
  return { projectId: project.id, status: "ON_HOLD" };
}
// On hold → the status it interrupted, once the hold is resolved by someone authorized. input: { resolution, expectedVersion?, idempotencyKey? }
export async function resumeProject(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "resume");
  versionCheck(project, input.expectedVersion);
  statusRefusal(project, ["ON_HOLD"], "resumed");
  const resolution = text(input.resolution, 2000);
  if (resolution.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say how the hold was resolved.");
  await client.query(`UPDATE tenant.project_holds SET resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4 WHERE organization_id = $1 AND project_id = $2 AND resolved_at IS NULL`,
    [c.organizationId, project.id, c.userId ?? null, resolution]);
  const back = project.previous_status;
  await moveTo(client, c, project, back, "RESUMED", { reason: resolution, key: text(input.idempotencyKey, 200) || null, extra: { previous_status: null } });
  await notifyProject(client, c, project, await activeMemberIds(client, c, project.id), { title: `${project.project_code} resumed`, message: `Back to ${STATUS_LABEL[back].toLowerCase()}: ${resolution}` });
  return { projectId: project.id, status: back };
}
// In progress → Completed once the closing checks pass. input: { completionDate?, closingNote, deliverablesConfirmed, customerAcceptance?, acknowledgeOutstanding?,
// expectedVersion?, idempotencyKey? }
export async function completeProject(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "complete");
  versionCheck(project, input.expectedVersion);
  if (project.status === "COMPLETED") return { projectId: project.id, status: project.status, replayed: true };
  statusRefusal(project, ["IN_PROGRESS"], "completed");
  const check = await completionCheck(client, c, project, input);
  const blocking = check.checks.filter((row) => row.blocking);
  if (blocking.length) throw projectError(409, "PROJECT_COMPLETION_BLOCKED", blocking.map((row) => row.message).join(" "), { checks: check.checks });
  const day = check.completionDate;
  await moveTo(client, c, project, "COMPLETED", "COMPLETED", { reason: text(input.closingNote, 2000), key: text(input.idempotencyKey, 200) || null,
    extra: { completed_at: day, completed_by: c.userId ?? null, completion_note: text(input.closingNote, 4000) } });
  await notifyProject(client, c, project, await activeMemberIds(client, c, project.id), { title: `${project.project_code} completed`, message: `${project.name} was completed on ${day}.` });
  return { projectId: project.id, status: "COMPLETED", completedAt: day };
}
// Completed → In progress, with a reason; the original completion stays in the history; finance and sales postings are untouched.
export async function reopenProject(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "reopen");
  versionCheck(project, input.expectedVersion);
  statusRefusal(project, ["COMPLETED"], "reopened");
  const reason = text(input.reason, 2000);
  if (reason.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say why the project is reopened.");
  if (!(await eligibleUsers(client, c, [project.manager_user_id])).has(project.manager_user_id)) throw projectError(409, "PROJECT_MANAGER_INVALID", "The Project Manager is no longer active: assign a replacement first.");
  await moveTo(client, c, project, "IN_PROGRESS", "REOPENED", { reason, key: text(input.idempotencyKey, 200) || null,
    extra: { completed_at: null, completed_by: null }, event: `Reopened (completed ${isoDayOr(project.completed_at)}): ${reason}` });
  await notifyProject(client, c, project, await activeMemberIds(client, c, project.id), { title: `${project.project_code} reopened`, message: reason });
  return { projectId: project.id, status: "IN_PROGRESS" };
}
// Draft, Planned, In progress or On hold → Cancelled, after the dependencies are reviewed. input: { reason, acknowledgeDependencies?, expectedVersion?, idempotencyKey? }
export async function cancelProject(client, c, projectId, input = {}) {
  const done = await replay(client, c, text(input.idempotencyKey, 200));
  if (done) return done;
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "cancel");
  versionCheck(project, input.expectedVersion);
  if (project.status === "CANCELLED") return { projectId: project.id, status: project.status, replayed: true };
  statusRefusal(project, ["DRAFT", ...ACTIVE_STATUSES], "cancelled");
  const reason = text(input.reason, 2000);
  if (reason.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Say why the project is cancelled.");
  const review = await cancellationReview(client, c, project);
  if (review.dependencies.length && !input.acknowledgeDependencies) throw projectError(409, "PROJECT_DEPENDENCIES_EXIST", undefined, { review });
  if (project.status === "ON_HOLD") {
    await client.query(`UPDATE tenant.project_holds SET resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4 WHERE organization_id = $1 AND project_id = $2 AND resolved_at IS NULL`,
      [c.organizationId, project.id, c.userId ?? null, `Project cancelled: ${reason}`.slice(0, 2000)]);
  }
  await moveTo(client, c, project, "CANCELLED", "CANCELLED", { reason, key: text(input.idempotencyKey, 200) || null,
    extra: { cancelled_at: new Date(), cancelled_by: c.userId ?? null, cancel_reason: reason, previous_status: null } });
  await notifyProject(client, c, project, await activeMemberIds(client, c, project.id), { title: `${project.project_code} cancelled`, message: reason });
  return { projectId: project.id, status: "CANCELLED" };
}
export async function archiveProject(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "archive");
  if (project.archived_at) throw projectError(409, "PROJECT_ALREADY_ARCHIVED");
  if (!["COMPLETED", "CANCELLED"].includes(project.status)) throw projectError(409, "PROJECT_STATUS_INVALID", "Only a completed or cancelled project is archived.");
  await client.query(`UPDATE tenant.projects SET archived_at = now(), archived_by = $3, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, project.id, c.userId ?? null]);
  await projectEvent(client, c, project.id, "ARCHIVED", text(input.note, 500) || "Archived");
  await publishProjectEvent(client, c, project, "archived");
  return { projectId: project.id, archived: true };
}
export async function restoreProject(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "archive");
  if (!project.archived_at) return { projectId: project.id, archived: false, replayed: true };
  await client.query(`UPDATE tenant.projects SET archived_at = NULL, archived_by = NULL, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id]);
  await projectEvent(client, c, project.id, "RESTORED", "Restored from the archive");
  await publishProjectEvent(client, c, project, "restored");
  return { projectId: project.id, archived: false };
}
// An unused draft removed (softly): nothing linked, noted, filed or started.
export async function deleteDraftProject(client, c, projectId) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  if (!(access.can.archive || (access.can.edit && project.created_by === c.userId))) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  if (project.status !== "DRAFT") throw projectError(409, "PROJECT_STATUS_INVALID", "Only an unused draft is removed; cancel or archive the others.");
  const used = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.project_links WHERE project_id = $2 AND removed_at IS NULL) + (SELECT count(*) FROM tenant.project_notes WHERE project_id = $2 AND deleted_at IS NULL)
          + (SELECT count(*) FROM public.attachments WHERE organization_id = $1 AND entity_type = $3 AND entity_id = $2::text AND archived_at IS NULL) AS n`,
    [c.organizationId, project.id, FILE_ENTITY])).rows[0].n;
  if (Number(used)) throw projectError(409, "PROJECT_DEPENDENCIES_EXIST", "This draft has links, notes or files: cancel it instead.");
  await client.query(`UPDATE tenant.projects SET deleted_at = now(), deleted_by = $3, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, project.id, c.userId ?? null]);
  await projectEvent(client, c, project.id, "REMOVED", "Unused draft removed");
  return { projectId: project.id, removed: true };
}
// input: { flagged, note? } — a delivery risk the manager flags (part of health, with its note).
export async function flagProjectRisk(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "edit");
  const flagged = Boolean(input.flagged);
  const note = text(input.note, 1000) || null;
  if (flagged && (!note || note.length < 3)) throw projectError(400, "PROJECT_REASON_REQUIRED", "Describe the delivery risk.");
  await client.query(`UPDATE tenant.projects SET risk_flagged = $3, risk_note = $4, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, project.id, flagged, flagged ? note : null]);
  await projectEvent(client, c, project.id, flagged ? "RISK_FLAGGED" : "RISK_CLEARED", flagged ? note : note ?? "Delivery risk cleared");
  return { projectId: project.id, riskFlagged: flagged };
}
// input: { note } — the manager's explanation of the current health warning (shown beside it; it never hides the reasons).
export async function noteProjectHealth(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  if (!(access.can.edit || access.manager)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  const note = text(input.note, 1000);
  if (note.length < 3) throw projectError(400, "PROJECT_REASON_REQUIRED", "Write the explanation.");
  await client.query(`UPDATE tenant.projects SET health_note = $3, health_noted_by = $4, health_noted_at = now() WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id, note, c.userId ?? null]);
  await projectEvent(client, c, project.id, "HEALTH_EXPLAINED", note);
  return { projectId: project.id };
}

// ------------------------------------------------------------------ team
// input: { userId, role } — an existing colleague who can use Projects (a new person is invited through User Management first).
export async function addProjectMember(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "members");
  if (["COMPLETED", "CANCELLED"].includes(project.status)) throw projectError(409, "PROJECT_STATUS_INVALID", "The team of a closed project is kept as it was.");
  const userId = uuid(input.userId, "Member");
  const role = memberRole(input.role);
  if (!(await eligibleUsers(client, c, [userId])).has(userId)) throw projectError(400, "PROJECT_MANAGER_INVALID", "Choose an active colleague whose role can use Projects.");
  const existing = (await client.query(`SELECT id, role FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND user_id = $3 AND left_at IS NULL FOR UPDATE`,
    [c.organizationId, project.id, userId])).rows[0];
  if (existing) return { memberId: existing.id, role: existing.role, replayed: true };
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_members (id, organization_id, project_id, user_id, role, added_by) VALUES ($1,$2,$3,$4,$5,$6)`, [id, c.organizationId, project.id, userId, role, c.userId ?? null]);
  const name = (await client.query(`SELECT COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = $1`, [userId])).rows[0]?.name ?? "A colleague";
  await projectEvent(client, c, project.id, "MEMBER_ADDED", `${name} joined as ${ROLES[role]}`, { userId, role });
  await publishProjectEvent(client, c, project, "member_added", { memberUserId: userId, role });
  await notifyProject(client, c, project, [userId], { category: "project_assignment", title: `You were added to ${project.project_code}`, message: `${project.name ?? "A project"} — as ${ROLES[role]}.` });
  return { memberId: id, role };
}
export async function updateProjectMemberRole(client, c, projectId, memberId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "members");
  const row = (await client.query(`SELECT * FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND left_at IS NULL FOR UPDATE`,
    [c.organizationId, project.id, uuid(memberId, "Member")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That member is not on the project.");
  if (row.role === "MANAGER") throw projectError(409, "PROJECT_MANAGER_REQUIRED", "Change the Project Manager on the project itself.");
  const role = memberRole(input.role);
  if (role === row.role) return { memberId: row.id, role };
  await client.query(`UPDATE tenant.project_members SET role = $2 WHERE id = $1`, [row.id, role]);
  await projectEvent(client, c, project.id, "MEMBER_ROLE_CHANGED", `${ROLES[row.role]} → ${ROLES[role]}`, { userId: row.user_id });
  return { memberId: row.id, role };
}
// The person leaves the project (their history stays attributed to them). The manager is replaced first; a hold they own is handed over.
export async function removeProjectMember(client, c, projectId, memberId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "members");
  const row = (await client.query(`SELECT * FROM tenant.project_members WHERE organization_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, project.id, uuid(memberId, "Member")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That member is not on the project.");
  if (row.left_at) return { memberId: row.id, removed: true, replayed: true };
  if (row.role === "MANAGER" || row.user_id === project.manager_user_id) throw projectError(409, "PROJECT_MANAGER_REQUIRED", "Assign another Project Manager before removing this one.");
  const hold = (await client.query(`SELECT id FROM tenant.project_holds WHERE project_id = $1 AND resolved_at IS NULL AND owner_user_id = $2`, [project.id, row.user_id])).rows[0];
  if (hold) throw projectError(409, "PROJECT_ACTIVE_HOLD", "This person owns the project's active hold: resume the project or have the manager own it first.");
  await client.query(`UPDATE tenant.project_members SET left_at = clock_timestamp(), removed_by = $2, removal_note = $3 WHERE id = $1`, [row.id, c.userId ?? null, text(input.note, 500) || null]);
  await projectEvent(client, c, project.id, "MEMBER_REMOVED", `${ROLES[row.role]} left the project`, { userId: row.user_id });
  await publishProjectEvent(client, c, project, "member_removed", { memberUserId: row.user_id });
  return { memberId: row.id, removed: true };
}

// ------------------------------------------------------------------ links to other modules' records
export const LINK_SOURCES = Object.freeze({
  CRM_ACCOUNT: { module: "CRM", permission: "crm.accounts.view", sql: `SELECT id, id AS party_id FROM tenant.business_parties WHERE organization_id = $1 AND id = $2` },
  CRM_CONTACT: { module: "CRM", permission: "crm.contacts.view", sql: `SELECT id, party_id FROM tenant.contacts WHERE organization_id = $1 AND id = $2` },
  CRM_OPPORTUNITY: { module: "CRM", permission: "crm.opportunities.view", sql: `SELECT id, party_id FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2` },
  SALES_QUOTATION: { module: "SALES", permission: "sales.quotation.view", sql: `SELECT id, party_id FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2` },
  SALES_ORDER: { module: "SALES", permission: "sales.order.view", sql: `SELECT id, party_id FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2` },
  SALES_INVOICE: { module: "FINANCE", permission: "sales.invoice.view", sql: `SELECT id, party_id FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2 AND invoice_type <> 'credit_note'` },
  PURCHASE_ORDER: { module: "PROCUREMENT", permission: "procurement.po.view", sql: `SELECT id, NULL::uuid AS party_id FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2` },
  SUPPLIER_BILL: { module: "PROCUREMENT", permission: "procurement.bills.view", sql: `SELECT id, NULL::uuid AS party_id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2` },
});
const CUSTOMER_SCOPED = new Set(["CRM_ACCOUNT", "CRM_CONTACT", "CRM_OPPORTUNITY", "SALES_QUOTATION", "SALES_ORDER", "SALES_INVOICE"]);
async function insertLink(client, c, project, input) {
  const type = String(input.sourceType ?? "").toUpperCase();
  const source = LINK_SOURCES[type];
  if (!source) throw projectError(400, "PROJECT_LINK_INVALID", "Choose what kind of record to link.");
  if (!has(c, source.permission)) throw projectError(403, "PROJECT_PERMISSION_DENIED", "You cannot see that kind of record, so you cannot link it.");
  // Only this company's records: a record of another company is simply not found.
  const record = (await client.query(source.sql, [c.organizationId, uuid(input.sourceId, "Linked record")])).rows[0];
  if (!record) throw projectError(400, "PROJECT_LINK_INVALID");
  if (project.classification === "CUSTOMER" && project.customer_id && CUSTOMER_SCOPED.has(type) && record.party_id) {
    const related = record.party_id === project.customer_id || (type === "CRM_CONTACT" && (await client.query(
      `SELECT 1 FROM tenant.crm_contact_account_relationships WHERE contact_id = $1 AND party_id = $2`, [record.id, project.customer_id])).rows[0]);
    if (!related) throw projectError(400, "PROJECT_LINK_INVALID", "That record belongs to another customer.");
  }
  let lineId = null;
  if (input.sourceLineId) {
    if (type !== "SALES_ORDER") throw projectError(400, "PROJECT_LINK_INVALID", "Only a sales order line can be linked by line.");
    lineId = uuid(input.sourceLineId, "Order line");
    const line = (await client.query(`SELECT 1 FROM tenant.sales_order_lines line JOIN tenant.sales_order_versions version ON version.id = line.sales_order_version_id
        WHERE line.organization_id = $1 AND line.id = $2 AND version.sales_order_id = $3`, [c.organizationId, lineId, record.id])).rows[0];
    if (!line) throw projectError(400, "PROJECT_LINK_INVALID", "That line is not on this sales order.");
  }
  const linkType = String(input.linkType ?? "RELATED").toUpperCase();
  if (!["ORIGIN", "DELIVERY", "BILLING", "RELATED"].includes(linkType)) throw projectError(400, "PROJECT_LINK_INVALID", "Choose how the record relates to the project.");
  const existing = (await client.query(`SELECT id FROM tenant.project_links WHERE project_id = $1 AND source_type = $2 AND source_id = $3 AND source_line_id IS NOT DISTINCT FROM $4 AND removed_at IS NULL`,
    [project.id, type, record.id, lineId])).rows[0];
  if (existing) return { linkId: existing.id, replayed: true };
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_links (id, organization_id, project_id, source_module, source_type, source_id, source_line_id, link_type, note, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, c.organizationId, project.id, source.module, type, record.id, lineId, linkType, text(input.note, 500) || null, c.userId ?? null]);
  await projectEvent(client, c, project.id, "LINKED", `${type.replace(/_/g, " ").toLowerCase()} linked (${linkType.toLowerCase()})`, { sourceType: type, sourceId: record.id });
  return { linkId: id };
}
// input: { sourceType, sourceId, sourceLineId?, linkType?, note? }
export async function linkProjectRecord(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "links");
  const result = await insertLink(client, c, project, input);
  if (!result.replayed) await publishProjectEvent(client, c, project, "linked", { sourceType: String(input.sourceType).toUpperCase(), sourceId: input.sourceId });
  return result;
}
export async function unlinkProjectRecord(client, c, projectId, linkId) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  requireAccess(access, "links");
  const row = (await client.query(`UPDATE tenant.project_links SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2 AND project_id = $4 AND removed_at IS NULL RETURNING source_type`,
    [c.organizationId, uuid(linkId, "Link"), c.userId ?? null, project.id])).rows[0];
  if (!row) return { removed: true, replayed: true };
  await projectEvent(client, c, project.id, "UNLINKED", `${row.source_type.replace(/_/g, " ").toLowerCase()} unlinked`);
  return { removed: true };
}

// A project created from a confirmed sales order: once (a repeated click returns the same project); another project for the same order only
// when asked for explicitly. input: { additional?, idempotencyKey?, name?, managerUserId?, projectTypeId? }
export async function createProjectFromSalesOrder(client, c, salesOrderId, input = {}) {
  need(c, PROJECT.create);
  if (!has(c, "sales.order.view")) throw projectError(403, "PROJECT_PERMISSION_DENIED", "You cannot see sales orders.");
  const order = (await client.query(`SELECT sales_order.*, party.display_name FROM tenant.sales_orders sales_order JOIN tenant.business_parties party ON party.id = sales_order.party_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2`, [c.organizationId, uuid(salesOrderId, "Sales order")])).rows[0];
  if (!order) throw projectError(404, "PROJECT_LINK_INVALID", "That sales order was not found.");
  if (order.lifecycle_status !== "confirmed") throw projectError(409, "PROJECT_LINK_INVALID", `${order.sales_order_number} is ${order.lifecycle_status.replace(/_/g, " ")}: a project starts from a confirmed order.`);
  const additional = Boolean(input.additional);
  if (additional && !text(input.idempotencyKey, 200)) throw projectError(400, "PROJECT_INPUT_INVALID", "A further project for the same order needs a request key.");
  const key = additional ? `sales-order:${order.id}:${text(input.idempotencyKey, 160)}` : `sales-order:${order.id}`;
  const links = [{ sourceType: "SALES_ORDER", sourceId: order.id, linkType: "ORIGIN" }];
  if (order.source_quotation_id && has(c, "sales.quotation.view")) links.push({ sourceType: "SALES_QUOTATION", sourceId: order.source_quotation_id, linkType: "ORIGIN" });
  if (order.source_opportunity_id && has(c, "crm.opportunities.view")) links.push({ sourceType: "CRM_OPPORTUNITY", sourceId: order.source_opportunity_id, linkType: "ORIGIN" });
  const created = await createProjectDraft(client, c, {
    name: text(input.name, 200) || `${order.display_name} — ${order.sales_order_number}`.slice(0, 200), classification: "CUSTOMER", customerId: order.party_id,
    customerContactId: order.contact_id ?? undefined, projectTypeId: input.projectTypeId || undefined, managerUserId: input.managerUserId || undefined, idempotencyKey: key,
  }, { source: "SALES_ORDER", links });
  return { ...created, salesOrderNumber: order.sales_order_number };
}

// ------------------------------------------------------------------ notes and files
export async function addProjectNote(client, c, projectId, input = {}) {
  const { project, access } = await visibleProject(client, c, projectId);
  requireAccess(access, "contribute");
  const body = text(input.body, 5000);
  if (!body) throw projectError(400, "PROJECT_INPUT_INVALID", "Write the note.", { field: "body" });
  const id = randomUUID();
  await client.query(`INSERT INTO tenant.project_notes (id, organization_id, project_id, body, author_user_id) VALUES ($1,$2,$3,$4,$5)`, [id, c.organizationId, project.id, body, c.userId ?? null]);
  await projectEvent(client, c, project.id, "NOTE_ADDED", body.slice(0, 140));
  return { noteId: id };
}
// The author edits their note; a manager (or someone who edits the project) may remove any.
export async function editProjectNote(client, c, projectId, noteId, input = {}) {
  const { project } = await visibleProject(client, c, projectId);
  const note = (await client.query(`SELECT * FROM tenant.project_notes WHERE organization_id = $1 AND project_id = $2 AND id = $3 AND deleted_at IS NULL FOR UPDATE`,
    [c.organizationId, project.id, uuid(noteId, "Note")])).rows[0];
  if (!note) throw projectError(404, "PROJECT_NOT_FOUND", "That note was not found.");
  if (note.author_user_id !== c.userId) throw projectError(403, "PROJECT_PERMISSION_DENIED", "Only the author edits a note.");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== note.row_version) throw projectError(409, "PROJECT_VERSION_CONFLICT");
  const body = text(input.body, 5000);
  if (!body) throw projectError(400, "PROJECT_INPUT_INVALID", "Write the note.", { field: "body" });
  await client.query(`UPDATE tenant.project_notes SET body = $2, edited_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [note.id, body]);
  return { noteId: note.id };
}
export async function removeProjectNote(client, c, projectId, noteId) {
  const { project, access } = await visibleProject(client, c, projectId);
  const note = (await client.query(`SELECT * FROM tenant.project_notes WHERE organization_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE`, [c.organizationId, project.id, uuid(noteId, "Note")])).rows[0];
  if (!note) throw projectError(404, "PROJECT_NOT_FOUND", "That note was not found.");
  if (note.deleted_at) return { removed: true, replayed: true };
  if (note.author_user_id !== c.userId && !access.can.edit) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  await client.query(`UPDATE tenant.project_notes SET deleted_at = clock_timestamp(), deleted_by = $2 WHERE id = $1`, [note.id, c.userId ?? null]);
  await projectEvent(client, c, project.id, "NOTE_REMOVED", "A note was removed");
  return { removed: true };
}
const FILE_TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", dwg: "application/acad", zip: "application/zip" };
export async function prepareProjectFileUpload({ fileName, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? ""))?.[1] ?? "").toLowerCase();
  const mimeType = FILE_TYPES[extension];
  if (!mimeType) throw projectError(400, "PROJECT_INPUT_INVALID", "Upload a document, drawing, spreadsheet, presentation, image, PDF or text file.");
  return prepareFileUpload({ fileName, mimeType, bytes, maximumBytes: 20 * 1024 * 1024, allowedTypes: [...new Set(Object.values(FILE_TYPES))] }, env);
}
const toFile = (row, names) => ({ id: row.id, fileName: row.file_name ?? row.fileName, mimeType: row.mime_type ?? row.mimeType, sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
  uploadedAt: row.created_at ?? row.createdAt, uploadedBy: names?.get(row.uploaded_by ?? row.uploadedBy) ?? null });
export async function listProjectFiles(client, c, projectId) {
  const { project } = await visibleProject(client, c, projectId);
  const rows = await listFiles(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: project.id });
  const ids = [...new Set(rows.map((row) => row.uploaded_by ?? row.uploadedBy).filter(Boolean))];
  const names = ids.length ? new Map((await client.query(`SELECT id, COALESCE(NULLIF(full_name, ''), email) AS name FROM public.users WHERE id = ANY($1::uuid[])`, [ids])).rows.map((row) => [row.id, row.name])) : new Map();
  return rows.map((row) => toFile(row, names));
}
export async function uploadProjectFile(client, c, projectId, input = {}, options = {}) {
  const { project, access } = await visibleProject(client, c, projectId);
  requireAccess(access, "contribute");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: project.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await projectEvent(client, c, project.id, "FILE_ADDED", file.fileName ?? file.file_name);
  return toFile(file);
}
export async function removeProjectFile(client, c, projectId, fileId) {
  const { project, access } = await visibleProject(client, c, projectId);
  const row = (await client.query(`SELECT id, uploaded_by, file_name FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, project.id, uuid(fileId, "File")])).rows[0];
  if (!row) return { removed: true, replayed: true };
  if (row.uploaded_by !== c.userId && !access.can.edit) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  await archiveFile(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: project.id, fileId: row.id, actorUserId: c.userId ?? null });
  await projectEvent(client, c, project.id, "FILE_REMOVED", row.file_name);
  return { removed: true };
}
// Files are read through the project (never public by link alone).
export async function readProjectFile(client, c, projectId, fileId, options = {}) {
  const { project } = await visibleProject(client, c, projectId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4 AND archived_at IS NULL`,
    [c.organizationId, FILE_ENTITY, project.id, uuid(fileId, "File")])).rows[0];
  if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: FILE_ENTITY, entityId: project.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}

// ------------------------------------------------------------------ saved views, policy and types
export async function listProjectViews(client, c) {
  return (await client.query(`SELECT id, name, filters, is_default FROM tenant.project_saved_views WHERE organization_id = $1 AND user_id = $2 ORDER BY is_default DESC, name`,
    [c.organizationId, c.userId])).rows.map((row) => ({ id: row.id, name: row.name, filters: row.filters, isDefault: row.is_default }));
}
// input: { name, filters, isDefault? } — one's own; one default.
export async function saveProjectView(client, c, input = {}) {
  if (!c.userId) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  const name = text(input.name, 80);
  if (!name) throw projectError(400, "PROJECT_INPUT_INVALID", "Name the view.", { field: "name" });
  const filters = input.filters && typeof input.filters === "object" ? Object.fromEntries(Object.entries(input.filters).filter(([, value]) => value !== undefined && value !== null && value !== "").slice(0, 20)) : {};
  if (input.isDefault) await client.query(`UPDATE tenant.project_saved_views SET is_default = false WHERE organization_id = $1 AND user_id = $2`, [c.organizationId, c.userId]);
  const row = (await client.query(`INSERT INTO tenant.project_saved_views (organization_id, user_id, name, filters, is_default) VALUES ($1,$2,$3,$4::jsonb,$5)
      ON CONFLICT (organization_id, user_id, lower(name)) DO UPDATE SET filters = EXCLUDED.filters, is_default = EXCLUDED.is_default RETURNING id`,
    [c.organizationId, c.userId, name, JSON.stringify(filters), Boolean(input.isDefault)])).rows[0];
  return { viewId: row.id };
}
export async function removeProjectView(client, c, viewId) {
  await client.query(`DELETE FROM tenant.project_saved_views WHERE organization_id = $1 AND user_id = $2 AND id = $3`, [c.organizationId, c.userId, uuid(viewId, "View")]);
  return { removed: true };
}
export async function getProjectSettings(client, c) {
  if (!has(c, PROJECT.view) && !has(c, PROJECT.viewAll) && !has(c, PROJECT.settings)) throw projectError(403, "PROJECT_PERMISSION_DENIED");
  await ensureProjectTypes(client, c);
  const types = (await client.query(`SELECT * FROM tenant.project_types WHERE organization_id = $1 ORDER BY status, sort_order, name`, [c.organizationId])).rows;
  return { settings: await projectSettings(client, c), types: types.map((row) => ({ id: row.id, code: row.code, name: row.name, description: row.description, status: row.status })),
    roles: Object.entries(ROLES).map(([code, name]) => ({ code, name })), can: { manage: has(c, PROJECT.settings) } };
}
// input: { activationApprovalRequired?, selfApprovalAllowed?, dueSoonDays?, customerAcceptanceRequired? }
export async function saveProjectSettings(client, c, input = {}) {
  need(c, PROJECT.settings);
  const current = await projectSettings(client, c);
  const next = {
    activationApprovalRequired: input.activationApprovalRequired === undefined ? current.activationApprovalRequired : Boolean(input.activationApprovalRequired),
    selfApprovalAllowed: input.selfApprovalAllowed === undefined ? current.selfApprovalAllowed : Boolean(input.selfApprovalAllowed),
    dueSoonDays: input.dueSoonDays === undefined ? current.dueSoonDays : Number(input.dueSoonDays),
    customerAcceptanceRequired: input.customerAcceptanceRequired === undefined ? current.customerAcceptanceRequired : Boolean(input.customerAcceptanceRequired),
  };
  if (!Number.isInteger(next.dueSoonDays) || next.dueSoonDays < 1 || next.dueSoonDays > 90) throw projectError(400, "PROJECT_INPUT_INVALID", "Use 1 to 90 days.", { field: "dueSoonDays" });
  await client.query(`INSERT INTO tenant.project_settings (organization_id, activation_approval_required, self_approval_allowed, due_soon_days, customer_acceptance_required, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (organization_id) DO UPDATE SET activation_approval_required = $2, self_approval_allowed = $3, due_soon_days = $4,
      customer_acceptance_required = $5, updated_by = $6, updated_at = now()`,
    [c.organizationId, next.activationApprovalRequired, next.selfApprovalAllowed, next.dueSoonDays, next.customerAcceptanceRequired, c.userId ?? null]);
  return next;
}
// input: { id?, code?, name, description?, status? }
export async function saveProjectType(client, c, input = {}) {
  need(c, PROJECT.settings);
  await ensureProjectTypes(client, c);
  const name = text(input.name, 80);
  if (name.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "Name the project type.", { field: "name" });
  const status = String(input.status ?? "ACTIVE").toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  if (input.id) {
    const row = (await client.query(`UPDATE tenant.project_types SET name = $3, description = $4, status = $5, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [c.organizationId, uuid(input.id, "Project type"), name, text(input.description, 500) || null, status])).rows[0];
    if (!row) throw projectError(404, "PROJECT_NOT_FOUND", "That project type was not found.");
    return { typeId: row.id };
  }
  const code = text(input.code || name, 60).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(code)) throw projectError(400, "PROJECT_INPUT_INVALID", "Give the type a code of letters and digits.", { field: "code" });
  const row = (await client.query(`INSERT INTO tenant.project_types (organization_id, code, name, description, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id, code) DO NOTHING RETURNING id`,
    [c.organizationId, code, name, text(input.description, 500) || null, c.userId ?? null])).rows[0];
  if (!row) throw projectError(409, "PROJECT_INPUT_INVALID", "A project type with that code exists.", { field: "code" });
  return { typeId: row.id };
}

// ------------------------------------------------------------------ import
// A CSV of projects, each row a draft (name, classification, type, customer, manager email, start, target, priority, tags, description). Each
// row stands alone: a bad row is reported, the good ones are created — once per import key and row, so a repeated import adds nothing.
const parseCsv = (source) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(source ?? "").replace(/^﻿/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === "\"" && input[index + 1] === "\"") { field += "\""; index += 1; } else if (char === "\"") quoted = false; else field += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") { row.push(field); field = ""; } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
};
export async function importProjects(client, c, input = {}) {
  need(c, PROJECT.create);
  const importKey = text(input.importKey, 120);
  if (!importKey) throw projectError(400, "PROJECT_INPUT_INVALID", "An import needs a request key.");
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw projectError(400, "PROJECT_INPUT_INVALID", "The file has no project rows (the first row is the header).");
  if (rows.length > 501) throw projectError(400, "PROJECT_INPUT_INVALID", "Import at most 500 projects at a time.");
  const header = rows[0].map((cell) => cell.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const at = (cells, ...names) => { for (const name of names) { const index = header.indexOf(name); if (index >= 0) return (cells[index] ?? "").trim(); } return ""; };
  if (!header.includes("name")) throw projectError(400, "PROJECT_INPUT_INVALID", "The header needs at least a Name column.");
  const results = [];
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    await client.query("SAVEPOINT project_import_row");
    try {
      const customerRef = at(cells, "customer", "customernumber", "customercode");
      let customerId;
      if (customerRef) {
        const matches = (await client.query(`SELECT id FROM tenant.business_parties WHERE organization_id = $1 AND status <> 'archived' AND (customer_number IS NOT NULL OR party_type IN ('customer', 'both'))
            AND (customer_number = $2 OR code = $2 OR lower(display_name) = lower($2)) LIMIT 2`, [c.organizationId, customerRef])).rows;
        if (matches.length !== 1) throw projectError(400, "PROJECT_CUSTOMER_INVALID", matches.length ? `"${customerRef}" matches more than one customer: use the customer number.` : `No customer "${customerRef}".`);
        customerId = matches[0].id;
      }
      const managerRef = at(cells, "manager", "manageremail", "projectmanager");
      let managerUserId;
      if (managerRef) {
        managerUserId = (await client.query(`SELECT person.id FROM public.users person JOIN public.organization_memberships membership ON membership.user_id = person.id AND membership.organization_id = $1
            WHERE lower(person.email) = lower($2)`, [c.organizationId, managerRef])).rows[0]?.id;
        if (!managerUserId) throw projectError(400, "PROJECT_MANAGER_INVALID", `No colleague with the email "${managerRef}".`);
      }
      const classification = (at(cells, "classification", "kind") || (customerId ? "CUSTOMER" : "INTERNAL")).toUpperCase();
      const created = await createProjectDraft(client, c, {
        name: at(cells, "name", "projectname"), classification, projectType: at(cells, "type", "projecttype") || undefined, customerId, managerUserId,
        plannedStartDate: at(cells, "start", "startdate", "plannedstartdate") || undefined, targetEndDate: at(cells, "target", "targetdate", "targetenddate", "end", "enddate") || undefined,
        priority: at(cells, "priority") || undefined, tags: at(cells, "tags") || undefined, description: at(cells, "description", "scope") || undefined,
        idempotencyKey: `import:${importKey}:${index}`,
      }, { source: "IMPORT" });
      await client.query("RELEASE SAVEPOINT project_import_row");
      results.push({ row: index + 1, status: created.replayed ? "ALREADY_IMPORTED" : "CREATED", projectId: created.projectId, projectCode: created.projectCode });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT project_import_row");
      if (!error?.code?.startsWith?.("PROJECT_")) throw error;
      results.push({ row: index + 1, status: "FAILED", code: error.code, message: error.message });
    }
  }
  return { results, created: results.filter((row) => row.status === "CREATED").length, failed: results.filter((row) => row.status === "FAILED").length };
}

export { FILE_ENTITY as PROJECT_FILE_ENTITY, accessOf };
