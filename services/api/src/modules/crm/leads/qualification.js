// Lead qualification: the answers (need, budget, authority, timeframe), the
// organization's requirements, and the decisions built on them.
//
//   open ──qualify──▶ qualified ──convert──▶ converted
//     │                   │
//     └──disqualify──▶ disqualified ──reopen──▶ open   (qualified can reopen too)
//
// Qualifying is an operation, not a field edit: it checks the required
// criteria and refuses with the list of what is missing. A manager with the
// override permission may qualify anyway, with a reason. Disqualifying never
// deletes anything, and every answer and decision is kept in the
// qualification history.
import { CrmError } from "../data-management/errors.js";
import { leadCan, requireLeadPermission } from "./access.js";
import {
  LEAD_AUTHORITY_STATUSES, LEAD_BUDGET_STATUSES, LEAD_DISQUALIFICATION_REASONS, LEAD_NEED_STATUSES, LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES,
  LEAD_RATINGS, leadDisqualificationReasonLabel,
} from "./constants.js";
import { recordLeadHistory } from "./history.js";
import { DEFAULT_QUALIFICATION_REQUIREMENTS, evaluateLeadQualification, leadQualificationStatus } from "./qualification-criteria.js";
import { listLeadQualificationEvents, recordLeadQualificationEvent } from "./qualification-history.js";
import { getLead, lockLead, readLeadRow, runLeadBulkOperation } from "./records.js";

const REASONS = LEAD_DISQUALIFICATION_REASONS.map((entry) => entry.code);
const RATING_LABELS = { cold: "Cold", warm: "Warm", hot: "Hot" };
const MAX_AMOUNT = 1_000_000_000_000;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const text = (value) => String(value ?? "").trim();
const invalid = (message) => new CrmError(400, message, "CRM_LEAD_QUALIFICATION_VALIDATION");

function choice(list, label) {
  const codes = list.map((entry) => entry.code ?? entry);
  return (raw) => {
    const value = text(raw).toLowerCase();
    if (!codes.includes(value)) throw invalid(`Choose a value for ${label}.`);
    return value;
  };
}
function amount(label, { empty = null } = {}) {
  return (raw) => {
    if (raw === null || text(raw) === "") return empty;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw invalid(`Enter ${label} of zero or more.`);
    return value;
  };
}
const longText = (raw) => text(raw).slice(0, 4000) || null;
const labelFrom = (list) => (value) => list.find((entry) => entry.code === value)?.label ?? value ?? null;
const plain = (value) => (value === null || value === undefined || value === "" ? null : String(value));
const money = (value) => (value === null || value === undefined || value === "" ? null : String(Number(value)));

// input field -> where it is stored, how it is normalized and how the
// history shows it. `on: "lead"` fields stay on the lead record, where the
// form, the list and conversion already read them.
const FIELDS = Object.freeze({
  needStatus: { on: "qualification", column: "need_status", label: "Need", normalize: choice(LEAD_NEED_STATUSES, "Need identified"), show: labelFrom(LEAD_NEED_STATUSES) },
  businessNeed: { on: "qualification", column: "need_description", label: "Business need", normalize: longText, show: plain },
  budgetStatus: { on: "qualification", column: "budget_status", label: "Budget", normalize: choice(LEAD_BUDGET_STATUSES, "Budget"), show: labelFrom(LEAD_BUDGET_STATUSES) },
  budgetMin: { on: "qualification", column: "budget_min", label: "Budget from", normalize: amount("a budget"), show: money },
  budgetMax: { on: "qualification", column: "budget_max", label: "Budget to", normalize: amount("a budget"), show: money },
  authorityStatus: { on: "qualification", column: "authority_status", label: "Decision authority", normalize: choice(LEAD_AUTHORITY_STATUSES, "Decision authority"), show: labelFrom(LEAD_AUTHORITY_STATUSES) },
  authorityDetail: { on: "qualification", column: "authority_detail", label: "Decision makers", normalize: (raw) => text(raw).slice(0, 500) || null, show: plain },
  qualificationNotes: { on: "qualification", column: "notes", label: "Qualification notes", normalize: longText, show: plain },
  purchaseTimeframe: { on: "lead", column: "purchase_timeframe", label: "Purchase timeframe", normalize: (raw) => (text(raw) ? choice(LEAD_PURCHASE_TIMEFRAMES, "Purchase timeframe")(raw) : null), show: labelFrom(LEAD_PURCHASE_TIMEFRAMES) },
  productInterest: { on: "lead", column: "product_interest", label: "Product / service interest", normalize: longText, show: plain },
  estimatedValue: { on: "lead", column: "estimated_value", label: "Estimated deal value", normalize: amount("an estimated value", { empty: 0 }), show: money },
  rating: { on: "lead", column: "rating", label: "Rating", normalize: choice(LEAD_RATINGS, "Rating"), show: (value) => RATING_LABELS[value] ?? value },
});

// A lead nobody has started qualifying has no record yet: its answers are "unknown".
const UNANSWERED = Object.freeze({ needStatus: "unknown", budgetStatus: "unknown", authorityStatus: "unknown" });
const stored = (lead, field) => lead[FIELDS[field].on === "lead" ? FIELDS[field].column : `q_${FIELDS[field].column}`] ?? UNANSWERED[field] ?? null;
const same = (left, right) => (left === null || left === undefined ? "" : String(typeof left === "number" || /^\d+(\.\d+)?$/.test(String(left)) ? Number(left) : left))
  === (right === null || right === undefined ? "" : String(typeof right === "number" || /^\d+(\.\d+)?$/.test(String(right)) ? Number(right) : right));

// ------------------------------------------------------------------ requirements

function toRequirements(row) {
  if (!row) return { ...DEFAULT_QUALIFICATION_REQUIREMENTS };
  return { need: row.need_required, budget: row.budget_required, authority: row.authority_required, timeline: row.timeline_required };
}

// Which criteria must be met before a lead can be qualified.
export async function getLeadQualificationSettings(client, context) {
  const { rows } = await client.query(`SELECT * FROM tenant.crm_lead_qualification_settings WHERE organization_id = $1`, [context.organizationId]);
  return toRequirements(rows[0]);
}

// input: { need?, budget?, authority?, timeline? } — booleans
export async function saveLeadQualificationSettings(client, context, input = {}) {
  if (!leadCan(context, "crm.settings.manage")) throw new CrmError(403, "You do not have permission to change the qualification requirements.", "PERMISSION_DENIED");
  const next = { ...(await getLeadQualificationSettings(client, context)) };
  for (const key of Object.keys(next)) if (has(input, key)) next[key] = input[key] === true;
  await client.query(
    `INSERT INTO tenant.crm_lead_qualification_settings (organization_id, need_required, budget_required, authority_required, timeline_required, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (organization_id) DO UPDATE SET need_required = EXCLUDED.need_required, budget_required = EXCLUDED.budget_required,
       authority_required = EXCLUDED.authority_required, timeline_required = EXCLUDED.timeline_required, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, next.need, next.budget, next.authority, next.timeline, context.userId ?? null],
  );
  return next;
}

// ------------------------------------------------------------------ answers

// Creates the qualification record the first time the lead is worked on.
async function ensureStarted(client, context, lead) {
  const created = await client.query(
    `INSERT INTO tenant.crm_lead_qualifications (organization_id, lead_id, created_by, updated_by) VALUES ($1, $2, $3, $3)
     ON CONFLICT (organization_id, lead_id) DO NOTHING RETURNING lead_id`,
    [context.organizationId, lead.id, context.userId ?? null],
  );
  if (created.rows[0]) await recordLeadQualificationEvent(client, context, lead.id, { type: "started" });
  return Boolean(created.rows[0]);
}

// Writes the answers present in `input`; returns the fields that changed.
async function writeAnswers(client, context, lead, input) {
  const fields = Object.keys(FIELDS).filter((field) => has(input, field));
  const next = Object.fromEntries(fields.map((field) => [field, FIELDS[field].normalize(input[field])]));
  const budgetMin = has(next, "budgetMin") ? next.budgetMin : stored(lead, "budgetMin");
  const budgetMax = has(next, "budgetMax") ? next.budgetMax : stored(lead, "budgetMax");
  if (budgetMin !== null && budgetMax !== null && Number(budgetMin) > Number(budgetMax)) throw invalid("The budget range must start below where it ends.");

  const changed = fields.filter((field) => !same(stored(lead, field), next[field]));
  if (!changed.length) return [];
  // A rating alone is a judgement about the lead, not the start of qualifying it.
  if (changed.some((field) => field !== "rating")) await ensureStarted(client, context, lead);

  for (const on of ["qualification", "lead"]) {
    const subset = changed.filter((field) => FIELDS[field].on === on);
    if (!subset.length) continue;
    const table = on === "lead" ? "tenant.crm_leads" : "tenant.crm_lead_qualifications";
    const key = on === "lead" ? "id" : "lead_id";
    await client.query(
      `UPDATE ${table} SET ${subset.map((field, index) => `${FIELDS[field].column} = $${index + 3}`).join(", ")}, updated_by = $${subset.length + 3}
        WHERE organization_id = $1 AND ${key} = $2`,
      [context.organizationId, lead.id, ...subset.map((field) => next[field]), context.userId ?? null],
    );
  }
  for (const field of changed)
    await recordLeadQualificationEvent(client, context, lead.id, {
      type: field === "rating" ? "rating_changed" : "updated",
      field: FIELDS[field].label,
      oldValue: FIELDS[field].show(stored(lead, field)),
      newValue: FIELDS[field].show(next[field]),
    });
  await recordLeadHistory(client, context, lead.id, "qualification_updated", "Qualification details updated", { fields: changed });
  return changed;
}

function assertWorkable(lead) {
  if (lead.archived_at) throw new CrmError(409, "Restore this lead before changing it.", "CRM_LEAD_ARCHIVED");
  if (lead.status === "converted") throw new CrmError(409, "A converted lead is read-only.", "CRM_LEAD_CONVERTED");
}

// Everything the lead page needs about qualification in one read: the
// status, the checklist, what is missing, the score and the history.
export async function getLeadQualification(client, context, leadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const row = await readLeadRow(client, context, leadId);
  const lead = { id: row.id };
  const requirements = await getLeadQualificationSettings(client, context);
  const evaluation = evaluateLeadQualification(row, requirements);
  return {
    leadId: lead.id,
    status: leadQualificationStatus(row),
    requirements,
    ...evaluation,
    canOverride: leadCan(context, LEAD_PERMISSIONS.overrideQualification),
    history: await listLeadQualificationEvents(client, context, lead.id),
  };
}

// Marks the lead as being qualified, before any answer is known.
export async function startQualification(client, context, leadId) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to edit leads.");
  const lead = await lockLead(client, context, leadId);
  assertWorkable(lead);
  if (lead.status !== "open") throw new CrmError(409, `Reopen this lead before qualifying it again. It is ${lead.status}.`, "CRM_LEAD_STATUS_CONFLICT");
  return { started: await ensureStarted(client, context, lead) };
}

// Saves the qualification answers without deciding anything.
export async function updateQualification(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.edit, "You do not have permission to edit leads.");
  const lead = await lockLead(client, context, leadId);
  assertWorkable(lead);
  // The answers behind a decision are part of its record: reopen first.
  if (lead.status !== "open" && Object.keys(FIELDS).some((field) => field !== "rating" && has(input, field) && !same(stored(lead, field), FIELDS[field].normalize(input[field]))))
    throw new CrmError(409, `Reopen this lead before changing its qualification. It is ${lead.status}.`, "CRM_LEAD_STATUS_CONFLICT");
  const changed = await writeAnswers(client, context, lead, input);
  return { changed: changed.length > 0, fields: changed };
}
export const saveLeadQualification = updateQualification;

// Cold, warm or hot: the salesperson's own judgement, independent of status.
export async function rateLead(client, context, leadId, input = {}) {
  return updateQualification(client, context, leadId, { rating: input.rating });
}

// ------------------------------------------------------------------ decisions

// input: the answers to save with the decision, plus
//   override, overrideReason   qualify although required criteria are missing
//                              (needs crm.leads.override_qualification)
export async function qualifyLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.qualify, "You do not have permission to qualify leads.");
  let lead = await lockLead(client, context, leadId);
  if (lead.status === "converted") throw new CrmError(409, "This lead has already been converted.", "CRM_LEAD_ALREADY_CONVERTED");
  if (lead.status !== "open")
    throw new CrmError(409, lead.status === "qualified" ? "This lead is already qualified." : "Reopen this lead before qualifying it again.", "CRM_LEAD_STATUS_CONFLICT");
  if ((await writeAnswers(client, context, lead, input)).length) lead = await lockLead(client, context, leadId);

  const { missing } = evaluateLeadQualification(lead, await getLeadQualificationSettings(client, context));
  const override = missing.length > 0 && input.override === true;
  const overrideReason = text(input.overrideReason).slice(0, 500);
  if (missing.length && !override)
    throw new CrmError(409, `Lead cannot be qualified yet. Missing: ${missing.map((entry) => entry.label).join(", ")}.`, "CRM_LEAD_QUALIFICATION_INCOMPLETE", {
      missing, canOverride: leadCan(context, LEAD_PERMISSIONS.overrideQualification),
    });
  if (override) {
    requireLeadPermission(context, LEAD_PERMISSIONS.overrideQualification, "You do not have permission to qualify a lead with missing requirements.");
    if (!overrideReason) throw new CrmError(400, "Explain why this lead is being qualified with missing information.", "CRM_LEAD_OVERRIDE_REASON_REQUIRED");
  }

  await ensureStarted(client, context, lead);
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'qualified', qualified_at = now(), qualified_by = $3, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, context.userId ?? null],
  );
  await client.query(
    `UPDATE tenant.crm_lead_qualifications SET override_reason = $3, overridden_by = $4, overridden_at = CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, updated_by = $5
      WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, lead.id, override ? overrideReason : null, override ? context.userId ?? null : null, context.userId ?? null],
  );
  await recordLeadQualificationEvent(client, context, lead.id, override
    ? { type: "qualified_override", newValue: `Missing: ${missing.map((entry) => entry.label).join(", ")}`, notes: overrideReason }
    : { type: "qualified" });
  await recordLeadHistory(client, context, lead.id, "qualified", override ? "Lead qualified with an override" : "Lead qualified", {
    from: lead.status, to: "qualified", ...(override ? { override: true, missing: missing.map((entry) => entry.key), reason: overrideReason } : {}),
  });
  return { status: "qualified", overridden: override };
}

// "Qualify anyway": the same decision, for a manager, with a reason.
export async function overrideQualification(client, context, leadId, input = {}) {
  return qualifyLead(client, context, leadId, { ...input, override: true });
}

export async function disqualifyLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.disqualify, "You do not have permission to disqualify leads.");
  const reason = text(input.reason);
  if (!REASONS.includes(reason)) throw new CrmError(400, "Choose a reason for disqualifying this lead.", "CRM_LEAD_DISQUALIFICATION_REASON_REQUIRED");
  const notes = text(input.notes).slice(0, 4000) || null;
  if (reason === "other" && !notes) throw new CrmError(400, "Add a note explaining the reason.", "CRM_LEAD_DISQUALIFICATION_NOTES_REQUIRED");
  const lead = await lockLead(client, context, leadId);
  if (!["open", "qualified"].includes(lead.status))
    throw new CrmError(409, `This lead is already ${lead.status}.`, "CRM_LEAD_STATUS_CONFLICT");
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'disqualified', disqualification_reason = $3, disqualification_notes = $4,
            disqualified_at = now(), disqualified_by = $5, updated_by = $5
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, reason, notes, context.userId ?? null],
  );
  await recordLeadQualificationEvent(client, context, lead.id, { type: "disqualified", newValue: leadDisqualificationReasonLabel(reason), notes });
  await recordLeadHistory(client, context, lead.id, "disqualified", `Lead disqualified — ${leadDisqualificationReasonLabel(reason)}`, {
    from: lead.status, to: "disqualified", reason, notes,
  });
  return { status: "disqualified" };
}

// Returns a qualified or disqualified lead to open so qualification can
// resume. The answers stay; the earlier decision stays in the history.
export async function reopenLead(client, context, leadId, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.reopen, "You do not have permission to reopen leads.");
  const lead = await lockLead(client, context, leadId);
  if (lead.status === "converted") throw new CrmError(409, "A converted lead cannot be reopened.", "CRM_LEAD_CONVERTED");
  if (lead.status === "open") throw new CrmError(409, "This lead is already open.", "CRM_LEAD_STATUS_CONFLICT");
  const note = text(input.note).slice(0, 500) || null;
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'open', qualified_at = NULL, qualified_by = NULL,
            disqualification_reason = NULL, disqualification_notes = NULL, disqualified_at = NULL, disqualified_by = NULL, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, lead.id, context.userId ?? null],
  );
  await client.query(
    `UPDATE tenant.crm_lead_qualifications SET override_reason = NULL, overridden_by = NULL, overridden_at = NULL, updated_by = $3 WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, lead.id, context.userId ?? null],
  );
  // A reopened lead is being qualified again, whether or not it had answers before.
  await ensureStarted(client, context, lead);
  await recordLeadQualificationEvent(client, context, lead.id, {
    type: "reopened",
    oldValue: lead.status === "disqualified" ? `Disqualified — ${leadDisqualificationReasonLabel(lead.disqualification_reason)}` : "Qualified",
    notes: note,
  });
  await recordLeadHistory(client, context, lead.id, "reopened", "Lead reopened", {
    from: lead.status, to: "open", previousReason: lead.disqualification_reason, note,
  });
  return { status: "open" };
}

export async function bulkDisqualifyLeads(client, context, input = {}) {
  return runLeadBulkOperation(client, input.leadIds, (leadId) => disqualifyLead(client, context, leadId, input));
}

export async function listLeadQualificationHistory(client, context, leadId) {
  const lead = await getLead(client, context, leadId);
  return listLeadQualificationEvents(client, context, lead.id);
}
