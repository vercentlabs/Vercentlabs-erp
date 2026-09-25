// Shape returned by services/api's generic getCrmRecord/listCrmRecords for
// the "leads" resource (camelized DB columns — see
// services/api/src/modules/crm/crm-data-operations-and-customization/
// resource-registry.js's `leads.fields` map — plus computed/projected
// fields such as recordStatus). Left loose (many fields optional/unknown)
// rather than asserting an exact shape this pass didn't independently
// verify field-by-field against every projectCrmRecord code path.
export type Lead = {
  id: string;
  code: string;
  organizationId: string;
  companyId: string | null;
  branchId: string | null;
  firstName: string;
  lastName: string | null;
  fullName?: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  companyName: string | null;
  jobTitle: string | null;
  website: string | null;
  industry: string | null;
  sourceId: string | null;
  originalSourceId: string | null;
  referrerName: string | null;
  campaignId: string | null;
  /** F007 pipeline status — a distinct axis from qualification and recordStatus. */
  status: string;
  /** F007 overall record lifecycle (e.g. active/converted/archived) — never a single merged enum with `status`. */
  recordStatus?: string;
  /** F006 qualification decision — a distinct axis from `status`. Backed
   * by the real `qualification_state` column (see lead-qualification.js);
   * do not rename to "qualificationStatus", which is not a real field. */
  qualificationState?: "not_reviewed" | "qualified" | "unqualified" | null;
  priority: "low" | "medium" | "high" | "urgent";
  rating: "cold" | "warm" | "hot" | null;
  ownerUserId: string | null;
  ownerName?: string | null;
  score: number | null;
  grade?: string | null;
  // Score band from the scoring model (cold/warm/hot/qualified) — distinct from the manual rating.
  leadGrade?: string | null;
  // numeric(18,2) — node-postgres returns this as a string at runtime;
  // typed honestly so call sites go through money()/toNumber() instead
  // of assuming a number (see shared/format.ts).
  estimatedValue: number | string | null;
  currencyCode: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  productInterest: string | null;
  nextFollowUpAt: string | null;
  consentEmail: boolean;
  consentSms: boolean;
  consentWhatsapp: boolean;
  doNotContact: boolean;
  customData: Record<string, unknown> | null;
  /** F022: populated only once recordStatus is "converted" — see
   * lead-conversion.js's convertCrmLead UPDATE of these three columns. */
  convertedPartyId?: string | null;
  convertedContactId?: string | null;
  convertedOpportunityId?: string | null;
  convertedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadListFilters = {
  search?: string;
  status?: string;
  ownerId?: string;
  sourceId?: string;
  priority?: string;
  rating?: string;
  followup?: "overdue" | "today" | "upcoming" | "none" | "all";
  qualification?: "not_reviewed" | "qualified" | "unqualified" | "all";
  // F024 Stage A2 §10 — mirrors getCrmDashboard's exact "dwell-breached"/
  // "high-priority" predicates, so a drilled list's count always
  // reconciles to the dashboard's own metric.
  dwellBreached?: "true";
  highPriority?: "true";
  // F024 — dashboard period drill-down.
  createdFrom?: string;
  createdTo?: string;
  convertedFrom?: string;
  convertedTo?: string;
  includeConverted?: "true";
  limit?: number;
  offset?: number;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
