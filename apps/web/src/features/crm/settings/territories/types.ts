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

// F020: which leads a territory covers. Every filled dimension must match a
// lead; values within one dimension are alternatives. Empty = no automatic
// coverage (the territory is used only where a rule names it).
export type TerritoryCoverage = { countryCodes?: string[]; states?: string[]; cities?: string[]; industries?: string[]; sourceIds?: string[] };
export const TERRITORY_TYPES = ["geographic", "industry", "account", "product", "channel", "named", "hybrid"] as const;

export type Territory = {
  id: string;
  companyId: string | null;
  parentTerritoryId: string | null;
  code: string;
  name: string;
  territoryType: string | null;
  managerUserId: string | null;
  assignmentRules: TerritoryCoverage | null;
  status: "active" | "archived";
  // F020 Stage A2 §8 — computed by the generic list route (never by client
  // aggregation), the exact same predicate the CRM dashboard's
  // uncovered_territories metric already uses.
  hasPrimaryCoverage?: boolean;
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

// tenant.crm_quota_plans rows via the generic /api/crm/[resource]
// boundary — CHECK (num_nonnulls(team_id, territory_id, user_id) >= 1)
// means a quota is assigned to at least one of team/territory/user.
export type QuotaPlan = {
  id: string;
  companyId: string | null;
  teamId: string | null;
  territoryId: string | null;
  userId: string | null;
  name: string;
  quotaType: "revenue" | "bookings" | "margin" | "quantity" | "new_logo" | "activity";
  periodStart: string;
  periodEnd: string;
  currencyCode: string | null;
  targetAmount: number;
  stretchAmount: number | null;
  status: "draft" | "active" | "closed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type CrmListResponse<T> = { rows: T[]; total: number; limit: number; offset: number };
