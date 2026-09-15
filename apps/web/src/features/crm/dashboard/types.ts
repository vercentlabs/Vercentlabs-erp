// getCrmDashboard's own return shape (services/api/src/modules/crm/
// pipeline-analytics-and-forecasting/analytics-service.js) — every field
// here is a real, permission-scoped aggregation computed there; this type
// only names what the backend already returns, it does not derive anything.
export type CrmDashboardMetrics = {
  currencyCode: string | null;
  openLeads: number;
  qualifiedLeads: number;
  openOpportunities: number;
  pipelineValue: number;
  weightedPipeline: number;
  overdueActivities: number;
  dueToday: number;
  leadsThisMonth: number;
  conversionsThisMonth: number;
  unassignedLeads: number;
  dwellBreachedLeads: number;
  stalledOpportunities: number;
  needsQualificationLeads: number;
  highPriorityLeads: number;
  uncoveredTerritories: number;
};

export type CrmDashboardStage = {
  id: string;
  name: string;
  sequence: number;
  opportunityCount: number;
  amount: number;
};

export type CrmDashboardSource = {
  name: string;
  leadCount: number;
  convertedCount: number;
};

// A camelized tenant.crm_activities row (any activityType — call, meeting,
// task, follow_up), plus the assignedName join. Only the fields this
// screen renders are declared; the backend row has more.
export type CrmDashboardActivity = {
  id: string;
  activityType: "call" | "meeting" | "task" | "follow_up" | string;
  subject: string | null;
  status: string;
  priority: string | null;
  dueAt: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  entityType: string | null;
  entityId: string | null;
};

export type CrmDashboard = {
  metrics: CrmDashboardMetrics;
  stages: CrmDashboardStage[];
  sources: CrmDashboardSource[];
  activities: CrmDashboardActivity[];
};
