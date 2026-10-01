// F006 Lead qualification field rules with no runtime dependencies: the
// decision fields only the governed Qualification action may write (and the
// guard generic Lead create/update applies), the readiness field allowlist
// that qualification criteria are validated against, and the error type
// both raise. Kept apart from lead-qualification.js, which runs automation
// after a decision, so the generic record kernel can use these rules without
// depending on the decision workflow.

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

export class LeadQualificationError extends Error {
  constructor(status, message, code = "CRM_LEAD_QUALIFICATION_ERROR", details) {
    super(message);
    this.name = "LeadQualificationError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
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
