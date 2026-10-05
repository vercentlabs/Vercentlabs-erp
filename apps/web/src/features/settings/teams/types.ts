// tenant.crm_sales_teams and tenant.crm_sales_team_members rows via the
// generic /api/crm/[resource] boundary. Teams group people for lead
// assignment (round robin, team queues) and for team record visibility.
export type SalesTeam = {
  id: string;
  parentTeamId: string | null;
  code: string;
  name: string;
  managerUserId: string | null;
  defaultPipelineId: string | null;
  currencyCode: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type SalesTeamMember = {
  id: string;
  teamId: string;
  userId: string;
  memberRole: string | null;
  allocationPercent: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
};
