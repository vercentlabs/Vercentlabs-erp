export const CRM_RESOURCE_KEYS: readonly [
  "leads",
  "opportunities",
  "activities",
  "stages",
  "sources",
  "lost-reasons",
  "capture-forms",
  "sales-teams",
  "sales-team-members",
];
export type CrmResourceKey = (typeof CRM_RESOURCE_KEYS)[number];
export const CRM_LEAD_STATUSES: readonly string[];
export const CRM_LEAD_RECORD_STATUSES: readonly ["active", "converted", "archived"];
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
  activityType?: "task" | "call" | "meeting" | "email" | "whatsapp" | "sms" | "note" | "all";
  priority?: "low" | "medium" | "high" | "urgent" | "all";
  rating?: "cold" | "warm" | "hot" | "all";
  followup?: "overdue" | "today" | "upcoming" | "none" | "all";
  qualification?: "not_reviewed" | "qualified" | "unqualified" | "all";
  due?: "today" | "overdue" | "upcoming" | "all";
  opportunityId?: string;
  limit?: number;
  offset?: number;
};

export type CrmContext = {
  organizationId: string;
  userId: string;
  // canViewAllCrmRecords() (crm-access-scope.js) reads these
  // to decide record-ownership scope. Always populated — from the real
  // authenticated session for human requests (crmContext()), or from a
  // least-privilege system actor (services/worker's buildSystemContext()).
  // There is no anonymous/public CrmContext: public lead capture uses a
  // separate function (captureCrmLead) that never touches this type.
  permissions: readonly string[];
  roleSlugs: readonly string[];
};
