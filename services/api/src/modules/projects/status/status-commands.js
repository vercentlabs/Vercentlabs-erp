// Projects — Project Status, the commands: the only way a project's status changes. Each command locks the project, checks the version,
// asks the state machine whether the move is allowed, checks the person's permission and the move's own conditions, then changes the status
// once (a repeated request answers as before), records the transition (from, to, reason code and words, who, when, the version), writes the
// activity, announces it to automation and tells the right people. A status change never changes a task's or milestone's status, never moves
// a date, never touches time, expenses, sales orders, invoices or payments.
import {
  STATUS_LABEL, activeMemberIds, eligibleUsers, isoDay, notifyProject, progressChanged, projectEvent, projectSettings, publishProjectEvent, text, today, uuid, visibleProject,
} from "../project-core.js";
import {
  CANCEL_REASONS, HOLD_REASONS, HOLD_SEVERITIES, REOPEN_REASONS, assertTransition, reasonOf, statusError,
} from "./status-rules.js";
import { activationReadiness, cancellationReview, completionReadiness, holdOf, reopenReview, resumeReadiness } from "./status-read.js";

const keyOf = (input) => text(input.idempotencyKey, 200) || null;
const day = (value) => (value ? isoDay(value) : null);

// ------------------------------------------------------------------ the one transition
async function replayed(client, c, key) {
  if (!key) return null;
  const row = (await client.query(`SELECT project_id, to_status, action FROM tenant.project_status_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  return row ? { projectId: row.project_id, status: row.to_status, replayed: true } : null;
}
// The project, locked, visible, at the version the person saw, with the permission the action needs.
async function lockFor(client, c, projectId, input, permission) {
  const { project, access } = await visibleProject(client, c, projectId, { lock: true });
  if (permission && !access.can[permission]) throw statusError(403, "PROJECT_STATUS_PERMISSION_DENIED");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(project.row_version)) throw statusError(409, "PROJECT_STATUS_VERSION_CONFLICT");
  return { project, access };
}
async function transition(client, c, project, to, action, { reasonCode = null, reason = null, key = null, extra = {}, summary = null } = {}) {
  const sets = ["status = $3", "row_version = row_version + 1", "updated_by = $4", "updated_at = now()"];
  const values = [c.organizationId, project.id, to, c.userId ?? null];
  for (const [column, value] of Object.entries(extra)) { values.push(value); sets.push(`${column} = $${values.length}`); }
  const version = (await client.query(`UPDATE tenant.projects SET ${sets.join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING row_version`, values)).rows[0].row_version;
  await client.query(`INSERT INTO tenant.project_status_events (organization_id, project_id, action, from_status, to_status, reason, reason_code, project_version, actor_user_id, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.organizationId, project.id, action, project.status, to, reason, reasonCode, version, c.userId ?? null, key]);
  await projectEvent(client, c, project.id, action, summary ?? `${STATUS_LABEL[project.status]} → ${STATUS_LABEL[to]}${reason ? `: ${reason}` : ""}`);
  await progressChanged(client, c, project.id, { type: "PROJECT", id: project.id, action, from: project.status, to });
  await publishProjectEvent(client, c, { ...project, status: to }, action.toLowerCase(), { status: to, previousStatus: project.status, reasonCode });
  await publishProjectEvent(client, c, { ...project, status: to }, "status_changed", { status: to, previousStatus: project.status, action, reasonCode, version });
  return version;
}
const managerActive = async (client, c, project) => Boolean(project.manager_user_id) && (await eligibleUsers(client, c, [project.manager_user_id])).has(project.manager_user_id);
const team = (client, c, project) => activeMemberIds(client, c, project.id);

// ------------------------------------------------------------------ Draft → Planned
// Draft → Planned, or a request for approval where the company asks for it. input: { expectedVersion?, idempotencyKey? }
export async function activateProject(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project } = await lockFor(client, c, projectId, input, "start");
  if (project.status === "PLANNED") return { projectId: project.id, status: project.status, replayed: true };
  assertTransition(project, "activate");
  const check = await activationReadiness(client, c, project);
  if (!check.ready) throw statusError(400, check.problems[0].code, check.problems[0].message, { problems: check.problems });
  const settings = await projectSettings(client, c);
  if (settings.activationApprovalRequired && project.approval_status !== "APPROVED") {
    if (project.approval_status === "PENDING") return { projectId: project.id, status: "DRAFT", approval: "PENDING", replayed: true };
    await client.query(`UPDATE tenant.projects SET approval_status = 'PENDING', approval_requested_by = $3, approval_requested_at = now(), approval_note = NULL, row_version = row_version + 1, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id, c.userId ?? null]);
    await projectEvent(client, c, project.id, "APPROVAL_REQUESTED", "Activation sent for approval");
    return { projectId: project.id, status: "DRAFT", approval: "PENDING" };
  }
  await transition(client, c, project, "PLANNED", "ACTIVATED", { key: keyOf(input) });
  return { projectId: project.id, status: "PLANNED" };
}
// input: { decision: APPROVE | REJECT, note? } — someone other than the requester (unless the company allows self-approval).
export async function decideProjectActivation(client, c, projectId, input = {}) {
  const { project, access } = await lockFor(client, c, projectId, input, null);
  if (!access.can.approve) throw statusError(403, "PROJECT_STATUS_PERMISSION_DENIED");
  if (project.status !== "DRAFT" || project.approval_status !== "PENDING") throw statusError(409, "PROJECT_STATUS_INVALID_TRANSITION", "This project is not waiting for approval.");
  const settings = await projectSettings(client, c);
  if (project.approval_requested_by === c.userId && !settings.selfApprovalAllowed) throw statusError(403, "PROJECT_STATUS_PERMISSION_DENIED", "Someone other than the requester approves a project.");
  const decision = String(input.decision ?? "").toUpperCase();
  const note = text(input.note, 1000) || null;
  if (decision === "REJECT") {
    if (!note || note.length < 3) throw statusError(400, "PROJECT_REASON_REQUIRED", "Say why the project is not approved.");
    await client.query(`UPDATE tenant.projects SET approval_status = 'REJECTED', approval_note = $3, row_version = row_version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, project.id, note]);
    await projectEvent(client, c, project.id, "APPROVAL_REJECTED", note);
    await notifyProject(client, c, project, [project.approval_requested_by, project.manager_user_id], { title: `${project.project_code} was not approved`, message: note });
    return { projectId: project.id, status: "DRAFT", approval: "REJECTED" };
  }
  if (decision !== "APPROVE") throw statusError(400, "PROJECT_INPUT_INVALID", "Approve or reject.");
  const check = await activationReadiness(client, c, project);
  if (!check.ready) throw statusError(400, check.problems[0].code, check.problems[0].message, { problems: check.problems });
  await transition(client, c, project, "PLANNED", "APPROVED", { reason: note, extra: { approval_status: "APPROVED", approved_by: c.userId ?? null, approved_at: new Date(), approval_note: note } });
  await notifyProject(client, c, project, [project.approval_requested_by, project.manager_user_id], { title: `${project.project_code} approved`, message: "The project is planned and ready to start." });
  return { projectId: project.id, status: "PLANNED", approval: "APPROVED" };
}

// ------------------------------------------------------------------ Planned → In progress
// input: { startDate?, expectedVersion?, idempotencyKey? }. The planned start date stays as it was; the actual start is recorded beside it.
export async function startProject(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project } = await lockFor(client, c, projectId, input, "start");
  if (project.status === "IN_PROGRESS") return { projectId: project.id, status: project.status, replayed: true };
  assertTransition(project, "start");
  if (!(await managerActive(client, c, project))) throw statusError(409, "PROJECT_STATUS_MANAGER_REQUIRED");
  const started = input.startDate ? isoDay(input.startDate) : await today(client);
  if (started > await today(client)) throw statusError(400, "PROJECT_DATE_INVALID", "A project starts today or on a past date.", { field: "startDate" });
  await transition(client, c, project, "IN_PROGRESS", "STARTED", { key: keyOf(input), extra: { actual_start_date: started } });
  await notifyProject(client, c, project, await team(client, c, project), { title: `${project.project_code} has started`, message: `${project.name} is in progress.` });
  return { projectId: project.id, status: "IN_PROGRESS", actualStartDate: started };
}

// ------------------------------------------------------------------ hold
// One blocker: { reasonCode, description (or reason), severity?, ownerUserId?, sourceType?: TASK | MILESTONE, sourceId?, evidence? }.
async function blockerOf(client, c, project, input) {
  const code = String(input.reasonCode ?? "OTHER").toUpperCase();
  if (!HOLD_REASONS[code]) throw statusError(400, "PROJECT_INPUT_INVALID", "Choose why the project is paused.", { field: "reasonCode" });
  const description = text(input.description ?? input.reason, 2000);
  if (description.length < 3) throw statusError(400, "PROJECT_STATUS_HOLD_REASON_REQUIRED", undefined, { field: "description" });
  const severity = String(input.severity ?? "MEDIUM").toUpperCase();
  if (!HOLD_SEVERITIES[severity]) throw statusError(400, "PROJECT_INPUT_INVALID", "Choose the impact.", { field: "severity" });
  let owner = project.manager_user_id;
  if (input.ownerUserId) {
    owner = uuid(input.ownerUserId, "Hold owner");
    if (!(await eligibleUsers(client, c, [owner])).has(owner)) throw statusError(400, "PROJECT_INPUT_INVALID", "The owner is not an active member who can use Projects.", { field: "ownerUserId" });
  }
  let sourceType = null;
  let sourceId = null;
  if (input.sourceType && input.sourceId) {
    sourceType = String(input.sourceType).toUpperCase();
    sourceId = uuid(input.sourceId, "Linked record");
    const table = sourceType === "TASK" ? "project_tasks" : sourceType === "MILESTONE" ? "project_milestones" : null;
    if (!table || !(await client.query(`SELECT 1 FROM tenant.${table} WHERE organization_id = $1 AND id = $2 AND project_id = $3`, [c.organizationId, sourceId, project.id])).rows[0])
      throw statusError(400, "PROJECT_INPUT_INVALID", "Link a task or milestone of this project.", { field: "sourceId" });
  }
  return { code, description, severity, owner, sourceType, sourceId, evidence: text(input.evidence, 2000) || null };
}
async function insertBlocker(client, c, project, holdId, blocker) {
  return (await client.query(`INSERT INTO tenant.project_hold_reasons (organization_id, project_id, hold_id, reason_code, description, severity, owner_user_id, source_type, source_id, evidence, added_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [c.organizationId, project.id, holdId, blocker.code, blocker.description, blocker.severity, blocker.owner, blocker.sourceType, blocker.sourceId, blocker.evidence, c.userId ?? null])).rows[0].id;
}
// Planned or In progress → On hold, remembering which. input: { reasons: [blocker] } (or one blocker's fields directly), expectedResolutionDate?,
// expectedVersion?, idempotencyKey? Tasks, milestones, time, approvals, dates and the team stay exactly as they are.
export async function placeProjectOnHold(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project } = await lockFor(client, c, projectId, input, "hold");
  assertTransition(project, "hold");
  const raw = Array.isArray(input.reasons) && input.reasons.length ? input.reasons : [input];
  const blockers = [];
  for (const entry of raw) blockers.push(await blockerOf(client, c, project, entry));
  const expected = input.expectedResolutionDate ? isoDay(input.expectedResolutionDate) : null;
  const holdId = (await client.query(`INSERT INTO tenant.project_holds (organization_id, project_id, previous_status, reason, owner_user_id, expected_resolution_date, started_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [c.organizationId, project.id, project.status, blockers.map((row) => row.description).join("; ").slice(0, 2000), blockers[0].owner, expected, c.userId ?? null])).rows[0].id;
  for (const blocker of blockers) await insertBlocker(client, c, project, holdId, blocker);
  const summary = blockers.map((row) => `${HOLD_REASONS[row.code]}: ${row.description}`).join("; ");
  await transition(client, c, project, "ON_HOLD", "HELD", { reasonCode: blockers[0].code, reason: summary.slice(0, 2000), key: keyOf(input), extra: { previous_status: project.status } });
  await notifyProject(client, c, project, [...await team(client, c, project), ...blockers.map((row) => row.owner)], { title: `${project.project_code} is on hold`, message: summary.slice(0, 900) });
  return { projectId: project.id, status: "ON_HOLD", holdId };
}
// Another blocker on the active hold. input: blocker fields, idempotencyKey?
export async function addProjectHoldReason(client, c, projectId, input = {}) {
  const { project } = await lockFor(client, c, projectId, input, "hold");
  if (project.status !== "ON_HOLD") throw statusError(409, "PROJECT_STATUS_INVALID_TRANSITION", "The project is not on hold.");
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT details FROM tenant.project_events WHERE organization_id = $1 AND project_id = $2 AND action = 'HOLD_REASON_ADDED' AND details->>'key' = $3`,
      [c.organizationId, project.id, key])).rows[0];
    if (done) return { projectId: project.id, reasonId: done.details.reasonId, replayed: true };
  }
  const hold = await holdOf(client, c, project.id);
  const blocker = await blockerOf(client, c, project, input);
  const reasonId = await insertBlocker(client, c, project, hold.id, blocker);
  await client.query(`UPDATE tenant.projects SET row_version = row_version + 1, updated_at = now(), updated_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id, c.userId ?? null]);
  await projectEvent(client, c, project.id, "HOLD_REASON_ADDED", `Hold reason added — ${HOLD_REASONS[blocker.code]}: ${blocker.description}`, { reasonId, key, severity: blocker.severity });
  // A major blocker is announced to the team; any blocker to its owner.
  const audience = ["HIGH", "CRITICAL"].includes(blocker.severity) ? [...await team(client, c, project), blocker.owner] : [blocker.owner, project.manager_user_id];
  await notifyProject(client, c, project, audience, { title: `${project.project_code}: hold reason added`, message: `${HOLD_REASONS[blocker.code]} (${HOLD_SEVERITIES[blocker.severity]}): ${blocker.description}` });
  return { projectId: project.id, reasonId };
}
// Clear one blocker. input: { resolution, evidence?, idempotencyKey? }. Customer approval is cleared with its evidence. When the last blocker
// is cleared the manager is told the project may resume — it does not resume by itself.
export async function resolveProjectHoldReason(client, c, projectId, reasonId, input = {}) {
  const { project, access } = await lockFor(client, c, projectId, input, null);
  const reason = (await client.query(`SELECT * FROM tenant.project_hold_reasons WHERE organization_id = $1 AND project_id = $2 AND id = $3`, [c.organizationId, project.id, uuid(reasonId, "Hold reason")])).rows[0];
  if (!reason) throw statusError(404, "PROJECT_NOT_FOUND", "That hold reason is not on this project.");
  if (!(access.can.resume || access.can.hold || (reason.owner_user_id && reason.owner_user_id === c.userId))) throw statusError(403, "PROJECT_STATUS_PERMISSION_DENIED");
  if (reason.resolved_at) return { projectId: project.id, reasonId: reason.id, replayed: true };
  const resolution = text(input.resolution, 2000);
  if (resolution.length < 3) throw statusError(400, "PROJECT_REASON_REQUIRED", "Say how this reason was resolved.", { field: "resolution" });
  const evidence = text(input.evidence, 2000) || null;
  if (reason.reason_code === "CUSTOMER_APPROVAL_PENDING" && !evidence) throw statusError(400, "PROJECT_STATUS_CUSTOMER_ACCEPTANCE", "Record the customer's approval (who, when, how) as evidence.", { field: "evidence" });
  await client.query(`UPDATE tenant.project_hold_reasons SET resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4, resolution_evidence = $5 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, reason.id, c.userId ?? null, resolution, evidence]);
  await client.query(`UPDATE tenant.projects SET row_version = row_version + 1, updated_at = now(), updated_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id, c.userId ?? null]);
  await projectEvent(client, c, project.id, "HOLD_REASON_RESOLVED", `Hold reason resolved — ${HOLD_REASONS[reason.reason_code]}: ${resolution}`, { reasonId: reason.id });
  const open = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.project_hold_reasons WHERE organization_id = $1 AND hold_id = $2 AND resolved_at IS NULL`,
    [c.organizationId, reason.hold_id])).rows[0].n);
  if (!open) await notifyProject(client, c, project, [project.manager_user_id], { title: `${project.project_code} can resume`, message: "Every hold reason is resolved. Review and resume the project." });
  return { projectId: project.id, reasonId: reason.id, openReasons: open };
}
// On hold → the status it interrupted, once every blocker is resolved (a single remaining blocker may be resolved in the same step with
// input.resolution). input: { resolution?, evidence?, expectedVersion?, idempotencyKey? }. Blocked tasks stay blocked; dates stay as they are.
export async function resumeProject(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project } = await lockFor(client, c, projectId, input, "resume");
  assertTransition(project, "resume");
  let hold = await holdOf(client, c, project.id);
  const open = hold ? hold.reasons.filter((row) => !row.resolved) : [];
  if (open.length === 1 && text(input.resolution, 2000).length >= 3) {
    await resolveProjectHoldReason(client, c, project.id, open[0].id, { resolution: input.resolution, evidence: input.evidence });
    hold = await holdOf(client, c, project.id);
  }
  const readiness = await resumeReadiness(client, c, { ...project, row_version: project.row_version });
  const failing = readiness.checks.filter((row) => row.blocking);
  if (failing.length) {
    const code = failing[0].key === "blockers" ? "PROJECT_STATUS_HOLD_UNRESOLVED" : failing[0].key === "manager" ? "PROJECT_STATUS_MANAGER_REQUIRED" : "PROJECT_STATUS_INVALID_TRANSITION";
    throw statusError(409, code, failing[0].message, { checks: readiness.checks });
  }
  const back = hold?.previousStatus ?? project.previous_status;
  const fresh = (await client.query(`SELECT * FROM tenant.projects WHERE organization_id = $1 AND id = $2`, [c.organizationId, project.id])).rows[0];
  const summary = hold ? hold.reasons.map((row) => row.resolution).filter(Boolean).join("; ") : null;
  if (hold) await client.query(`UPDATE tenant.project_holds SET resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, hold.id, c.userId ?? null, (summary || "Resumed").slice(0, 2000)]);
  await transition(client, c, fresh, back, "RESUMED", { reason: summary, key: keyOf(input), extra: { previous_status: null } });
  await notifyProject(client, c, project, await team(client, c, project), { title: `${project.project_code} resumed`, message: `Back to ${STATUS_LABEL[back].toLowerCase()}${summary ? `: ${summary}` : ""}`.slice(0, 900) });
  return { projectId: project.id, status: back };
}

// ------------------------------------------------------------------ In progress → Completed
// input: { completionDate?, closingNote, deliverablesConfirmed, customerAcceptance?, acknowledgeOutstanding?, waivers?: [{ taskId, reason, impact }],
// expectedVersion?, idempotencyKey? }. Completion records its review (the checks as they stood, the waivers, what stays outstanding, the
// sign-off); open waived tasks stay open; nothing in Sales or Finance changes.
export async function completeProject(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project, access } = await lockFor(client, c, projectId, input, "complete");
  if (project.status === "COMPLETED") return { projectId: project.id, status: project.status, replayed: true };
  assertTransition(project, "complete");
  const check = await completionReadiness(client, c, project, input, { access });
  const blocking = check.checks.filter((row) => row.blocking);
  if (blocking.length) throw statusError(409, blocking[0].code ?? "PROJECT_STATUS_COMPLETION_CHECKS", blocking.map((row) => row.message).join(" "), { checks: check.checks });
  const note = text(input.closingNote, 4000);
  await client.query(`INSERT INTO tenant.project_completion_reviews (organization_id, project_id, project_version, completion_date, checks, waivers, outstanding, closing_note, customer_acceptance, signed_off_by)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [c.organizationId, project.id, project.row_version, check.completionDate, JSON.stringify(check.checks), JSON.stringify(check.waivers.map((row) => ({ ...row, approvedBy: c.userId, at: new Date().toISOString() }))),
      JSON.stringify(check.outstanding), note, text(input.customerAcceptance, 1000) || null, c.userId]);
  for (const waiver of check.waivers) await projectEvent(client, c, project.id, "COMPLETION_WAIVER", `${waiver.code} waived for completion: ${waiver.reason}${waiver.impact ? ` (impact: ${waiver.impact})` : ""}`, { taskId: waiver.id });
  await transition(client, c, project, "COMPLETED", "COMPLETED", { reason: note.slice(0, 2000), key: keyOf(input),
    extra: { completed_at: check.completionDate, completed_by: c.userId ?? null, completion_note: note } });
  await notifyProject(client, c, project, await team(client, c, project), { title: `${project.project_code} completed`, message: `${project.name} was completed on ${check.completionDate}.` });
  return { projectId: project.id, status: "COMPLETED", completedAt: check.completionDate, waivers: check.waivers.length };
}

// ------------------------------------------------------------------ Completed → In progress
// input: { reasonCode?, reason, acknowledgeReview?, expectedVersion?, idempotencyKey? }. The earlier completion and its review stay; accepted
// milestones stay accepted, done tasks stay done, issued billing stays — new work goes into new tasks or milestones.
export async function reopenProject(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project } = await lockFor(client, c, projectId, input, "reopen");
  if (project.status === "CANCELLED") throw statusError(409, "PROJECT_STATUS_REOPEN_NOT_ALLOWED", "A cancelled project is not reopened.");
  assertTransition(project, "reopen");
  const why = reasonOf(REOPEN_REASONS, input);
  if (why.missing) throw statusError(400, "PROJECT_REASON_REQUIRED", "Say why the project is reopened.", { field: "reason" });
  if (!(await managerActive(client, c, project))) throw statusError(409, "PROJECT_STATUS_MANAGER_REQUIRED");
  const review = await reopenReview(client, c, project);
  if (review.needsAcknowledgement && !input.acknowledgeReview) throw statusError(409, "PROJECT_STATUS_REOPEN_NOT_ALLOWED", "Review the accepted milestones and issued billing first: they stay as they are.", { review });
  await transition(client, c, project, "IN_PROGRESS", "REOPENED", { reasonCode: why.code, reason: why.text, key: keyOf(input),
    extra: { completed_at: null, completed_by: null, reopen_count: (project.reopen_count ?? 0) + 1, last_reopened_at: new Date(), last_reopened_by: c.userId ?? null },
    summary: `Reopened (completed ${day(project.completed_at)}): ${REOPEN_REASONS[why.code] ?? ""}${why.text && why.text !== REOPEN_REASONS[why.code] ? ` — ${why.text}` : ""}` });
  await notifyProject(client, c, project, await team(client, c, project), { title: `${project.project_code} reopened`, message: why.text ?? REOPEN_REASONS[why.code] });
  return { projectId: project.id, status: "IN_PROGRESS", reopenCount: (project.reopen_count ?? 0) + 1 };
}

// ------------------------------------------------------------------ → Cancelled
// Planned, In progress or On hold → Cancelled, after its dependencies are reviewed. input: { reasonCode?, reason, acknowledgeDependencies?,
// expectedVersion?, idempotencyKey? }. Nothing is deleted or reversed; an open hold is closed with it.
export async function cancelProject(client, c, projectId, input = {}) {
  const done = await replayed(client, c, keyOf(input));
  if (done) return done;
  const { project } = await lockFor(client, c, projectId, input, "cancel");
  if (project.status === "CANCELLED") return { projectId: project.id, status: project.status, replayed: true };
  assertTransition(project, "cancel");
  const why = reasonOf(CANCEL_REASONS, input);
  if (why.missing) throw statusError(400, "PROJECT_REASON_REQUIRED", "Say why the project is cancelled.", { field: "reason" });
  const review = await cancellationReview(client, c, project);
  const needsReview = review.dependencies.length > 0 || review.openTasks > 0 || review.openMilestones > 0;
  if (needsReview && !input.acknowledgeDependencies) throw statusError(409, "PROJECT_STATUS_CANCEL_DEPENDENCIES", undefined, { review });
  const reason = why.text && why.text !== CANCEL_REASONS[why.code] ? `${CANCEL_REASONS[why.code]}: ${why.text}` : (CANCEL_REASONS[why.code] ?? why.text);
  if (project.status === "ON_HOLD") {
    await client.query(`UPDATE tenant.project_hold_reasons SET resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4 WHERE organization_id = $1 AND project_id = $2 AND resolved_at IS NULL`,
      [c.organizationId, project.id, c.userId ?? null, `Project cancelled: ${reason}`.slice(0, 2000)]);
    await client.query(`UPDATE tenant.project_holds SET resolved_at = clock_timestamp(), resolved_by = $3, resolution = $4 WHERE organization_id = $1 AND project_id = $2 AND resolved_at IS NULL`,
      [c.organizationId, project.id, c.userId ?? null, `Project cancelled: ${reason}`.slice(0, 2000)]);
  }
  await transition(client, c, project, "CANCELLED", "CANCELLED", { reasonCode: why.code, reason, key: keyOf(input),
    extra: { cancelled_at: new Date(), cancelled_by: c.userId ?? null, cancel_reason: reason, previous_status: null } });
  await notifyProject(client, c, project, await team(client, c, project), { title: `${project.project_code} cancelled`, message: reason });
  return { projectId: project.id, status: "CANCELLED" };
}

