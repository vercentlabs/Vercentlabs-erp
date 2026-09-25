// tenant.crm_privacy_requests / tenant.crm_consent_events / tenant.
// crm_privacy_retention_policies via account-intelligence.js and the
// generic /api/crm/[resource] boundary. Raw snake_case where the source is
// a direct SQL row (account-intelligence.js does not camelize); camelCase
// where the source is a generic resource row (resource-mutation-service.js
// does camelize those).
export type PrivacyRequestType = "access" | "export" | "correction" | "deletion" | "restriction" | "objection" | "consent_withdrawal";
export type PrivacySubjectType = "lead" | "contact" | "party";
export type PrivacyRequestStatus = "received" | "verification_pending" | "in_progress" | "completed" | "rejected" | "cancelled";

export const PRIVACY_REQUEST_TYPES: PrivacyRequestType[] = [
  "access",
  "export",
  "correction",
  "deletion",
  "restriction",
  "objection",
  "consent_withdrawal",
];

export type PrivacyRequest = {
  id: string;
  requestType: PrivacyRequestType;
  subjectType: PrivacySubjectType;
  subjectId: string;
  requesterName: string | null;
  requesterEmail: string | null;
  identityVerifiedAt: string | null;
  dueAt: string;
  status: PrivacyRequestStatus;
  resolutionNotes: string | null;
  completedAt: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrivacyRequestPreview = {
  request: Record<string, unknown>;
  subject: Record<string, unknown>;
  counts: Record<string, number>;
  ready: boolean;
  blockers: string[];
};

export type ConsentEvent = {
  id: string;
  leadId: string | null;
  contactId: string | null;
  partyId: string | null;
  channel: string;
  purpose: string;
  action: "granted" | "withdrawn" | "suppressed" | "resubscribed" | "expired";
  lawfulBasis: string | null;
  source: string;
  evidence: Record<string, unknown>;
  occurredAt: string;
};

export type PrivacyRetentionPolicy = {
  id: string;
  subject_type: PrivacySubjectType;
  name: string;
  retention_days: number;
  action: "restrict" | "anonymize";
  status: "active" | "inactive";
  last_run_at: string | null;
};

export type PrivacyRetentionDashboard = {
  policies: PrivacyRetentionPolicy[];
  runs: Array<{ id: string; subject_type: string; subject_id: string; operation: string; status: string; executed_at: string }>;
  metrics: { activePolicies: number; completedRuns: number; failedRuns: number };
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
