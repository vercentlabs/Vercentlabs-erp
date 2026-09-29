"use client";

export class CoverageApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export type CoverageMember = {
  userId: string;
  name: string | null;
  role: string;
  allocationPercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  state: "current" | "scheduled" | "ended";
};

export type CoverageWork = {
  openOpportunities: number;
  openPipeline: number;
  openLeads: number;
};

export type CoverageTeam = {
  id: string;
  code: string;
  name: string;
  parentTeamId: string | null;
  managerUserId: string | null;
  managerName: string | null;
  status: string;
  members: CoverageMember[];
  currentMemberCount: number;
  work: CoverageWork;
};

export type CoverageTerritory = {
  id: string;
  code: string;
  name: string;
  parentTerritoryId: string | null;
  territoryType: string;
  status: string;
  managerName: string | null;
  primaryAssigneeType: "user" | "team" | null;
  primaryAssigneeId: string | null;
  primaryAssigneeName: string | null;
  primaryEffectiveFrom: string | null;
  secondaryAssignments: number;
};

export type CoverageGap = {
  kind:
    | "territory_without_owner"
    | "team_without_manager"
    | "team_without_members"
    | "seller_without_team";
  id: string;
  label: string;
  detail: string;
};

export type SalesCoverage = {
  asOf: string;
  teams: CoverageTeam[];
  territories: CoverageTerritory[];
  unattributedWork: CoverageWork;
  unassigned: { leads: number; opportunities: number; accounts: number };
  gaps: CoverageGap[];
  quota:
    | { available: false; reason: string }
    | {
        available: true;
        quota: number | null;
        attainmentPercent: number | null;
      };
  permissions: {
    manageTeams: boolean;
    manageTerritories: boolean;
    reassign: boolean;
  };
};

export type UnassignedType = "leads" | "opportunities" | "accounts";

export type UnassignedRecord = {
  id: string;
  code: string | null;
  name: string | null;
  detail: string | null;
  city: string | null;
  countryCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReassignmentResult = {
  summary: {
    requested: number;
    applied: number;
    conflict: number;
    skipped: number;
    failed: number;
  };
  results: Array<{
    id: string;
    status: string;
    code?: string;
    message?: string;
  }>;
};

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false)
    throw new CoverageApiError(
      payload.message || "The request could not be completed.",
      response.status,
      payload.code,
    );
  return payload;
}

export async function getSalesCoverage(): Promise<SalesCoverage> {
  return (
    await parse<{ coverage: SalesCoverage }>(await fetch("/api/crm/coverage"))
  ).coverage;
}

export async function listUnassigned(
  type: UnassignedType,
  cursor: string | null,
): Promise<{ records: UnassignedRecord[]; nextCursor: string | null }> {
  const params = new URLSearchParams({ type, limit: "50" });
  if (cursor) params.set("cursor", cursor);
  return parse(
    await fetch(`/api/crm/coverage/unassigned?${params.toString()}`),
  );
}

export async function reassignCoverage(input: {
  type: UnassignedType;
  ids: string[];
  ownerUserId: string;
  reason: string;
  expectedUpdatedAt: Record<string, string>;
}): Promise<ReassignmentResult> {
  const payload = await parse<{ reassignment: ReassignmentResult }>(
    await fetch("/api/crm/coverage/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return payload.reassignment;
}

export async function transferTerritory(
  territoryId: string,
  input: {
    assigneeType: "user" | "team";
    assigneeId: string;
    effectiveFrom: string;
    reason: string;
  },
): Promise<{ changed: boolean }> {
  const payload = await parse<{ transfer: { changed: boolean } }>(
    await fetch(`/api/crm/coverage/territories/${territoryId}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return payload.transfer;
}
