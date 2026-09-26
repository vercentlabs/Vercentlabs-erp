import { crmOwnerScopeSql } from "../crm-data-operations-and-customization/crm-access-scope.js";
import { runCrmAutomation } from "../crm-data-operations-and-customization/resource-mutation-service.js";
import { recalculateLeadScoreInternal } from "./scoring/scoring-engine.js";
import { publishDomainEvent } from "../../../core/platform/events/index.js";

export const LEAD_QUALIFICATION_STATES = Object.freeze([
  "not_reviewed",
  "qualified",
  "unqualified",
]);

export const LEAD_UNQUALIFICATION_REASONS = Object.freeze([
  { code: "no_current_requirement", label: "No current requirement" },
  { code: "not_a_fit", label: "Not a fit" },
  { code: "invalid_enquiry", label: "Invalid or bad enquiry" },
  { code: "unable_to_reach", label: "Unable to reach" },
  { code: "budget_unavailable", label: "Budget unavailable" },
  {
    code: "duplicate_or_existing_relationship",
    label: "Duplicate or existing relationship",
  },
  { code: "other", label: "Other" },
]);

export const LEAD_QUALIFICATION_MUTATION_FIELDS = Object.freeze([
  "unqualifiedReason",
  "qualificationState",
  "qualificationReasonCode",
  "qualificationReasonText",
  "qualificationNote",
  "qualificationDecidedAt",
  "qualificationDecidedByUserId",
  "qualification_state",
  "qualification_reason_code",
  "qualification_reason_text",
  "qualification_note",
  "qualification_decided_at",
  "qualification_decided_by_user_id",
  "unqualified_reason",
]);

const reasonCodes = new Set(LEAD_UNQUALIFICATION_REASONS.map(({ code }) => code));
const text = (value) => String(value ?? "").trim();

export class LeadQualificationError extends Error {
  constructor(status, message, code = "CRM_LEAD_QUALIFICATION_ERROR", details) {
    super(message);
    this.name = "LeadQualificationError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function hasPermission(context, permission) {
  return Boolean(context.permissions?.includes(permission));
}

function canViewAll(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    hasPermission(context, "crm.records.view_all")
  );
}

function assertCanDecide(context) {
  if (
    !context.userId ||
    (!context.roleSlugs?.includes("organization_owner") &&
      !hasPermission(context, "crm.leads.manage"))
  )
    throw new LeadQualificationError(
      403,
      "You do not have permission to qualify Leads.",
      "CRM_LEAD_QUALIFICATION_FORBIDDEN",
    );
}

// F006 exception override (DEC-CRM-P1-F006, F005/F006-SEM-04 SoD/override
// governance): the same elevated pairing already used for manual Lead
// assignment/reassignment override — an ordinary crm.leads.manage user
// cannot bypass required evidence on their own; it takes the broader
// crm.records.view_all scope (or being the organization owner).
function canOverrideQualification(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    hasPermission(context, "crm.records.view_all")
  );
}

function addScope(context, parameters, alias = "lead") {
  let sql = "";
  if (context.activeCompanyId) {
    parameters.push(context.activeCompanyId);
    sql += ` AND (${alias}.company_id IS NULL OR ${alias}.company_id=$${parameters.length})`;
  } else if (!context.allowAllCompanies) {
    return " AND false";
  }
  if (context.activeBranchId) {
    parameters.push(context.activeBranchId);
    sql += ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id=$${parameters.length})`;
  } else if (!context.allowAllCompanies) {
    return sql + " AND false";
  }
  sql += crmOwnerScopeSql(context, (value) => { parameters.push(value); return `$${parameters.length}`; }, `${alias}.owner_user_id`, `${alias}.organization_id`, { resource: "leads", alias: alias });
  return sql;
}

function camelize(row = {}) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()),
      value,
    ]),
  );
}

export function assertNoQualificationMutation(input = {}) {
  const field = LEAD_QUALIFICATION_MUTATION_FIELDS.find((key) =>
    Object.prototype.hasOwnProperty.call(input, key),
  );
  if (field)
    throw new LeadQualificationError(
      409,
      "Use the governed Lead Qualification action to change this decision.",
      "CRM_LEAD_QUALIFICATION_ACTION_REQUIRED",
      { errors: { [field]: ["This field cannot be changed directly."] } },
    );
}

// F006: readiness criteria are admin-configurable per organization
// (tenant.crm_lead_qualification_criteria, seeded with these exact defaults
// for every org so behavior is unchanged until someone edits the config).
// field_keys use the same camelCase names the rest of the Lead API uses;
// READINESS_FIELD_COLUMNS is a fixed allowlist mapping them to the actual
// snake_case row columns this function reads, so a criterion can never
// reference an arbitrary column.
export const READINESS_FIELD_COLUMNS = Object.freeze({
  firstName: "first_name",
  lastName: "last_name",
  email: "email",
  mobile: "mobile",
  phone: "phone",
  companyName: "company_name",
  jobTitle: "job_title",
  productInterest: "product_interest",
  estimatedValue: "estimated_value",
  sourceId: "source_id",
  industry: "industry",
  website: "website",
  city: "city",
  state: "state",
  countryCode: "country_code",
  // F006 gap-closure — every top ERP benchmarked ships some ML/rule-based
  // lead score as a qualification input; Vercentlabs' scoring relationship
  // was one-directional (qualification could feed score, never the
  // reverse). Exposing the score column here, paired with the new
  // 'minimum_threshold' check_type below, lets an admin define a criterion
  // like "predictive score is at least 60" without touching the scoring
  // engine at all.
  score: "score",
});

function readinessFieldValue(lead, fieldKey) {
  const column = READINESS_FIELD_COLUMNS[fieldKey];
  return column ? lead[column] : undefined;
}

function criterionMet(lead, criterion) {
  if (criterion.check_type === "positive_number")
    return Number(readinessFieldValue(lead, criterion.field_keys[0]) ?? 0) > 0;
  if (criterion.check_type === "minimum_threshold")
    return Number(readinessFieldValue(lead, criterion.field_keys[0]) ?? 0) >= Number(criterion.threshold ?? 0);
  return criterion.field_keys.some((key) => text(readinessFieldValue(lead, key)));
}

export async function evaluateLeadQualificationReadiness(client, context, lead = {}) {
  const result = await client.query(
    `SELECT criterion_key, label, tier, check_type, field_keys, threshold
       FROM tenant.crm_lead_qualification_criteria
      WHERE organization_id=$1 AND status='active'
      ORDER BY sequence, criterion_key`,
    [context.organizationId],
  );
  const required = [];
  const recommended = [];
  for (const criterion of result.rows) {
    const met = criterionMet(lead, criterion);
    const entry = {
      key: criterion.criterion_key,
      label: criterion.label,
      met,
      help: met
        ? `${criterion.label} is available.`
        : criterion.check_type === "minimum_threshold"
          ? `${criterion.label} must reach at least ${criterion.threshold}.`
          : `Add ${criterion.label.toLowerCase()}.`,
    };
    (criterion.tier === "required" ? required : recommended).push(entry);
  }
  return {
    ready: required.every((criterion) => criterion.met),
    required,
    recommended,
  };
}

async function scopedLead(client, context, leadId, lock = false) {
  const parameters = [context.organizationId, leadId];
  const scope = addScope(context, parameters);
  const result = await client.query(
    `SELECT lead.*,
            actor.full_name AS qualification_decided_by_name
       FROM tenant.crm_leads lead
       LEFT JOIN public.users actor ON actor.id=lead.qualification_decided_by_user_id
      WHERE lead.organization_id=$1 AND lead.id=$2${scope}
      LIMIT 1${lock ? " FOR UPDATE OF lead" : ""}`,
    parameters,
  );
  if (!result.rows[0])
    throw new LeadQualificationError(
      404,
      "Lead not found.",
      "CRM_LEAD_NOT_FOUND",
    );
  return result.rows[0];
}

async function qualificationHistory(client, context, leadId) {
  const result = await client.query(
    `SELECT event.*,actor.full_name AS decided_by_name
       FROM tenant.crm_lead_qualification_events event
       LEFT JOIN public.users actor ON actor.id=event.decided_by_user_id
      WHERE event.organization_id=$1 AND event.lead_id=$2
      ORDER BY event.created_at DESC,event.id DESC
      LIMIT 100`,
    [context.organizationId, leadId],
  );
  return result.rows.map(camelize);
}

export async function getLeadQualification(client, context, leadId) {
  const lead = await scopedLead(client, context, leadId, false);
  return {
    state: lead.qualification_state,
    reasonCode: lead.qualification_reason_code,
    reasonText: lead.qualification_reason_text,
    note: lead.qualification_note,
    decidedAt: lead.qualification_decided_at,
    decidedByUserId: lead.qualification_decided_by_user_id,
    decidedByName: lead.qualification_decided_by_name,
    readiness: await evaluateLeadQualificationReadiness(client, context, lead),
    // "Evidence timestamps" (DEC-CRM-P1-F006): readiness is computed live
    // from current Lead field values, so this is the instant the caller's
    // evidence snapshot was evaluated — surfaced in the UI as "Last
    // evaluated" alongside the separate, persisted "decided at".
    evaluatedAt: new Date().toISOString(),
    history: await qualificationHistory(client, context, leadId),
    reasons: LEAD_UNQUALIFICATION_REASONS,
    canOverride: canOverrideQualification(context),
  };
}

export async function decideLeadQualification(client, context, leadId, input = {}) {
  assertCanDecide(context);
  const decision = text(input.decision).toLowerCase();
  if (!new Set(["qualified", "unqualified"]).has(decision))
    throw new LeadQualificationError(
      400,
      "Choose Qualified or Unqualified.",
      "CRM_LEAD_QUALIFICATION_DECISION_INVALID",
    );
  const reasonCode = decision === "unqualified" ? text(input.reasonCode) : "";
  const reasonText = decision === "unqualified" ? text(input.reasonText).slice(0, 2_000) : "";
  const note = text(input.note).slice(0, 2_000);
  if (decision === "unqualified" && !reasonCodes.has(reasonCode))
    throw new LeadQualificationError(
      400,
      "Select an unqualification reason.",
      "CRM_LEAD_QUALIFICATION_REASON_REQUIRED",
      { errors: { reasonCode: ["Select an unqualification reason."] } },
    );
  if (reasonCode === "other" && reasonText.length < 3)
    throw new LeadQualificationError(
      400,
      "Explain the Other reason in at least 3 characters.",
      "CRM_LEAD_QUALIFICATION_REASON_REQUIRED",
      { errors: { reasonText: ["Explain the Other reason in at least 3 characters."] } },
    );

  const lead = await scopedLead(client, context, leadId, true);
  const recordStatus = lead.record_status ||
    (["archived", "converted"].includes(lead.status) ? lead.status : "active");
  if (["archived", "converted"].includes(recordStatus))
    throw new LeadQualificationError(
      409,
      `${recordStatus === "archived" ? "Archived" : "Converted"} Leads cannot be qualified.`,
      "CRM_LEAD_QUALIFICATION_TRANSITION_INVALID",
    );
  if (lead.qualification_state === decision)
    return { changed: false, qualification: await getLeadQualification(client, context, leadId), event: null };

  const readiness = await evaluateLeadQualificationReadiness(client, context, lead);
  const overrideRequested = input.overrideUsed === true;
  const overrideReason = overrideRequested ? text(input.overrideReason).slice(0, 1_000) : "";
  let overrideUsed = false;
  if (decision === "qualified" && !readiness.ready) {
    if (!overrideRequested) {
      const errors = Object.fromEntries(
        readiness.required
          .filter((criterion) => !criterion.met)
          .map((criterion) => [criterion.key, [criterion.help]]),
      );
      throw new LeadQualificationError(
        409,
        "Complete the required Lead information before qualification.",
        "CRM_LEAD_QUALIFICATION_NOT_READY",
        { errors, readiness },
      );
    }
    if (!canOverrideQualification(context))
      throw new LeadQualificationError(
        403,
        "You do not have permission to qualify a Lead with missing required evidence.",
        "CRM_LEAD_QUALIFICATION_OVERRIDE_FORBIDDEN",
      );
    if (overrideReason.length < 3)
      throw new LeadQualificationError(
        400,
        "Explain why this Lead is being qualified despite missing evidence, in at least 3 characters.",
        "CRM_LEAD_QUALIFICATION_OVERRIDE_REASON_REQUIRED",
        { errors: { overrideReason: ["Explain the override reason in at least 3 characters."] } },
      );
    overrideUsed = true;
  }

  const previousState = lead.qualification_state;
  const updated = await client.query(
    `UPDATE tenant.crm_leads
        SET qualification_state=$3,
            qualification_reason_code=$4,
            qualification_reason_text=$5,
            qualification_note=$6,
            qualification_decided_at=now(),
            qualification_decided_by_user_id=$7,
            updated_by=$7,
            updated_at=now()
      WHERE organization_id=$1 AND id=$2
      RETURNING *`,
    [
      context.organizationId,
      leadId,
      decision,
      decision === "unqualified" ? reasonCode : null,
      decision === "unqualified" ? reasonText || null : null,
      note || null,
      context.userId,
    ],
  );
  const event = await client.query(
    `INSERT INTO tenant.crm_lead_qualification_events
       (organization_id,lead_id,previous_state,new_state,reason_code,reason_text,note,decided_by_user_id,override_used,override_reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      context.organizationId,
      leadId,
      previousState,
      decision,
      decision === "unqualified" ? reasonCode : null,
      decision === "unqualified" ? reasonText || null : null,
      note || null,
      context.userId,
      overrideUsed,
      overrideUsed ? overrideReason : null,
    ],
  );
  await publishDomainEvent(client, {
    organizationId: context.organizationId,
    moduleKey: "crm",
    eventType: previousState === "unqualified" && decision === "qualified" ? "crm.leads.requalified" : `crm.leads.${decision}`,
    entityType: "lead",
    entityId: leadId,
    payload: {
      leadId,
      previousState,
      state: decision,
      reasonCode: decision === "unqualified" ? reasonCode : null,
      qualificationEventId: event.rows[0].id,
      overrideUsed,
    },
  });
  const camelizedLead = camelize(updated.rows[0]);
  if (decision === "qualified") {
    await runCrmAutomation(client, context, "lead.qualified", "lead", leadId, camelizedLead);
  }
  // F027 integration (Prompt 4 §48): a qualification decision can only ever
  // move the score through a configured rule that references it (e.g. an
  // admin-added demographic rule predicate on qualification_state) — this
  // never scores qualification itself, it just keeps score/grade current
  // if such a rule exists. No-ops safely when no active model is configured.
  await recalculateLeadScoreInternal(client, context, leadId, "Qualification decision changed");
  return {
    changed: true,
    lead: camelizedLead,
    event: camelize(event.rows[0]),
    qualification: await getLeadQualification(client, context, leadId),
  };
}
