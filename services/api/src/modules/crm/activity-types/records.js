// Activity types and activity plans (CRM plan 5.2).
//
// Activity types are the organization's own follow-up types. Each has a base kind (call, email, meeting, demo, visit, WhatsApp, other)
// that decides what completing it records on the timeline and which consent it needs, and its defaults: when it falls due after it is
// planned, who does it, the reminder, an email template, and what comes next — suggested when it is completed, or planned automatically.
// The seven standard types (one per kind, code = kind) exist for every organization; they can be renamed and given defaults, not removed.
//
// An activity plan is a named sequence of follow-ups applied to a lead or deal in one click.
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
const KINDS = Object.freeze(["call", "email", "meeting", "demo", "visit", "whatsapp", "other"]);
export const ACTIVITY_KIND_LABELS = Object.freeze({ call: "Call", email: "Email", meeting: "Meeting", demo: "Demo", visit: "Visit", whatsapp: "WhatsApp", other: "Other" });
const STANDARD = Object.freeze(KINDS.map((kind, index) => ({ code: kind, name: ACTIVITY_KIND_LABELS[kind], kind, sequence: (index + 1) * 10 })));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message, code = "CRM_ACTIVITY_TYPE_VALIDATION") => new CrmError(400, message, code, { issues: [{ field, message }] });

function requireManage(context, what = "activity types") {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, `You do not have permission to manage ${what}.`, "PERMISSION_DENIED");
}

export async function ensureStandardActivityTypes(client, organizationId) {
  const { rows } = await client.query("SELECT count(*)::int AS n FROM tenant.crm_activity_types WHERE organization_id = $1 AND is_standard", [organizationId]);
  if (rows[0].n >= STANDARD.length) return;
  for (const type of STANDARD)
    await client.query(
      `INSERT INTO tenant.crm_activity_types (organization_id, code, name, kind, sequence, is_standard) VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (organization_id, code) DO NOTHING`, [organizationId, type.code, type.name, type.kind, type.sequence]);
}

function toType(row) {
  return {
    id: row.id, code: row.code, name: row.name, label: row.name, kind: row.kind, icon: row.icon ?? null, isStandard: row.is_standard, isActive: row.status === "active",
    defaultDelayHours: row.default_delay_hours ?? null, defaultAssignee: row.default_assignee, defaultUserId: row.default_user_id ?? null,
    defaultUserName: row.default_user_name ?? null, defaultReminderMinutes: row.default_reminder_minutes ?? null,
    emailTemplateId: row.email_template_id ?? null, emailTemplateName: row.email_template_name ?? null,
    chaining: row.chaining, nextTypeId: row.next_type_id ?? null, nextTypeName: row.next_type_name ?? null, nextDelayDays: row.next_delay_days,
    sequence: row.sequence,
  };
}

const TYPE_SELECT = `SELECT type.*, member.full_name AS default_user_name, template.name AS email_template_name, next_type.name AS next_type_name
    FROM tenant.crm_activity_types type
    LEFT JOIN users member ON member.id = type.default_user_id
    LEFT JOIN tenant.crm_email_templates template ON template.organization_id = type.organization_id AND template.id = type.email_template_id
    LEFT JOIN tenant.crm_activity_types next_type ON next_type.organization_id = type.organization_id AND next_type.id = type.next_type_id`;

// The types, in their order. Everyone working in CRM sees the active ones (every type list uses them); managers also the inactive ones.
export async function listActivityTypes(client, context, { includeInactive = false } = {}) {
  if (includeInactive) requireManage(context);
  await ensureStandardActivityTypes(client, context.organizationId);
  const { rows } = await client.query(`${TYPE_SELECT} WHERE type.organization_id = $1 AND ($2 OR type.status = 'active') ORDER BY (type.status = 'active') DESC, type.sequence, lower(type.name)`,
    [context.organizationId, includeInactive]);
  return rows.map(toType);
}

// The type a follow-up is of: by id, else by code (a standard kind or the organization's own code), else Call. Inactive types are
// still found by id (an existing follow-up keeps its type) but not chosen for new work by code.
export async function resolveActivityType(client, organizationId, { activityTypeId = null, code = null } = {}) {
  await ensureStandardActivityTypes(client, organizationId);
  if (activityTypeId) {
    if (!UUID.test(String(activityTypeId))) throw invalid("activityTypeId", "Choose a follow-up type from the list.", "CRM_FOLLOW_UP_VALIDATION");
    const row = (await client.query(`${TYPE_SELECT} WHERE type.organization_id = $1 AND type.id = $2`, [organizationId, activityTypeId])).rows[0];
    if (!row) throw invalid("activityTypeId", "Choose a follow-up type from the list.", "CRM_FOLLOW_UP_VALIDATION");
    return row;
  }
  let value = text(code).toLowerCase() || "call";
  // older screens still send "task" for a follow-up without a channel
  if (value === "task") value = "other";
  const row = (await client.query(`${TYPE_SELECT} WHERE type.organization_id = $1 AND type.code = $2 AND type.status = 'active'`, [organizationId, value])).rows[0];
  if (!row) throw invalid("type", "Choose how to follow up: a type from the list.", "CRM_FOLLOW_UP_VALIDATION");
  return row;
}

async function validMember(client, organizationId, userId, field) {
  if (!UUID.test(String(userId ?? "")) || !(await client.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [organizationId, userId])).rows[0])
    throw invalid(field, "Choose an active member.");
  return userId;
}

async function cleanType(client, context, input, current = null) {
  const out = {};
  if (has(input, "name") || !current) {
    out.name = text(input.name);
    if (!out.name || out.name.length > 80) throw invalid("name", "Name the type (up to 80 characters).");
    const clash = (await client.query("SELECT 1 FROM tenant.crm_activity_types WHERE organization_id = $1 AND lower(name) = lower($2) AND status = 'active' AND id IS DISTINCT FROM $3",
      [context.organizationId, out.name, current?.id ?? null])).rows[0];
    if (clash) throw invalid("name", "Another type already has this name.");
  }
  if (!current) {
    if (!KINDS.includes(input.kind)) throw invalid("kind", "Choose what kind of follow-up it is.");
    out.kind = input.kind;
  } else if (has(input, "kind") && input.kind !== current.kind) {
    if (current.is_standard) throw invalid("kind", "A standard type keeps its kind.");
    if (!KINDS.includes(input.kind)) throw invalid("kind", "Choose what kind of follow-up it is.");
    out.kind = input.kind;
  }
  if (has(input, "icon")) out.icon = text(input.icon).slice(0, 40) || null;
  if (has(input, "defaultDelayHours")) {
    const hours = input.defaultDelayHours === null || text(input.defaultDelayHours) === "" ? null : Number(input.defaultDelayHours);
    if (hours !== null && (!Number.isInteger(hours) || hours < 0 || hours > 2160)) throw invalid("defaultDelayHours", "Enter 0 to 2,160 hours, or leave it empty.");
    out.default_delay_hours = hours;
  }
  if (has(input, "defaultAssignee")) {
    if (!["record_owner", "creator", "user"].includes(input.defaultAssignee)) throw invalid("defaultAssignee", "Choose who does it.");
    out.default_assignee = input.defaultAssignee;
    out.default_user_id = input.defaultAssignee === "user" ? await validMember(client, context.organizationId, input.defaultUserId, "defaultUserId") : null;
  }
  if (has(input, "defaultReminderMinutes")) {
    const minutes = input.defaultReminderMinutes === null || text(input.defaultReminderMinutes) === "" ? null : Number(input.defaultReminderMinutes);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 43200)) throw invalid("defaultReminderMinutes", "Choose a reminder.");
    out.default_reminder_minutes = minutes;
  }
  if (has(input, "emailTemplateId")) {
    const id = input.emailTemplateId || null;
    if (id && !(UUID.test(String(id)) && (await client.query("SELECT 1 FROM tenant.crm_email_templates WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, id])).rows[0]))
      throw invalid("emailTemplateId", "Choose an active email template.");
    out.email_template_id = id;
  }
  if (has(input, "chaining") || has(input, "nextTypeId") || has(input, "nextDelayDays")) {
    const chaining = has(input, "chaining") ? input.chaining : current?.chaining ?? "none";
    if (!["none", "suggest", "trigger"].includes(chaining)) throw invalid("chaining", "Choose what happens next.");
    out.chaining = chaining;
    const nextId = chaining === "none" ? null : has(input, "nextTypeId") ? input.nextTypeId : current?.next_type_id;
    if (chaining !== "none") {
      if (!UUID.test(String(nextId ?? "")) || !(await client.query("SELECT 1 FROM tenant.crm_activity_types WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, nextId])).rows[0])
        throw invalid("nextTypeId", "Choose the type that comes next.");
    }
    out.next_type_id = nextId ?? null;
    if (has(input, "nextDelayDays")) {
      const days = Number(input.nextDelayDays);
      if (!Number.isInteger(days) || days < 0 || days > 365) throw invalid("nextDelayDays", "Enter 0 to 365 days.");
      out.next_delay_days = days;
    }
  }
  return out;
}

async function readType(client, organizationId, id) {
  return (await client.query(`${TYPE_SELECT} WHERE type.organization_id = $1 AND type.id = $2`, [organizationId, id])).rows[0];
}

// input: { name, kind, icon?, defaultDelayHours?, defaultAssignee?, defaultUserId?, defaultReminderMinutes?, emailTemplateId?, chaining?, nextTypeId?, nextDelayDays? }
export async function createActivityType(client, context, input = {}) {
  requireManage(context);
  await ensureStandardActivityTypes(client, context.organizationId);
  const fields = await cleanType(client, context, input);
  const base = fields.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34) || "type";
  const taken = new Set((await client.query("SELECT code FROM tenant.crm_activity_types WHERE organization_id = $1", [context.organizationId])).rows.map((row) => row.code));
  let code = base;
  for (let suffix = 2; taken.has(code) || KINDS.includes(code); suffix += 1) code = `${base}_${suffix}`;
  const columns = Object.keys(fields);
  const created = (await client.query(
    `INSERT INTO tenant.crm_activity_types (organization_id, code, sequence, created_by, updated_by, ${columns.join(", ")})
     VALUES ($1, $2, (SELECT COALESCE(max(sequence), 0) + 10 FROM tenant.crm_activity_types WHERE organization_id = $1), $3, $3, ${columns.map((_, index) => `$${index + 4}`).join(", ")}) RETURNING id`,
    [context.organizationId, code, context.userId ?? null, ...columns.map((column) => fields[column])])).rows[0];
  return toType(await readType(client, context.organizationId, created.id));
}

// input: any of the create fields, plus isActive. A standard type keeps its kind and cannot be switched off.
export async function updateActivityType(client, context, typeId, input = {}) {
  requireManage(context);
  const current = UUID.test(String(typeId ?? "")) ? await readType(client, context.organizationId, typeId) : null;
  if (!current) throw new CrmError(404, "Activity type not found.", "CRM_ACTIVITY_TYPE_NOT_FOUND");
  const fields = await cleanType(client, context, input, current);
  if (has(input, "isActive")) {
    if (!input.isActive && current.is_standard) throw invalid("isActive", "A standard type stays on; rename it or give it other defaults instead.");
    fields.status = input.isActive ? "active" : "inactive";
  }
  const columns = Object.keys(fields);
  if (columns.length)
    await client.query(`UPDATE tenant.crm_activity_types SET ${columns.map((column, index) => `${column} = $${index + 4}`).join(", ")}, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, current.id, context.userId ?? null, ...columns.map((column) => fields[column])]);
  return toType(await readType(client, context.organizationId, current.id));
}

// orderedIds: every active type, in the order the lists show them.
export async function reorderActivityTypes(client, context, orderedIds) {
  requireManage(context);
  const ids = Array.isArray(orderedIds) ? orderedIds.filter((id) => UUID.test(String(id))) : [];
  for (const [index, id] of ids.entries())
    await client.query("UPDATE tenant.crm_activity_types SET sequence = $3, updated_at = now() WHERE organization_id = $1 AND id = $2", [context.organizationId, id, (index + 1) * 10]);
  return listActivityTypes(client, context, { includeInactive: true });
}

// The type list every CRM screen offers for new work: [{ id, code, label, kind }].
export async function activityTypeChoices(client, context) {
  return (await listActivityTypes(client, context)).map((type) => ({ id: type.id, code: type.code, label: type.name, kind: type.kind }));
}

// ------------------------------------------------------------------ plans

function toPlan(row, steps) {
  return {
    id: row.id, name: row.name, description: row.description ?? null, appliesTo: row.applies_to, isActive: row.status === "active",
    steps: steps.map((step) => ({
      id: step.id, sequence: step.sequence, activityTypeId: step.activity_type_id, activityTypeName: step.type_name, kind: step.kind, subject: step.subject ?? null,
      offsetDays: step.offset_days, assignee: step.assignee, userId: step.user_id ?? null, userName: step.user_name ?? null,
    })),
  };
}

async function readPlans(client, organizationId, { id = null, includeInactive = false } = {}) {
  const plans = (await client.query(
    `SELECT * FROM tenant.crm_activity_plans WHERE organization_id = $1 AND ($2::uuid IS NULL OR id = $2) AND ($3 OR status = 'active') ORDER BY (status = 'active') DESC, lower(name)`,
    [organizationId, id, includeInactive])).rows;
  if (!plans.length) return [];
  const steps = (await client.query(
    `SELECT step.*, type.name AS type_name, type.kind, member.full_name AS user_name FROM tenant.crm_activity_plan_steps step
       JOIN tenant.crm_activity_types type ON type.organization_id = step.organization_id AND type.id = step.activity_type_id
       LEFT JOIN users member ON member.id = step.user_id
      WHERE step.organization_id = $1 AND step.plan_id = ANY($2::uuid[]) ORDER BY step.sequence`,
    [organizationId, plans.map((plan) => plan.id)])).rows;
  return plans.map((plan) => toPlan(plan, steps.filter((step) => step.plan_id === plan.id)));
}

// The plans (active ones for everyone; ?all for managers). appliesTo filters to plans usable on that kind of record.
export async function listActivityPlans(client, context, { includeInactive = false, appliesTo = null } = {}) {
  if (includeInactive) requireManage(context, "activity plans");
  const plans = await readPlans(client, context.organizationId, { includeInactive });
  return appliesTo ? plans.filter((plan) => plan.appliesTo === "any" || plan.appliesTo === appliesTo) : plans;
}

async function cleanPlan(client, context, input, creating) {
  const out = {};
  if (creating || has(input, "name")) {
    out.name = text(input.name);
    if (!out.name || out.name.length > 120) throw invalid("name", "Name the plan (up to 120 characters).", "CRM_ACTIVITY_PLAN_VALIDATION");
  }
  if (has(input, "description")) out.description = text(input.description).slice(0, 500) || null;
  if (creating || has(input, "appliesTo")) {
    out.applies_to = input.appliesTo ?? "any";
    if (!["lead", "opportunity", "any"].includes(out.applies_to)) throw invalid("appliesTo", "Choose where the plan is used.", "CRM_ACTIVITY_PLAN_VALIDATION");
  }
  let steps = null;
  if (creating || has(input, "steps")) {
    if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 20) throw invalid("steps", "Add between 1 and 20 steps.", "CRM_ACTIVITY_PLAN_VALIDATION");
    steps = [];
    for (const step of input.steps) {
      const type = UUID.test(String(step?.activityTypeId ?? ""))
        ? (await client.query("SELECT id FROM tenant.crm_activity_types WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, step.activityTypeId])).rows[0] : null;
      if (!type) throw invalid("steps", "Choose a type for every step.", "CRM_ACTIVITY_PLAN_VALIDATION");
      const offset = Number(step.offsetDays ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 365) throw invalid("steps", "Each step is 0 to 365 days after the plan is applied.", "CRM_ACTIVITY_PLAN_VALIDATION");
      const assignee = step.assignee ?? "record_owner";
      if (!["record_owner", "applier", "user"].includes(assignee)) throw invalid("steps", "Choose who does each step.", "CRM_ACTIVITY_PLAN_VALIDATION");
      steps.push({ activityTypeId: type.id, offsetDays: offset, subject: text(step.subject).slice(0, 200) || null, assignee,
        userId: assignee === "user" ? await validMember(client, context.organizationId, step.userId, "steps") : null });
    }
  }
  return { fields: out, steps };
}

async function writeSteps(client, context, planId, steps) {
  await client.query("DELETE FROM tenant.crm_activity_plan_steps WHERE organization_id = $1 AND plan_id = $2", [context.organizationId, planId]);
  for (const [index, step] of steps.entries())
    await client.query(
      `INSERT INTO tenant.crm_activity_plan_steps (organization_id, plan_id, sequence, activity_type_id, subject, offset_days, assignee, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [context.organizationId, planId, index + 1, step.activityTypeId, step.subject, step.offsetDays, step.assignee, step.userId]);
}

// input: { name, description?, appliesTo?: lead | opportunity | any, steps: [{ activityTypeId, offsetDays, subject?, assignee?, userId? }] }
export async function createActivityPlan(client, context, input = {}) {
  requireManage(context, "activity plans");
  const { fields, steps } = await cleanPlan(client, context, input, true);
  const plan = (await client.query(
    `INSERT INTO tenant.crm_activity_plans (organization_id, name, description, applies_to, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
    [context.organizationId, fields.name, fields.description ?? null, fields.applies_to, context.userId ?? null])).rows[0];
  await writeSteps(client, context, plan.id, steps);
  return (await readPlans(client, context.organizationId, { id: plan.id, includeInactive: true }))[0];
}

// input: any of the create fields (steps replace the plan's steps), plus isActive.
export async function updateActivityPlan(client, context, planId, input = {}) {
  requireManage(context, "activity plans");
  const current = UUID.test(String(planId ?? "")) ? (await readPlans(client, context.organizationId, { id: planId, includeInactive: true }))[0] : null;
  if (!current) throw new CrmError(404, "Activity plan not found.", "CRM_ACTIVITY_PLAN_NOT_FOUND");
  const { fields, steps } = await cleanPlan(client, context, input, false);
  if (has(input, "isActive")) fields.status = input.isActive ? "active" : "inactive";
  const columns = Object.keys(fields);
  if (columns.length)
    await client.query(`UPDATE tenant.crm_activity_plans SET ${columns.map((column, index) => `${column} = $${index + 4}`).join(", ")}, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, current.id, context.userId ?? null, ...columns.map((column) => fields[column])]);
  if (steps) await writeSteps(client, context, current.id, steps);
  return (await readPlans(client, context.organizationId, { id: current.id, includeInactive: true }))[0];
}

// Applies a plan to a lead or deal: one follow-up per step, each `offsetDays` after `startDate` (default today) at the step's assignee.
// The record's own rules apply to each (consent, who may be assigned). Returns the follow-ups planned.
export async function applyActivityPlan(client, context, planId, { relatedType, relatedId, startDate = null } = {}) {
  const plan = UUID.test(String(planId ?? "")) ? (await readPlans(client, context.organizationId, { id: planId }))[0] : null;
  if (!plan) throw new CrmError(404, "Activity plan not found, or it is switched off.", "CRM_ACTIVITY_PLAN_NOT_FOUND");
  if (plan.appliesTo !== "any" && plan.appliesTo !== relatedType)
    throw new CrmError(409, `This plan is for ${plan.appliesTo === "lead" ? "leads" : "deals"}.`, "CRM_ACTIVITY_PLAN_NOT_APPLICABLE");
  const start = text(startDate) || (await client.query(
    "SELECT to_char((now() AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'))::date, 'YYYY-MM-DD') AS d FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0].d;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw invalid("startDate", "Choose a valid start date.", "CRM_ACTIVITY_PLAN_VALIDATION");
  const { scheduleFollowUp } = await import("../follow-ups/records.js");
  const planned = [];
  for (const step of plan.steps) {
    const day = (await client.query("SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS d", [start, step.offsetDays])).rows[0].d;
    const followUp = await scheduleFollowUp(client, context, {
      relatedType, relatedId, activityTypeId: step.activityTypeId, subject: step.subject || undefined, scheduledDate: day,
      ...(step.assignee === "applier" ? { assignedTo: context.userId } : step.assignee === "user" ? { assignedTo: step.userId } : {}),
      activityPlanId: plan.id,
    });
    planned.push(followUp);
  }
  return { planId: plan.id, planned };
}
