// Projects — Timesheets, corrections of approved time: approved time is never edited. A correction records the original and the proposed
// values — one corrected entry, or the time split into parts (six billable hours into four billable and two internal) — with the reason;
// someone authorized other than the requester and the employee approves it; then the original is voided (kept, with its approval) and the
// corrected entries are appended, approved, classified for billing under the project's policy and costed at the rate of their own work date
// (the worker, date and task identity stay). Billing already on the original is carried to corrected eligible time on the same contract line
// when it fits; invoiced minutes that no longer fit need the Sales adjustment named, and are reversed with it; reserved minutes are released.
import { publishDomainEvent } from "../../../core/platform/events/index.js";
import { billError } from "../billable/billable-rules.js";
import { has, seesAll, text, userNames, uuid } from "../project-core.js";
import { costEntry } from "./time-costing.js";
import { loadEntry, notifyTime, timeEvent, validateTimeEntryEligibility } from "./time-entries.js";
import {
  TIME, assertPeriodOpen, canTeam, description, hoursLabel, keyOf, loadProjectRow, readDuration, resolveInterval, timeError, timePolicy, workDay,
} from "./time-rules.js";

const valuesOf = (entry) => ({ projectId: entry.project_id, taskId: entry.task_id, workDate: entry.work_date_text, durationMinutes: entry.duration_minutes, billable: entry.billable,
  classification: entry.billing_classification, reasonCode: entry.billing_reason_code, reasonNote: entry.billing_reason_note, contractLineId: entry.contract_line_id,
  description: entry.description, startAt: entry.start_at, endAt: entry.end_at });
const SAME = ["projectId", "taskId", "workDate", "durationMinutes", "billable", "classification", "reasonCode", "contractLineId", "description", "startAt"];

// Where the original's billing goes: each allocation (invoiced first) moves whole to a corrected part eligible on the same contract line with
// room for it; what does not fit is released (reserved) or needs Sales's adjustment (invoiced).
function billingPlan(allocations, parts) {
  const room = parts.map((part) => (part.classification === "TIME_AND_MATERIALS_ELIGIBLE" ? part.durationMinutes : 0));
  const carried = [];
  const dropped = [];
  for (const allocation of [...allocations].sort((a, b) => (a.status === "INVOICED" ? 0 : 1) - (b.status === "INVOICED" ? 0 : 1))) {
    const index = parts.findIndex((part, i) => part.contractLineId === allocation.contract_line_id && room[i] >= allocation.allocated_minutes);
    if (index >= 0) { room[index] -= allocation.allocated_minutes; carried.push({ allocation, part: index }); } else dropped.push(allocation);
  }
  const invoicedDropped = dropped.filter((row) => row.status === "INVOICED").reduce((sum, row) => sum + row.allocated_minutes, 0);
  return { carried, dropped, invoicedDropped };
}
const activeAllocations = async (client, c, entryId, lock = false) => (await client.query(`SELECT * FROM tenant.project_time_billing_allocations WHERE organization_id = $1 AND entry_id = $2 AND status <> 'REVERSED'
    ORDER BY requested_at${lock ? " FOR UPDATE" : ""}`, [c.organizationId, entryId])).rows;

// One corrected part, checked in full for the person who worked it (their date, task and identity stay unless the correction changes them).
async function proposePart(client, c, { entry, target, project, policy, input, base }) {
  const day = workDay(input.workDate ?? base.workDate);
  const timing = input.durationMinutes !== undefined || input.hours !== undefined || input.minutes !== undefined || input.startTime !== undefined;
  const { duration: given, interval: clock } = readDuration(timing ? input : { durationMinutes: entry.start_at ? undefined : entry.duration_minutes, startTime: entry.start_time ?? undefined, endTime: entry.end_time ?? undefined }, policy);
  const interval = await resolveInterval(client, policy, day, clock, given);
  const taskId = input.taskId === undefined ? (target.id === project.id ? entry.task_id : null) : input.taskId || null;
  const billable = input.billable === undefined || input.billable === null ? entry.billable : Boolean(input.billable);
  const keepBilling = billable === entry.billable && target.id === project.id;
  const words = description(input.description ?? entry.description);
  await assertPeriodOpen(client, c, day);
  const check = await validateTimeEntryEligibility(client, c, { project: target, employeeUserId: entry.employee_user_id, taskId, day, interval, duration: interval.duration, billable,
    contractLineId: input.contractLineId || null, preferredLineId: keepBilling ? entry.contract_line_id : null,
    reasonCode: input.billingReasonCode !== undefined ? input.billingReasonCode || null : keepBilling ? entry.billing_reason_code : null,
    reasonNote: input.billingReasonNote !== undefined ? input.billingReasonNote || null : keepBilling ? entry.billing_reason_note : null,
    excludeEntryId: entry.id, policy, delegated: entry.employee_user_id !== c.userId, recording: false });
  const b = check.billing;
  return { projectId: target.id, taskId, workDate: day, durationMinutes: interval.duration, billable: b.billable, classification: b.classification, reasonCode: b.reasonCode, reasonNote: b.reasonNote,
    contractLineId: b.contractLineId, policyVersion: b.policyVersion, description: words, startAt: interval.startAt, endAt: interval.endAt, flags: check.flags };
}

// input: { kind: ADJUST | VOID, projectId?, taskId?, workDate?, durationMinutes | hours + minutes, startTime?, endTime?, billable?, contractLineId?, billingReasonCode?,
// billingReasonNote?, description?, parts? ([{ durationMinutes, billable?, billingReasonCode?, billingReasonNote?, contractLineId?, description? }] — a split), reason, idempotencyKey? }
export async function requestApprovedTimeCorrection(client, c, entryId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const done = (await client.query(`SELECT id, status FROM tenant.project_time_corrections WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (done) return { correctionId: done.id, status: done.status, replayed: true };
  }
  const entry = await loadEntry(client, c, entryId, { lock: true });
  const project = await loadProjectRow(client, c, entry.project_id);
  const own = entry.employee_user_id === c.userId && has(c, TIME.create);
  const authorized = has(c, TIME.correct) && canTeam(c, project);
  if (!own && !authorized) throw timeError(403, "TIME_PERMISSION_DENIED");
  if (entry.entry_status !== "APPROVED") throw timeError(409, "TIME_CORRECTION_INVALID", entry.entry_status === "VOIDED" ? "This time was already corrected or voided." : "Only approved time is corrected; unsubmitted time is edited directly.");
  if ((await client.query(`SELECT 1 FROM tenant.project_time_corrections WHERE organization_id = $1 AND entry_id = $2 AND status = 'REQUESTED'`, [c.organizationId, entry.id])).rows[0]) {
    throw timeError(409, "TIME_CORRECTION_INVALID", "A correction of this time is already waiting for a decision.");
  }
  const reason = text(input.reason, 1000);
  if (reason.length < 3) throw timeError(400, "TIME_REASON_REQUIRED", "Say why the approved time is being corrected.");
  const kind = String(input.kind ?? "ADJUST").toUpperCase();
  if (!["ADJUST", "VOID"].includes(kind)) throw timeError(400, "TIME_CORRECTION_INVALID");
  await assertPeriodOpen(client, c, entry.work_date_text);
  const policy = await timePolicy(client, c);
  let proposed = {};
  let parts = [];
  let target = project;
  if (kind === "ADJUST") {
    target = input.projectId && input.projectId !== entry.project_id ? await loadProjectRow(client, c, input.projectId) : project;
    // Moving approved time to another project takes the authority to correct time on both.
    if (target.id !== project.id && !(has(c, TIME.correct) && canTeam(c, project) && canTeam(c, target))) throw timeError(403, "TIME_PERMISSION_DENIED", "Moving approved time to another project needs a reviewer of both projects.");
    const base = { workDate: entry.work_date_text };
    if (Array.isArray(input.parts) && input.parts.length) {
      if (input.parts.length > 10) throw timeError(400, "TIME_CORRECTION_INVALID", "Split the time into at most ten parts.");
      if (entry.start_at) throw timeError(400, "TIME_CORRECTION_INVALID", "Timed entries are corrected as one entry; split duration-only time.");
      for (const part of input.parts) parts.push(await proposePart(client, c, { entry, target, project, policy, input: { ...part, workDate: input.workDate, taskId: input.taskId }, base }));
      proposed = { parts };
    } else {
      parts = [await proposePart(client, c, { entry, target, project, policy, input, base })];
      proposed = parts[0];
      const original = valuesOf(entry);
      if (SAME.every((field) => String(original[field] ?? "") === String(proposed[field] ?? ""))) throw timeError(400, "TIME_CORRECTION_INVALID", "The corrected values are the same as the approved ones.");
    }
  }
  const plan = billingPlan(await activeAllocations(client, c, entry.id), parts);
  const adjustment = plan.invoicedDropped > 0;
  const invoiced = (await activeAllocations(client, c, entry.id)).filter((row) => row.status === "INVOICED").reduce((sum, row) => sum + row.allocated_minutes, 0);
  const row = (await client.query(`INSERT INTO tenant.project_time_corrections (organization_id, entry_id, project_id, employee_user_id, kind, original, proposed, reason, requested_by, billing_adjustment_required, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING id, correction_number`,
  [c.organizationId, entry.id, entry.project_id, entry.employee_user_id, kind, JSON.stringify(valuesOf(entry)), JSON.stringify(proposed), reason, c.userId, adjustment, key])).rows[0];
  await timeEvent(client, c, { projectId: entry.project_id, employeeUserId: entry.employee_user_id, entryId: entry.id, correctionId: row.id, action: "CORRECTION_REQUESTED",
    summary: `${kind === "VOID" ? "Void" : parts.length > 1 ? `Split into ${parts.length}` : "Correct"} TE-${entry.entry_number}: ${reason}`, details: { proposed, invoicedMinutes: invoiced } });
  const reviewers = [project.manager_user_id, ...(target.id !== project.id ? [target.manager_user_id] : [])].filter((id) => id && id !== entry.employee_user_id);
  await notifyTime(client, c, reviewers, { title: `Correction of approved time on ${project.project_code}`, message: `TE-${entry.entry_number} (${hoursLabel(entry.duration_minutes)} on ${entry.work_date_text}): ${reason}`,
    href: "/projects/timesheets/corrections", entityType: "projects.time_correction", entityId: row.id });
  return { correctionId: row.id, correctionNumber: `TC-${row.correction_number}`, status: "REQUESTED", billingAdjustmentRequired: adjustment, billedMinutes: invoiced, adjustmentMinutes: plan.invoicedDropped };
}
// Billability corrections are corrections of approved time that change its classification (or split it).
export const requestBillabilityCorrection = (client, c, entryId, input = {}) => requestApprovedTimeCorrection(client, c, entryId, { ...input, kind: "ADJUST" });

async function lockCorrection(client, c, correctionId) {
  const row = (await client.query(`SELECT * FROM tenant.project_time_corrections WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(correctionId, "Correction")])).rows[0];
  if (!row) throw timeError(404, "TIME_NOT_FOUND");
  return row;
}
async function mayDecideCorrection(client, c, correction) {
  const project = await loadProjectRow(client, c, correction.project_id);
  const targetId = correction.proposed?.projectId ?? correction.proposed?.parts?.[0]?.projectId;
  const target = targetId && targetId !== project.id ? await loadProjectRow(client, c, targetId) : project;
  const allowed = has(c, TIME.correct) && (seesAll(c) || (project.manager_user_id === c.userId && target.manager_user_id === c.userId))
    && c.userId !== correction.requested_by && c.userId !== correction.employee_user_id;
  if (!allowed) throw timeError(403, "TIME_APPROVAL_PERMISSION_DENIED", "Someone other than the requester and the employee, who corrects time on the project, decides this correction.");
  return { project, target };
}

// input: { note?, billingAdjustmentReference? (the Sales credit note or invoice adjustment, when invoiced time changes), expectedVersion?, idempotencyKey? }
export async function approveTimeCorrection(client, c, correctionId, input = {}) {
  const key = keyOf(input);
  const correction = await lockCorrection(client, c, correctionId);
  if (correction.status === "APPLIED" && key && correction.decision_key === key) return { correctionId: correction.id, status: "APPLIED", replacementEntryId: correction.replacement_entry_id, replayed: true };
  if (correction.status !== "REQUESTED") throw timeError(409, "TIME_CORRECTION_INVALID", `This correction was already ${correction.status.toLowerCase()}.`);
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(correction.row_version)) throw timeError(409, "TIME_VERSION_CONFLICT");
  const { project } = await mayDecideCorrection(client, c, correction);
  const entry = await loadEntry(client, c, correction.entry_id, { lock: true });
  if (entry.entry_status !== "APPROVED") throw timeError(409, "TIME_CORRECTION_INVALID", "The approved time changed since the correction was requested.");
  await assertPeriodOpen(client, c, entry.work_date_text);
  const parts = correction.kind === "VOID" ? [] : correction.proposed?.parts ?? [correction.proposed];
  for (const part of parts) await assertPeriodOpen(client, c, part.workDate);
  const allocations = await activeAllocations(client, c, entry.id, true);
  const plan = billingPlan(allocations, parts);
  const reference = text(input.billingAdjustmentReference, 200) || null;
  if (plan.invoicedDropped > 0 && !reference) {
    throw billError(409, "TIME_BILLING_INVOICE_EXISTS", `${hoursLabel(plan.invoicedDropped)} of this time is invoiced and no longer covered. Name the Sales adjustment (credit note or invoice correction) for it.`,
      { invoicedMinutes: plan.invoicedDropped });
  }
  const note = text(input.note, 1000) || null;
  // The original's billing leaves it: carried, released (reserved minutes; the request shrinks), or reversed with Sales's adjustment (invoiced).
  for (const allocation of allocations) {
    const carried = plan.carried.some((row) => row.allocation.id === allocation.id);
    const kind = carried ? "CARRIED" : allocation.status === "INVOICED" ? "CORRECTED" : "RELEASED";
    await client.query(`UPDATE tenant.project_time_billing_allocations SET status = 'REVERSED', reversal_kind = $3, reversed_by = $4, reversed_at = now(), reversal_reason = $5, reversal_reference = $6
        WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, kind, c.userId, `Corrected time: ${correction.reason}`.slice(0, 500),
      carried ? "Carried to the corrected entry" : allocation.status === "INVOICED" ? reference : "Released by the correction"]);
    if (!carried && allocation.status === "REQUESTED") {
      await client.query(`UPDATE tenant.project_time_billing_requests SET total_minutes = total_minutes - $3, estimated_amount = round((total_minutes - $3) * hourly_rate / 60, 2), row_version = row_version + 1,
          status = CASE WHEN total_minutes - $3 <= 0 THEN 'CANCELLED' ELSE status END, cancel_reason = CASE WHEN total_minutes - $3 <= 0 THEN 'Released by a correction of its time' ELSE cancel_reason END,
          cancelled_at = CASE WHEN total_minutes - $3 <= 0 THEN now() ELSE cancelled_at END WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.billing_request_id, allocation.allocated_minutes]);
    }
  }
  await client.query(`UPDATE tenant.project_time_entries SET entry_status = 'VOIDED', voided_by = $3, voided_at = now(), void_reason = $4, correction_id = $5, row_version = row_version + 1, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [c.organizationId, entry.id, c.userId, `Corrected: ${correction.reason}`.slice(0, 500), correction.id]);
  const replacements = [];
  for (const part of parts) {
    const row = (await client.query(`INSERT INTO tenant.project_time_entries (organization_id, employee_user_id, entered_by, project_id, task_id, work_date, start_at, end_at, duration_minutes, description, billable,
          entry_status, review_flags, corrects_entry_id, correction_id, approved_by, approved_at, created_by, updated_by, billing_classification, billing_reason_code, billing_reason_note, billing_policy_version,
          contract_line_id, classification_updated_by, classification_updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'APPROVED',$12::jsonb,$13,$14,$15,now(),$15,$15,$16,$17,$18,$19,$20,$15,now()) RETURNING *, to_char(work_date, 'YYYY-MM-DD') AS work_date_text`,
    [c.organizationId, entry.employee_user_id, entry.entered_by, part.projectId, part.taskId ?? null, part.workDate, part.startAt ?? null, part.endAt ?? null, part.durationMinutes,
      part.description, Boolean(part.billable), JSON.stringify(part.flags ?? []), entry.id, correction.id, c.userId, part.classification ?? "NON_BILLABLE", part.reasonCode ?? null, part.reasonNote ?? null,
      part.policyVersion ?? null, part.contractLineId ?? null])).rows[0];
    await costEntry(client, c, row);
    replacements.push(row);
    await timeEvent(client, c, { projectId: row.project_id, employeeUserId: entry.employee_user_id, entryId: row.id, correctionId: correction.id, action: "CORRECTED_ENTRY", to: "APPROVED",
      summary: `Replaces TE-${entry.entry_number}: ${hoursLabel(row.duration_minutes)} on ${row.work_date_text}` });
  }
  for (const { allocation, part } of plan.carried) {
    await client.query(`INSERT INTO tenant.project_time_billing_allocations (organization_id, entry_id, project_id, billing_request_id, allocated_minutes, status, contract_line_id, hourly_rate, currency,
          customer_invoice_id, customer_invoice_line_id, requested_by, requested_at, invoiced_by, invoiced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [c.organizationId, replacements[part].id, replacements[part].project_id, allocation.billing_request_id, allocation.allocated_minutes, allocation.status, allocation.contract_line_id, allocation.hourly_rate,
      allocation.currency, allocation.customer_invoice_id, allocation.customer_invoice_line_id, allocation.requested_by, allocation.requested_at, allocation.invoiced_by, allocation.invoiced_at]);
  }
  const costs = replacements.length ? (await client.query(`SELECT COALESCE(sum(cost_amount), 0) AS cost, bool_and(cost_amount IS NOT NULL) AS all_costed, min(cost_currency) AS currency FROM tenant.project_time_entries
      WHERE id = ANY($1::uuid[])`, [replacements.map((row) => row.id)])).rows[0] : null;
  // A reclassification keeps the cost of the hours worked; only changed hours or dates change it.
  const costAdjustment = { from: entry.cost_amount === null ? null : String(entry.cost_amount), to: costs && costs.all_costed ? String(costs.cost) : costs ? null : "0", currency: costs?.currency ?? entry.cost_currency,
    replacementEntryIds: replacements.map((row) => row.id) };
  if (costAdjustment.from !== null && costAdjustment.to !== null) costAdjustment.delta = String(Number(costAdjustment.to) - Number(costAdjustment.from));
  await client.query(`UPDATE tenant.project_time_corrections SET status = 'APPLIED', decided_by = $3, decided_at = now(), decision_note = $4, replacement_entry_id = $5, cost_adjustment = $6::jsonb,
      billing_adjustment_required = $7, billing_adjustment_reference = $8, decision_key = $9, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
  [c.organizationId, correction.id, c.userId, note, replacements[0]?.id ?? null, JSON.stringify(costAdjustment), plan.invoicedDropped > 0, plan.invoicedDropped > 0 ? reference : null, key]);
  await timeEvent(client, c, { projectId: entry.project_id, employeeUserId: entry.employee_user_id, entryId: entry.id, correctionId: correction.id, action: "CORRECTION_APPLIED", from: "APPROVED", to: "VOIDED",
    summary: `${correction.kind === "VOID" ? "Voided" : "Corrected"}: ${correction.reason}`, details: { replacementEntryIds: costAdjustment.replacementEntryIds, costAdjustment,
      billingAdjustment: plan.invoicedDropped > 0 ? reference : null, carriedAllocations: plan.carried.length } });
  await notifyTime(client, c, [entry.employee_user_id, correction.requested_by, project.manager_user_id], { title: `Correction of approved time applied on ${project.project_code}`,
    message: `TE-${entry.entry_number}: ${correction.reason}${plan.invoicedDropped > 0 ? ` (billing adjusted: ${reference})` : ""}.`, href: "/projects/timesheets/corrections",
    entityType: "projects.time_correction", entityId: correction.id });
  await publishDomainEvent(client, { organizationId: c.organizationId, moduleKey: "projects", eventType: "projects.timesheet.correction_applied", entityType: "projects.timesheet",
    entityId: entry.submission_id ?? correction.id, payload: { projectId: entry.project_id, employeeUserId: entry.employee_user_id, correctionId: correction.id, status: "APPLIED" } });
  return { correctionId: correction.id, status: "APPLIED", replacementEntryId: replacements[0]?.id ?? null, replacementEntryIds: replacements.map((row) => row.id),
    billingReversed: plan.invoicedDropped > 0, carried: plan.carried.length, costAdjustment };
}

// input: { note (why not) }
export async function rejectTimeCorrection(client, c, correctionId, input = {}) {
  const correction = await lockCorrection(client, c, correctionId);
  if (correction.status !== "REQUESTED") throw timeError(409, "TIME_CORRECTION_INVALID", `This correction was already ${correction.status.toLowerCase()}.`);
  const { project } = await mayDecideCorrection(client, c, correction);
  const note = text(input.note, 1000);
  if (note.length < 3) throw timeError(400, "TIME_REASON_REQUIRED", "Say why the correction is not applied.");
  await client.query(`UPDATE tenant.project_time_corrections SET status = 'REJECTED', decided_by = $3, decided_at = now(), decision_note = $4, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, correction.id, c.userId, note]);
  await timeEvent(client, c, { projectId: correction.project_id, employeeUserId: correction.employee_user_id, entryId: correction.entry_id, correctionId: correction.id, action: "CORRECTION_REJECTED", summary: note });
  const names = await userNames(client, [c.userId]);
  await notifyTime(client, c, [correction.requested_by, correction.employee_user_id], { title: `Correction not applied on ${project.project_code}`, message: `${names.get(c.userId) ?? "The reviewer"}: ${note}`,
    href: "/projects/timesheets/corrections", entityType: "projects.time_correction", entityId: correction.id });
  return { correctionId: correction.id, status: "REJECTED" };
}
