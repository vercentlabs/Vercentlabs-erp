export const CRM_RESOURCE_KEYS: readonly [
  "leads",
  "opportunities",
  "activities",
  "campaigns",
  "communications",
  "pipelines",
  "stages",
  "sources",
  "lost-reasons",
  "tags",
  "scoring-rules",
  "assignment-rules",
  "sequences",
  "sequence-steps",
  "sequence-enrollments",
  "automation-rules",
  "capture-forms",
  "competitors",
  "forecast-targets",
  "integrations",
  "webhook-subscriptions",
  "saved-views",
  "sales-teams",
  "sales-team-members",
  "territories",
  "territory-assignments",
  "quota-plans",
  "forecast-periods",
  "forecast-submissions",
  "account-plans",
  "account-stakeholders",
  "playbooks",
  "playbook-questions",
  "playbook-responses",
  "consent-events",
  "privacy-requests",
  "data-quality-scores",
  "engagement-templates",
  "meeting-links",
  "sync-accounts",
  "conversations",
  "conversation-insights",
  "pipeline-inspections",
  "deal-risks",
  "recommendations",
  "buying-committees",
  "buying-committee-members",
  "relationship-edges",
  "account-signals",
  "partner-accounts",
  "partner-deals",
  "report-definitions",
  "dashboards",
  "dashboard-widgets",
  "custom-object-definitions",
  "custom-field-definitions",
  "custom-records",
  "field-visits",
  "enrichment-jobs",
  "ai-predictions",
  "ai-feedback",
];
export type CrmResourceKey = (typeof CRM_RESOURCE_KEYS)[number];
export const CRM_LEAD_STATUSES: readonly string[];
export const CRM_OPPORTUNITY_STATUSES: readonly string[];
export const CRM_ACTIVITY_TYPES: readonly string[];
export const CRM_CHANNELS: readonly string[];

export type CrmListRequest = {
  search?: string;
  status?: string;
  ownerId?: string;
  stageId?: string;
  pipelineId?: string;
  sourceId?: string;
  campaignId?: string;
  due?: "today" | "overdue" | "upcoming" | "all";
  limit?: number;
  offset?: number;
};

export type CrmContext = {
  organizationId: string;
  userId: string;
  activeCompanyId: string | null;
  activeBranchId: string | null;
  allowAllCompanies?: boolean;
};
