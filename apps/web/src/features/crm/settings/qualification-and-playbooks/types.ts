// tenant.crm_lead_qualification_criteria via the generic /api/crm/[resource]
// boundary — confirmed a genuine match (not a dead/legacy table like
// F005/F027's generic-resource decoys): lead-qualification.js's
// evaluateLeadQualificationReadiness reads this exact table with the
// exact same columns registered in resource-registry.js.
export const QUALIFICATION_TIERS = ["required", "recommended"] as const;
export type QualificationTier = (typeof QUALIFICATION_TIERS)[number];
// F006 gap-closure — "minimum_threshold" lets a criterion require a
// numeric field (e.g. the predictive lead score) to reach a configurable
// minimum, closing the one gap the "top ERPs" benchmark found: every rival
// ships some ML/rule-based score as a qualification input, but Vercentlabs'
// score→qualification relationship was previously one-directional.
export const QUALIFICATION_CHECK_TYPES = ["non_empty_any", "positive_number", "minimum_threshold"] as const;
export type QualificationCheckType = (typeof QUALIFICATION_CHECK_TYPES)[number];

// The fixed allowlist a criterion's fieldKeys may reference
// (READINESS_FIELD_COLUMNS in lead-qualification.js) — mirrored here so
// the picker can never offer a field the server would reject.
export const QUALIFICATION_FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  "mobile",
  "phone",
  "companyName",
  "jobTitle",
  "productInterest",
  "estimatedValue",
  "sourceId",
  "industry",
  "website",
  "city",
  "state",
  "countryCode",
  "score",
] as const;

export type QualificationCriterion = {
  id: string;
  criterionKey: string;
  label: string;
  tier: QualificationTier;
  checkType: QualificationCheckType;
  fieldKeys: string[];
  // Only set when checkType is "minimum_threshold".
  threshold: number | null;
  sequence: number;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

// tenant.crm_playbooks — a generic sales-methodology resource (pipelineId-
// scoped, not Lead-qualification-specific at the engine level), included
// here because the nav registry's existing "Qualification / Playbooks"
// placeholder groups both under one settings destination.
export type CrmPlaybook = {
  id: string;
  companyId: string | null;
  pipelineId: string | null;
  name: string;
  framework: string | null;
  description: string | null;
  guidance: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
