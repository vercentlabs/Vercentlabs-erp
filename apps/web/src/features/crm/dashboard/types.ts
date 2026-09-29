// getCrmDashboard's own return shape (services/api/src/modules/crm/
// pipeline-analytics-and-forecasting/analytics-service.js) — every field
// here is a real, permission-scoped aggregation computed there; this type
// only names what the backend already returns, it does not derive anything.
export type CrmDashboardMetrics = {
  currencyCode: string | null;
  openLeads: number;
  qualifiedLeads: number;
  openOpportunities: number;
  // ::numeric-cast SQL aggregates — node-postgres returns these as strings
  // at runtime (see shared/format.ts's money()), unlike the plain
  // count(*)::int fields on this type, which really are numbers.
  pipelineValue: number | string;
  weightedPipeline: number | string;
  overdueActivities: number;
  dueToday: number;
  overdueTasks: number;
  // Period figures for the selected range, and the same-length range just before it.
  leadsInPeriod: number;
  leadsPreviousPeriod: number;
  conversionsInPeriod: number;
  conversionsPreviousPeriod: number;
  wonInPeriod: number;
  wonPreviousPeriod: number;
  wonAmountInPeriod: number | string;
  wonAmountPreviousPeriod: number | string;
  lostInPeriod: number;
  lostPreviousPeriod: number;
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
  amount: number | string;
  // sum(expected_revenue) of the same open opportunities.
  weightedAmount: number | string;
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

// Active Leads by qualification decision — always all three keys, in this
// order, adding up to metrics.openLeads.
export type CrmDashboardQualification = {
  key: "qualified" | "not_reviewed" | "unqualified";
  count: number;
};

// Six calendar months ending with the current one ("2026-09"), empty months
// included: leads created in the month, and leads converted in the month.
export type CrmDashboardLeadTrendMonth = {
  month: string;
  created: number;
  converted: number;
};

// Leads created in the selected period, by source, with how many of them
// have converted. The six largest sources are named; the rest are summed
// into one row with isOther = true (sourceId null, like "Unspecified").
export type CrmDashboardSourcePerformance = {
  sourceId: string | null;
  name: string;
  leadCount: number;
  convertedCount: number;
  isOther: boolean;
};

export type CrmDashboardScope = "mine" | "team" | "all";

export type CrmDashboard = {
  scope: CrmDashboardScope;
  period: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
  };
  canViewAll: boolean;
  metrics: CrmDashboardMetrics;
  stages: CrmDashboardStage[];
  // All-time lead sources (Lead Sources settings and mobile read this).
  sources: CrmDashboardSource[];
  activities: CrmDashboardActivity[];
  qualification: CrmDashboardQualification[];
  leadTrend: CrmDashboardLeadTrendMonth[];
  sourcePerformance: CrmDashboardSourcePerformance[];
};
