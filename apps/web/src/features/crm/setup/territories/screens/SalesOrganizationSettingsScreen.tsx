"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Pencil, Plus, Users } from "lucide-react";
import {
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  PermissionState,
  StatusBadge,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { money } from "@/features/crm/shared/format";
import { humanize } from "@/shared/format/human";
import {
  archiveQuotaPlan,
  archiveSalesTeam,
  archiveTerritory,
  listQuotaPlans,
  listSalesTeams,
  listTerritories,
  SettingsApiError,
} from "../api/territories-api";
import {
  type QuotaPlan,
  type SalesTeam,
  type Territory,
  type TerritoryCoverage,
} from "../types";
import { dateFormatter } from "../components/sales-organization-format";
import { TeamDialog } from "../components/TeamDialog";
import { TerritoryDialog } from "../components/TerritoryDialog";
import { TeamMembersDialog } from "../components/TeamMembersDialog";
import { TerritoryAssignmentsDialog } from "../components/TerritoryAssignmentsDialog";
import { QuotaPlanDialog } from "../components/QuotaPlanDialog";
import { TerritoryMatchCheck } from "../components/TerritoryMatchCheck";

// F020 Territories & Sales Teams — a governed setup screen, not frontend
// constants. All four resources reuse the generic /api/crm/[resource]
// boundary (crm.settings.manage). Hierarchy (parentTeamId/parentTerritoryId)
// is server-cycle-guarded (resource-mutation-service.js); membership/
// assignment lists are server-scoped by teamId/territoryId (otherwise every
// team's/territory's rows would leak into one dialog).
// Revenue/bookings/margin quotas are money; new logos, quantity and activity
// quotas are counts and must not carry a currency.
const MONETARY_QUOTA_TYPES = new Set(["revenue", "bookings", "margin"]);
function quotaValue(
  quotaType: string,
  currencyCode: string | null,
  value: string | number | null,
) {
  if (MONETARY_QUOTA_TYPES.has(quotaType))
    return money(currencyCode, value ?? 0);
  return new Intl.NumberFormat("en-IN").format(Number(value ?? 0));
}

export function SalesOrganizationSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  // F020: team structure, territory structure and targets are separate
  // authorities; the screen opens for any of them and each section's actions
  // follow its own permission (the server enforces the same map).
  const canManageTeams = workspace.permissions.includes(
    CRM_PERMISSIONS.teamsManage,
  );
  const canManageTerritories = workspace.permissions.includes(
    CRM_PERMISSIONS.territoriesManage,
  );
  const canManageQuotas = workspace.permissions.includes(
    CRM_PERMISSIONS.forecastManage,
  );
  const canManage = canManageTeams || canManageTerritories || canManageQuotas;

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<SalesTeam | null>(null);
  const [territoryDialogOpen, setTerritoryDialogOpen] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<Territory | null>(
    null,
  );
  const [membersTeam, setMembersTeam] = useState<SalesTeam | null>(null);
  const [assignmentsTerritory, setAssignmentsTerritory] =
    useState<Territory | null>(null);
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "sales-teams"),
    queryFn: listSalesTeams,
  });
  const territoriesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "territories"),
    queryFn: listTerritories,
  });
  const quotaPlansQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "quota-plans"),
    queryFn: listQuotaPlans,
  });
  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: getCrmOptions,
  });

  const teams = useMemo(() => teamsQuery.data?.rows ?? [], [teamsQuery.data]);
  const territories = useMemo(
    () => territoriesQuery.data?.rows ?? [],
    [territoriesQuery.data],
  );
  const quotaPlans = useMemo(
    () => quotaPlansQuery.data?.rows ?? [],
    [quotaPlansQuery.data],
  );
  const teamNameById = useMemo(
    () => new Map(teams.map((team) => [team.id, team.name])),
    [teams],
  );
  const territoryNameById = useMemo(
    () =>
      new Map(territories.map((territory) => [territory.id, territory.name])),
    [territories],
  );

  const managerOptions: SelectOption[] = useMemo(() => {
    const rows =
      optionsQuery.data?.options?.members ??
      optionsQuery.data?.options?.users ??
      [];
    return [
      { value: "", label: "No manager" },
      ...rows.map((row) => ({
        value: String(row.id),
        label: String(row.fullName || row.name || row.id),
      })),
    ];
  }, [optionsQuery.data]);
  const userOptions: SelectOption[] = useMemo(() => {
    const rows =
      optionsQuery.data?.options?.members ??
      optionsQuery.data?.options?.users ??
      [];
    return rows.map((row) => ({
      value: String(row.id),
      label: String(row.fullName || row.name || row.id),
    }));
  }, [optionsQuery.data]);
  const userOptionLabel = useMemo(() => {
    const byId = new Map(
      userOptions.map((option) => [option.value, option.label]),
    );
    return (userId: string) => byId.get(userId) || "a user outside your list";
  }, [userOptions]);
  const pipelineOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.pipelines ?? [];
    return [
      { value: "", label: "No default pipeline" },
      ...rows.map((row) => ({
        value: String(row.id),
        label: String(row.name || row.id),
      })),
    ];
  }, [optionsQuery.data]);
  function parentTeamOptions(excludeId?: string): SelectOption[] {
    return [
      { value: "", label: "No parent team" },
      ...teams
        .filter((team) => team.id !== excludeId)
        .map((team) => ({ value: team.id, label: team.name })),
    ];
  }
  function parentTerritoryOptions(excludeId?: string): SelectOption[] {
    return [
      { value: "", label: "No parent territory" },
      ...territories
        .filter((territory) => territory.id !== excludeId)
        .map((territory) => ({ value: territory.id, label: territory.name })),
    ];
  }

  function invalidateTeams() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "sales-teams"),
    });
  }
  function invalidateTerritories() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "territories"),
    });
  }
  function invalidateQuotaPlans() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "quota-plans"),
    });
  }
  function handleError(err: unknown) {
    setError(
      err instanceof SettingsApiError
        ? err.message
        : "This action could not be completed.",
    );
    // A stale-write conflict means a row's local updatedAt is already
    // wrong — refetch both lists so the next attempt uses current data.
    if (err instanceof SettingsApiError && err.code === "CRM_STALE_WRITE") {
      invalidateTeams();
      invalidateTerritories();
    }
  }

  const archiveTeamMutation = useMutation({
    mutationFn: (team: SalesTeam) => archiveSalesTeam(team.id, team.updatedAt),
    onSuccess: invalidateTeams,
    onError: handleError,
  });
  const archiveTerritoryMutation = useMutation({
    mutationFn: (territory: Territory) =>
      archiveTerritory(territory.id, territory.updatedAt),
    onSuccess: invalidateTerritories,
    onError: handleError,
  });
  const archiveQuotaPlanMutation = useMutation({
    mutationFn: (plan: QuotaPlan) => archiveQuotaPlan(plan.id, plan.updatedAt),
    onSuccess: invalidateQuotaPlans,
    onError: handleError,
  });

  const teamColumns: ColumnDef<SalesTeam, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="font-medium text-text">{row.original.name}</span>
        ),
      },
      {
        id: "parentTeamId",
        header: "Parent team",
        accessorFn: (row) =>
          row.parentTeamId ? teamNameById.get(row.parentTeamId) || "—" : "—",
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>
            {String(getValue())}
          </StatusBadge>
        ),
      },
      {
        id: "updatedAt",
        header: "Updated",
        accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)),
      },
    ],
    [teamNameById],
  );

  const territoryColumns: ColumnDef<Territory, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="font-medium text-text">{row.original.name}</span>
        ),
      },
      {
        id: "territoryType",
        header: "Type",
        accessorFn: (row) =>
          row.territoryType ? humanize(row.territoryType) : "—",
      },
      {
        id: "parentTerritoryId",
        header: "Parent territory",
        accessorFn: (row) =>
          row.parentTerritoryId
            ? territoryNameById.get(row.parentTerritoryId) || "—"
            : "—",
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>
            {String(getValue())}
          </StatusBadge>
        ),
      },
      // F020 — the "coverage gap" signal, per row (the CRM dashboard shows
      // the aggregate count). A non-active territory intentionally shows no badge —
      // coverage only matters for territories currently in use.
      {
        id: "covers",
        header: "Covers",
        accessorFn: (row) => describeCoverage(row.assignmentRules),
      },
      {
        id: "coverage",
        header: "Coverage",
        cell: ({ row }) =>
          row.original.status !== "active" ? null : (
            <StatusBadge
              tone={row.original.hasPrimaryCoverage ? "success" : "danger"}
            >
              {row.original.hasPrimaryCoverage ? "Covered" : "Uncovered"}
            </StatusBadge>
          ),
      },
      {
        id: "updatedAt",
        header: "Updated",
        accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)),
      },
    ],
    [territoryNameById],
  );

  const quotaColumns: ColumnDef<QuotaPlan, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="font-medium text-text">{row.original.name}</span>
        ),
      },
      {
        id: "assignee",
        header: "Assigned to",
        // Names are resolved in `cell`, not `accessorFn`: TanStack caches
        // accessor values per row until the data changes, so a name looked up
        // before the people/teams lists loaded would otherwise stick.
        accessorFn: (row) => row.teamId ?? row.territoryId ?? row.userId ?? "",
        cell: ({ row }) =>
          row.original.teamId
            ? `Team: ${teamNameById.get(row.original.teamId) || "…"}`
            : row.original.territoryId
              ? `Territory: ${territoryNameById.get(row.original.territoryId) || "…"}`
              : row.original.userId
                ? `User: ${userOptionLabel(row.original.userId)}`
                : "—",
      },
      {
        id: "quotaType",
        header: "Type",
        accessorFn: (row) => humanize(row.quotaType),
      },
      {
        id: "period",
        header: "Period",
        accessorFn: (row) =>
          `${dateFormatter.format(new Date(row.periodStart))} – ${dateFormatter.format(new Date(row.periodEnd))}`,
      },
      {
        id: "targetAmount",
        header: "Target",
        accessorFn: (row) =>
          quotaValue(row.quotaType, row.currencyCode, row.targetAmount),
      },
      {
        id: "stretchAmount",
        header: "Stretch",
        accessorFn: (row) =>
          row.stretchAmount === null
            ? "—"
            : quotaValue(row.quotaType, row.currencyCode, row.stretchAmount),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => (
          <StatusBadge
            tone={
              getValue() === "active"
                ? "success"
                : getValue() === "cancelled"
                  ? "danger"
                  : "neutral"
            }
          >
            {String(getValue())}
          </StatusBadge>
        ),
      },
    ],
    [teamNameById, territoryNameById, userOptionLabel],
  );

  // Creating anything here needs the people and pipelines to choose from; until they have loaded, creation is off and the
  // reason is stated, with a retry when the load failed.
  const optionsReady = optionsQuery.isSuccess;
  const optionsNotice = optionsQuery.isError ? (
    <p
      role="alert"
      className="flex items-center gap-3 rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
    >
      The people and pipelines needed to create teams, territories and quotas
      could not be loaded.
      <Button
        variant="secondary"
        size="compact"
        onPress={() => optionsQuery.refetch()}
      >
        Try again
      </Button>
    </p>
  ) : optionsQuery.isLoading ? (
    <p role="status" className="text-sm text-text-muted">
      Loading the people and pipelines you can choose from. Creating is
      available in a moment.
    </p>
  ) : null;

  if (!canManage)
    return (
      <PermissionState
        title="You don't have access to sales structure setup"
        description="Ask an administrator for team, territory or quota management."
      />
    );

  return (
    <div className="flex flex-col gap-8">
      {optionsNotice}
      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Sales teams",
          description:
            "Teams own quota, pipeline defaults, and Task/queue membership.",
          primaryAction: (
            <Button
              variant="primary"
              isDisabled={!optionsReady || !canManageTeams}
              onPress={() => setTeamDialogOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New team
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<SalesTeam>
          aria-label="Sales teams"
          columns={teamColumns}
          data={teams}
          getRowId={(row) => row.id}
          {...gridStates(teamsQuery, teams.length, "sales teams", {
            title: "No sales teams yet",
            description:
              "A sales team groups sellers who work together, and owns the quotas and pipeline defaults for its members.",
          })}
          rowActions={(row) => (
            <span
              onClick={(event) => event.stopPropagation()}
              className="flex items-center gap-1"
            >
              <IconButton
                aria-label={`Edit ${row.name}`}
                size="compact"
                variant="outline"
                onPress={() => setEditingTeam(row)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={`Manage members of ${row.name}`}
                size="compact"
                variant="outline"
                onPress={() => setMembersTeam(row)}
              >
                <Users className="size-4" aria-hidden="true" />
              </IconButton>
              {row.status === "active" && (
                <IconButton
                  aria-label={`Archive ${row.name}`}
                  size="compact"
                  variant="danger"
                  onPress={() => archiveTeamMutation.mutate(row)}
                >
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              )}
            </span>
          )}
        />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Territories",
          description:
            "Coverage areas. A territory assignment rule sends each lead to the territory whose coverage it matches, and that territory's team gets it.",
          primaryAction: (
            <Button
              variant="primary"
              isDisabled={!optionsReady || !canManageTerritories}
              onPress={() => setTerritoryDialogOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New territory
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<Territory>
          aria-label="Territories"
          columns={territoryColumns}
          data={territories}
          getRowId={(row) => row.id}
          {...gridStates(territoriesQuery, territories.length, "territories", {
            title: "No territories yet",
            description:
              "A territory is a coverage area, such as a region or industry, used to route leads to the right team.",
          })}
          rowActions={(row) => (
            <span
              onClick={(event) => event.stopPropagation()}
              className="flex items-center gap-1"
            >
              <IconButton
                aria-label={`Edit ${row.name}`}
                size="compact"
                variant="outline"
                onPress={() => setEditingTerritory(row)}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={`Manage assignments for ${row.name}`}
                size="compact"
                variant="outline"
                onPress={() => setAssignmentsTerritory(row)}
              >
                <Users className="size-4" aria-hidden="true" />
              </IconButton>
              {row.status === "active" && (
                <IconButton
                  aria-label={`Archive ${row.name}`}
                  size="compact"
                  variant="danger"
                  onPress={() => archiveTerritoryMutation.mutate(row)}
                >
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              )}
            </span>
          )}
        />
        <TerritoryMatchCheck />
      </EnterpriseListPage>

      <EnterpriseListPage
        header={{
          title: "Quota plans",
          description:
            "Revenue/bookings/margin targets assigned to a team, territory or individual for a period.",
          primaryAction: (
            <Button
              variant="primary"
              isDisabled={!optionsReady || !canManageQuotas}
              onPress={() => setQuotaDialogOpen(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              New quota plan
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<QuotaPlan>
          aria-label="Quota plans"
          columns={quotaColumns}
          data={quotaPlans}
          getRowId={(row) => row.id}
          {...gridStates(quotaPlansQuery, quotaPlans.length, "quota plans", {
            title: "No quota plans yet",
            description:
              "A quota plan sets a revenue target for a team, territory or person over a period.",
          })}
          rowActions={(row) =>
            row.status !== "cancelled" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton
                  aria-label={`Cancel ${row.name}`}
                  size="compact"
                  variant="danger"
                  onPress={() => archiveQuotaPlanMutation.mutate(row)}
                >
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <TeamDialog
        isOpen={teamDialogOpen || Boolean(editingTeam)}
        onOpenChange={(open) => {
          if (!open) {
            setTeamDialogOpen(false);
            setEditingTeam(null);
          }
        }}
        team={editingTeam}
        managerOptions={managerOptions}
        pipelineOptions={pipelineOptions}
        parentTeamOptions={parentTeamOptions(editingTeam?.id)}
        onSaved={invalidateTeams}
        onError={handleError}
      />
      <TerritoryDialog
        isOpen={territoryDialogOpen || Boolean(editingTerritory)}
        onOpenChange={(open) => {
          if (!open) {
            setTerritoryDialogOpen(false);
            setEditingTerritory(null);
          }
        }}
        territory={editingTerritory}
        managerOptions={managerOptions}
        parentTerritoryOptions={parentTerritoryOptions(editingTerritory?.id)}
        onSaved={invalidateTerritories}
        onError={handleError}
      />
      <TeamMembersDialog
        team={membersTeam}
        onOpenChange={(open) => !open && setMembersTeam(null)}
        userOptions={userOptions}
        onError={handleError}
      />
      <TerritoryAssignmentsDialog
        territory={assignmentsTerritory}
        onOpenChange={(open) => !open && setAssignmentsTerritory(null)}
        userOptions={userOptions}
        teamOptions={teams.map((team) => ({
          value: team.id,
          label: team.name,
        }))}
        onError={handleError}
      />
      <QuotaPlanDialog
        isOpen={quotaDialogOpen}
        onOpenChange={setQuotaDialogOpen}
        teamOptions={teams.map((team) => ({
          value: team.id,
          label: team.name,
        }))}
        territoryOptions={territories.map((territory) => ({
          value: territory.id,
          label: territory.name,
        }))}
        userOptions={userOptions}
        onSaved={invalidateQuotaPlans}
        onError={handleError}
      />
    </div>
  );
}
function describeCoverage(rules: TerritoryCoverage | null | undefined) {
  const parts = [
    ...(rules?.cities ?? []),
    ...(rules?.states ?? []),
    ...(rules?.industries ?? []),
  ];
  if (!parts.length && rules?.countryCodes?.length)
    parts.push(...rules.countryCodes);
  if (rules?.sourceIds?.length)
    parts.push(`${rules.sourceIds.length} lead source(s)`);
  return parts.length ? parts.join(", ") : "Named in rules only";
}
