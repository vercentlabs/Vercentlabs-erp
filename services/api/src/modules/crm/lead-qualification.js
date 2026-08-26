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
  if (!canViewAll(context)) {
    parameters.push(context.userId);
    sql += ` AND (${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id=$${parameters.length})`;
  }
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

export function evaluateLeadQualificationReadiness(lead = {}) {
  const firstName = text(lead.firstName ?? lead.first_name);
  const hasContact = Boolean(
    text(lead.email) || text(lead.mobile) || text(lead.phone),
  );
  const required = [
    {
      key: "identity",
      label: "Lead identity",
      met: Boolean(firstName),
      help: firstName ? "First name is available." : "Add the Lead's first name.",
    },
    {
      key: "contact",
      label: "Contact method",
      met: hasContact,
      help: hasContact
        ? "At least one contact method is available."
        : "Add an email, mobile number or alternate number.",
    },
  ];
  const recommended = [
    { key: "company", label: "Company", met: Boolean(text(lead.companyName ?? lead.company_name)) },
    { key: "job_title", label: "Job title", met: Boolean(text(lead.jobTitle ?? lead.job_title)) },
    { key: "product_interest", label: "Product interest", met: Boolean(text(lead.productInterest ?? lead.product_interest)) },
    { key: "estimated_value", label: "Estimated value", met: Number(lead.estimatedValue ?? lead.estimated_value ?? 0) > 0 },
    { key: "source", label: "Lead source", met: Boolean(lead.sourceId ?? lead.source_id) },
  ];
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
    readiness: evaluateLeadQualificationReadiness(lead),
    history: await qualificationHistory(client, context, leadId),
    reasons: LEAD_UNQUALIFICATION_REASONS,
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

  const readiness = evaluateLeadQualificationReadiness(lead);
  if (decision === "qualified" && !readiness.ready) {
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
       (organization_id,lead_id,previous_state,new_state,reason_code,reason_text,note,decided_by_user_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
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
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_outbox_events
       (organization_id,event_type,entity_type,entity_id,payload)
     VALUES($1,$2,'lead',$3,$4)`,
    [
      context.organizationId,
      previousState === "unqualified" && decision === "qualified"
        ? "crm.leads.requalified"
        : `crm.leads.${decision}`,
      leadId,
      {
        leadId,
        previousState,
        state: decision,
        reasonCode: decision === "unqualified" ? reasonCode : null,
        qualificationEventId: event.rows[0].id,
      },
    ],
  );
  return {
    changed: true,
    lead: camelize(updated.rows[0]),
    event: camelize(event.rows[0]),
    qualification: await getLeadQualification(client, context, leadId),
  };
}
