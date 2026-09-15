// tenant.crm_sales_teams / tenant.crm_territories rows via the generic
// /api/crm/[resource] boundary — see resource-registry.js's "sales-teams"
// and "territories" definitions for the authoritative field map.
export type SalesTeam = {
  id: string;
  companyId: string | null;
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

export type Territory = {
  id: string;
  companyId: string | null;
  parentTerritoryId: string | null;
  code: string;
  name: string;
  territoryType: string | null;
  managerUserId: string | null;
  assignmentRules: Record<string, unknown> | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type SalesTeamMember = {
  id: string;
  companyId: string | null;
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

export type TerritoryAssignment = {
  id: string;
  companyId: string | null;
  territoryId: string;
  assigneeType: "user" | "team";
  assigneeId: string;
  assignmentRole: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
