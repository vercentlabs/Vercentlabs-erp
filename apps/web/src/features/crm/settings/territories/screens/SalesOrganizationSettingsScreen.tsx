"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Pencil, Plus, Users } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  NumberField,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
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
  archiveSalesTeamMember,
  archiveTerritory,
  createQuotaPlan,
  createSalesTeam,
  createSalesTeamMember,
  createTerritory,
  createTerritoryAssignment,
  endTerritoryAssignment,
  listQuotaPlans,
  listSalesTeamMembers,
  listSalesTeams,
  listTerritories,
  listTerritoryAssignments,
  SettingsApiError,
  updateSalesTeam,
  updateTerritory,
  checkTerritoryMatch,
} from "../api/territories-api";
import { TERRITORY_TYPES, type QuotaPlan, type SalesTeam, type SalesTeamMember, type Territory, type TerritoryAssignment, type TerritoryCoverage } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// F020 Stage A2 §8 — the real, DB-enforced values (migration 003's
// assignment_role CHECK). Was previously a free-text field, which let a
// caller type e.g. "Primary" (capitalized) and silently fall outside both
// this dashboard's uncovered_territories count and F005's
// activeTerritoryUserIds exact-match filter — a real correctness gap, not
// just a UX one. 'overlay' is the dossier's own named "overlay/secondary
// assignment" concept — already modeled in the schema since the original
// migration, just never exposed as a selectable option.
const ASSIGNMENT_ROLE_OPTIONS: SelectOption[] = [
  { value: "primary", label: "Primary owner" },
  { value: "overlay", label: "Overlay (secondary coverage)" },
  { value: "shared", label: "Shared" },
  { value: "manager", label: "Manager" },
];

// F020 Territories & Sales Teams — a governed setup screen, not frontend
// constants. All four resources reuse the generic /api/crm/[resource]
// boundary (crm.settings.manage). Hierarchy (parentTeamId/parentTerritoryId)
// is server-cycle-guarded (resource-mutation-service.js); membership/
// assignment lists are server-scoped by teamId/territoryId (Tranche D —
// buildFilters had no such key before this pass, which would otherwise
// have leaked every team's/territory's rows into one dialog).
// Revenue/bookings/margin quotas are money; new logos, quantity and activity
// quotas are counts and must not carry a currency.
const MONETARY_QUOTA_TYPES = new Set(["revenue", "bookings", "margin"]);
function quotaValue(quotaType: string, currencyCode: string | null, value: string | number | null) {
  if (MONETARY_QUOTA_TYPES.has(quotaType)) return money(currencyCode, value ?? 0);
  return new Intl.NumberFormat("en-IN").format(Number(value ?? 0));
}

export function SalesOrganizationSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<SalesTeam | null>(null);
  const [territoryDialogOpen, setTerritoryDialogOpen] = useState(false);
  const [editingTerritory, setEditingTerritory] = useState<Territory | null>(null);
  const [membersTeam, setMembersTeam] = useState<SalesTeam | null>(null);
  const [assignmentsTerritory, setAssignmentsTerritory] = useState<Territory | null>(null);
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams"), queryFn: listSalesTeams });
  const territoriesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "territories"), queryFn: listTerritories });
  const quotaPlansQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "quota-plans"), queryFn: listQuotaPlans });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });

  const teams = useMemo(() => teamsQuery.data?.rows ?? [], [teamsQuery.data]);
  const territories = useMemo(() => territoriesQuery.data?.rows ?? [], [territoriesQuery.data]);
  const quotaPlans = useMemo(() => quotaPlansQuery.data?.rows ?? [], [quotaPlansQuery.data]);
  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const territoryNameById = useMemo(() => new Map(territories.map((territory) => [territory.id, territory.name])), [territories]);

  const managerOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.members ?? optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "No manager" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);
  const userOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.members ?? optionsQuery.data?.options?.users ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }));
  }, [optionsQuery.data]);
  const userOptionLabel = useMemo(() => {
    const byId = new Map(userOptions.map((option) => [option.value, option.label]));
    return (userId: string) => byId.get(userId) || "a user outside your list";
  }, [userOptions]);
  const pipelineOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.pipelines ?? [];
    return [{ value: "", label: "No default pipeline" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.name || row.id) }))];
  }, [optionsQuery.data]);
  function parentTeamOptions(excludeId?: string): SelectOption[] {
    return [{ value: "", label: "No parent team" }, ...teams.filter((team) => team.id !== excludeId).map((team) => ({ value: team.id, label: team.name }))];
  }
  function parentTerritoryOptions(excludeId?: string): SelectOption[] {
    return [{ value: "", label: "No parent territory" }, ...territories.filter((territory) => territory.id !== excludeId).map((territory) => ({ value: territory.id, label: territory.name }))];
  }

  function invalidateTeams() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams") });
  }
  function invalidateTerritories() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "territories") });
  }
  function invalidateQuotaPlans() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "quota-plans") });
  }
  function handleError(err: unknown) {
    setError(err instanceof SettingsApiError ? err.message : "This action could not be completed.");
    // A stale-write conflict means a row's local updatedAt is already
    // wrong — refetch both lists so the next attempt uses current data.
    if (err instanceof SettingsApiError && err.code === "CRM_STALE_WRITE") {
      invalidateTeams();
      invalidateTerritories();
    }
  }

  const archiveTeamMutation = useMutation({ mutationFn: (team: SalesTeam) => archiveSalesTeam(team.id, team.updatedAt), onSuccess: invalidateTeams, onError: handleError });
  const archiveTerritoryMutation = useMutation({ mutationFn: (territory: Territory) => archiveTerritory(territory.id, territory.updatedAt), onSuccess: invalidateTerritories, onError: handleError });
  const archiveQuotaPlanMutation = useMutation({ mutationFn: (plan: QuotaPlan) => archiveQuotaPlan(plan.id, plan.updatedAt), onSuccess: invalidateQuotaPlans, onError: handleError });

  const teamColumns: ColumnDef<SalesTeam, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "parentTeamId", header: "Parent team", accessorFn: (row) => (row.parentTeamId ? teamNameById.get(row.parentTeamId) || "—" : "—") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [teamNameById],
  );

  const territoryColumns: ColumnDef<Territory, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "territoryType", header: "Type", accessorFn: (row) => (row.territoryType ? humanize(row.territoryType) : "—") },
      { id: "parentTerritoryId", header: "Parent territory", accessorFn: (row) => (row.parentTerritoryId ? territoryNameById.get(row.parentTerritoryId) || "—" : "—") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      // F020 Stage A2 §8 — the dossier's required "coverage gap" signal,
      // now visible per-row (previously only an aggregate count on the CRM
      // dashboard). A non-active territory intentionally shows no badge —
      // coverage only matters for territories currently in use.
      { id: "covers", header: "Covers", accessorFn: (row) => describeCoverage(row.assignmentRules) },
      {
        id: "coverage",
        header: "Coverage",
        cell: ({ row }) =>
          row.original.status !== "active" ? null : (
            <StatusBadge tone={row.original.hasPrimaryCoverage ? "success" : "danger"}>
              {row.original.hasPrimaryCoverage ? "Covered" : "Uncovered"}
            </StatusBadge>
          ),
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [territoryNameById],
  );

  const quotaColumns: ColumnDef<QuotaPlan, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      {
        id: "assignee",
        header: "Assigned to",
        // Names are resolved in `cell`, not `accessorFn`: TanStack caches
        // accessor values per row until the data changes, so a name looked up
        // before the people/teams lists loaded would otherwise stick.
        accessorFn: (row) => row.teamId ?? row.territoryId ?? row.userId ?? "",
        cell: ({ row }) =>
          row.original.teamId ? `Team: ${teamNameById.get(row.original.teamId) || "…"}`
          : row.original.territoryId ? `Territory: ${territoryNameById.get(row.original.territoryId) || "…"}`
          : row.original.userId ? `User: ${userOptionLabel(row.original.userId)}`
          : "—",
      },
      { id: "quotaType", header: "Type", accessorFn: (row) => humanize(row.quotaType) },
      { id: "period", header: "Period", accessorFn: (row) => `${dateFormatter.format(new Date(row.periodStart))} – ${dateFormatter.format(new Date(row.periodEnd))}` },
      { id: "targetAmount", header: "Target", accessorFn: (row) => quotaValue(row.quotaType, row.currencyCode, row.targetAmount) },
      { id: "stretchAmount", header: "Stretch", accessorFn: (row) => (row.stretchAmount === null ? "—" : quotaValue(row.quotaType, row.currencyCode, row.stretchAmount)) },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : getValue() === "cancelled" ? "danger" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
    ],
    [teamNameById, territoryNameById, userOptionLabel],
  );

  // Creating anything here needs the people and pipelines to choose from; until they have loaded, creation is off and the
  // reason is stated, with a retry when the load failed.
  const optionsReady = optionsQuery.isSuccess;
  const optionsNotice = optionsQuery.isError ? (
    <p role="alert" className="flex items-center gap-3 rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
      The people and pipelines needed to create teams, territories and quotas could not be loaded.
      <Button variant="secondary" size="compact" onPress={() => optionsQuery.refetch()}>Try again</Button>
    </p>
  ) : optionsQuery.isLoading ? (
    <p role="status" className="text-sm text-text-muted">Loading the people and pipelines you can choose from. Creating is available in a moment.</p>
  ) : null;

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-8">
      {optionsNotice}
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Sales teams",
          description: "Teams own quota, pipeline defaults, and Task/queue membership.",
          primaryAction: (
            <Button variant="primary" isDisabled={!optionsReady} onPress={() => setTeamDialogOpen(true)}>
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
          {...gridStates(teamsQuery, teams.length, "sales teams", { title: "No sales teams yet", description: "A sales team groups sellers who work together, and owns the quotas and pipeline defaults for its members." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Edit ${row.name}`} size="compact" variant="outline" onPress={() => setEditingTeam(row)}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton aria-label={`Manage members of ${row.name}`} size="compact" variant="outline" onPress={() => setMembersTeam(row)}>
                <Users className="size-4" aria-hidden="true" />
              </IconButton>
              {row.status === "active" && (
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archiveTeamMutation.mutate(row)}>
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
          description: "Coverage areas. A territory assignment rule sends each lead to the territory whose coverage it matches, and that territory's team gets it.",
          primaryAction: (
            <Button variant="primary" isDisabled={!optionsReady} onPress={() => setTerritoryDialogOpen(true)}>
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
          {...gridStates(territoriesQuery, territories.length, "territories", { title: "No territories yet", description: "A territory is a coverage area, such as a region or industry, used to route leads to the right team." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Edit ${row.name}`} size="compact" variant="outline" onPress={() => setEditingTerritory(row)}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton aria-label={`Manage assignments for ${row.name}`} size="compact" variant="outline" onPress={() => setAssignmentsTerritory(row)}>
                <Users className="size-4" aria-hidden="true" />
              </IconButton>
              {row.status === "active" && (
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archiveTerritoryMutation.mutate(row)}>
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
          description: "Revenue/bookings/margin targets assigned to a team, territory or individual for a period.",
          primaryAction: (
            <Button variant="primary" isDisabled={!optionsReady} onPress={() => setQuotaDialogOpen(true)}>
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
          {...gridStates(quotaPlansQuery, quotaPlans.length, "quota plans", { title: "No quota plans yet", description: "A quota plan sets a revenue target for a team, territory or person over a period." })}
          rowActions={(row) =>
            row.status !== "cancelled" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Cancel ${row.name}`} size="compact" variant="danger" onPress={() => archiveQuotaPlanMutation.mutate(row)}>
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
        teamOptions={teams.map((team) => ({ value: team.id, label: team.name }))}
        onError={handleError}
      />
      <QuotaPlanDialog
        isOpen={quotaDialogOpen}
        onOpenChange={setQuotaDialogOpen}
        teamOptions={teams.map((team) => ({ value: team.id, label: team.name }))}
        territoryOptions={territories.map((territory) => ({ value: territory.id, label: territory.name }))}
        userOptions={userOptions}
        onSaved={invalidateQuotaPlans}
        onError={handleError}
      />
    </div>
  );
}

function TeamDialog({
  isOpen,
  onOpenChange,
  team,
  managerOptions,
  pipelineOptions,
  parentTeamOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  team: SalesTeam | null;
  managerOptions: SelectOption[];
  pipelineOptions: SelectOption[];
  parentTeamOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState(team?.code ?? "");
  const [name, setName] = useState(team?.name ?? "");
  const [managerUserId, setManagerUserId] = useState(team?.managerUserId ?? "");
  const [parentTeamId, setParentTeamId] = useState(team?.parentTeamId ?? "");
  const [defaultPipelineId, setDefaultPipelineId] = useState(team?.defaultPipelineId ?? "");
  const [currencyCode, setCurrencyCode] = useState(team?.currencyCode ?? "");

  const [seededFor, setSeededFor] = useState<SalesTeam | null | undefined>(undefined);
  if (isOpen && team !== seededFor) {
    setSeededFor(team);
    setCode(team?.code ?? "");
    setName(team?.name ?? "");
    setManagerUserId(team?.managerUserId ?? "");
    setParentTeamId(team?.parentTeamId ?? "");
    setDefaultPipelineId(team?.defaultPipelineId ?? "");
    setCurrencyCode(team?.currencyCode ?? "");
  }

  const input = {
    code,
    name,
    managerUserId: managerUserId || null,
    parentTeamId: parentTeamId || null,
    defaultPipelineId: defaultPipelineId || null,
    currencyCode: currencyCode || null,
  };
  const mutation = useMutation({
    mutationFn: () => (team ? updateSalesTeam(team.id, input, team.updatedAt) : createSalesTeam(input)),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={team ? `Edit ${team.name}` : "New sales team"}>
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Parent team" options={parentTeamOptions} selectedKey={parentTeamId} onSelectionChange={(key) => setParentTeamId(String(key ?? ""))} />
        <Select label="Manager" options={managerOptions} selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key ?? ""))} />
        <Select label="Default pipeline" options={pipelineOptions} selectedKey={defaultPipelineId} onSelectionChange={(key) => setDefaultPipelineId(String(key ?? ""))} />
        <TextField label="Currency code" placeholder="e.g. INR, USD" value={currencyCode} onChange={setCurrencyCode} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!code.trim() || !name.trim()}>
            {team ? "Save changes" : "Create team"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TerritoryDialog({
  isOpen,
  onOpenChange,
  territory,
  managerOptions,
  parentTerritoryOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  territory: Territory | null;
  managerOptions: SelectOption[];
  parentTerritoryOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState(territory?.code ?? "");
  const [name, setName] = useState(territory?.name ?? "");
  const [territoryType, setTerritoryType] = useState(territory?.territoryType ?? "");
  const [managerUserId, setManagerUserId] = useState(territory?.managerUserId ?? "");
  const [parentTerritoryId, setParentTerritoryId] = useState(territory?.parentTerritoryId ?? "");
  const [coverage, setCoverage] = useState(() => coverageText(territory?.assignmentRules));

  const [seededFor, setSeededFor] = useState<Territory | null | undefined>(undefined);
  if (isOpen && territory !== seededFor) {
    setSeededFor(territory);
    setCode(territory?.code ?? "");
    setName(territory?.name ?? "");
    setTerritoryType(territory?.territoryType ?? "");
    setManagerUserId(territory?.managerUserId ?? "");
    setParentTerritoryId(territory?.parentTerritoryId ?? "");
    setCoverage(coverageText(territory?.assignmentRules));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const assignmentRules = coverageFromText(coverage);
      const input = {
        code,
        name,
        territoryType: territoryType || "geographic",
        managerUserId: managerUserId || null,
        parentTerritoryId: parentTerritoryId || null,
        assignmentRules,
      };
      return territory ? updateTerritory(territory.id, input, territory.updatedAt) : createTerritory(input);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={territory ? `Edit ${territory.name}` : "New territory"}>
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Type" options={TERRITORY_TYPE_OPTIONS} selectedKey={territoryType || "geographic"} onSelectionChange={(key) => setTerritoryType(String(key ?? "geographic"))} />
        <Select label="Parent territory" options={parentTerritoryOptions} selectedKey={parentTerritoryId} onSelectionChange={(key) => setParentTerritoryId(String(key ?? ""))} />
        <Select label="Manager" options={managerOptions} selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key ?? ""))} />
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div>
            <p className="text-sm font-medium text-text">Which leads this territory covers</p>
            <p className="text-xs text-text-muted">
              Optional. Separate values with commas. A lead belongs here when every filled line matches it; leave all empty to use this territory only where an assignment rule names it. The most specific match wins, so a city territory beats its state.
            </p>
          </div>
          <TextField label="Countries (two-letter codes)" placeholder="IN" value={coverage.countryCodes} onChange={(value) => setCoverage((current) => ({ ...current, countryCodes: value }))} />
          <TextField label="States" placeholder="Maharashtra" value={coverage.states} onChange={(value) => setCoverage((current) => ({ ...current, states: value }))} />
          <TextField label="Cities" placeholder="Ahilyanagar, Shirdi" value={coverage.cities} onChange={(value) => setCoverage((current) => ({ ...current, cities: value }))} />
          <TextField label="Industries" placeholder="Dairy, Food processing" value={coverage.industries} onChange={(value) => setCoverage((current) => ({ ...current, industries: value }))} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!code.trim() || !name.trim()}>
            {territory ? "Save changes" : "Create territory"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TeamMembersDialog({
  team,
  onOpenChange,
  userOptions,
  onError,
}: {
  team: SalesTeam | null;
  onOpenChange: (open: boolean) => void;
  userOptions: SelectOption[];
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [userId, setUserId] = useState("");
  const [memberRole, setMemberRole] = useState("");
  const [allocationPercent, setAllocationPercent] = useState("100");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");

  const membersQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "sales-team-members", team?.id ?? ""),
    queryFn: () => listSalesTeamMembers(team!.id),
    enabled: Boolean(team),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "sales-team-members", team?.id ?? "") });
  }

  const addMutation = useMutation({
    mutationFn: () =>
      createSalesTeamMember({
        teamId: team!.id,
        userId,
        memberRole: memberRole || null,
        allocationPercent: allocationPercent ? Number(allocationPercent) : null,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
      }),
    onSuccess: () => {
      invalidate();
      setUserId("");
      setMemberRole("");
      setAllocationPercent("100");
      setEffectiveFrom("");
      setEffectiveTo("");
    },
    onError,
  });
  const endMutation = useMutation({
    mutationFn: (member: SalesTeamMember) => archiveSalesTeamMember(member.id, member.updatedAt),
    onSuccess: invalidate,
    onError,
  });

  const members = membersQuery.data?.rows ?? [];

  return (
    <Dialog isOpen={Boolean(team)} onOpenChange={onOpenChange} title={team ? `Members of ${team.name}` : "Members"}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {membersQuery.isLoading && <p className="text-sm text-text-secondary">Loading members…</p>}
          {!membersQuery.isLoading && members.length === 0 && <p className="text-sm text-text-muted">No members yet.</p>}
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
              <div className="flex flex-col text-sm">
                <span className="font-medium text-text">{userOptions.find((option) => option.value === member.userId)?.label ?? member.userId}</span>
                <span className="text-text-secondary">
                  {member.memberRole || "Member"} · {member.allocationPercent ?? 100}%
                  {member.effectiveFrom ? ` · from ${dateFormatter.format(new Date(member.effectiveFrom))}` : ""}
                  {member.effectiveTo ? ` · to ${dateFormatter.format(new Date(member.effectiveTo))}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={member.status === "active" ? "success" : "neutral"}>{member.status}</StatusBadge>
                {member.status === "active" && (
                  <IconButton aria-label="End membership" size="compact" variant="danger" onPress={() => endMutation.mutate(member)}>
                    <Archive className="size-4" aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-4">
          <Select label="Add member" options={userOptions} selectedKey={userId} onSelectionChange={(key) => setUserId(String(key ?? ""))} />
          <TextField label="Role" placeholder="e.g. rep, lead" value={memberRole} onChange={setMemberRole} />
          <TextField label="Allocation %" value={allocationPercent} onChange={setAllocationPercent} />
          <div className="flex gap-3">
            <TextField label="Effective from" placeholder="YYYY-MM-DD" value={effectiveFrom} onChange={setEffectiveFrom} />
            <TextField label="Effective to" placeholder="YYYY-MM-DD" value={effectiveTo} onChange={setEffectiveTo} />
          </div>
          <Button variant="secondary" size="compact" className="self-start" onPress={() => addMutation.mutate()} isLoading={addMutation.isPending} isDisabled={!userId}>
            Add member
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

function TerritoryAssignmentsDialog({
  territory,
  onOpenChange,
  userOptions,
  teamOptions,
  onError,
}: {
  territory: Territory | null;
  onOpenChange: (open: boolean) => void;
  userOptions: SelectOption[];
  teamOptions: SelectOption[];
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [assigneeType, setAssigneeType] = useState<"user" | "team">("user");
  const [assigneeId, setAssigneeId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("primary");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");

  const assignmentsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "territory-assignments", territory?.id ?? ""),
    queryFn: () => listTerritoryAssignments(territory!.id),
    enabled: Boolean(territory),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "territory-assignments", territory?.id ?? "") });
  }

  const assigneeOptions = assigneeType === "user" ? userOptions : teamOptions;

  const addMutation = useMutation({
    mutationFn: () =>
      createTerritoryAssignment({
        territoryId: territory!.id,
        assigneeType,
        assigneeId,
        assignmentRole,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        source: "manual",
      }),
    onSuccess: () => {
      invalidate();
      setAssigneeId("");
      setAssignmentRole("primary");
      setEffectiveFrom("");
      setEffectiveTo("");
    },
    onError,
  });
  // territory-assignments has no archive transition (purely effective-dated)
  // — "ending" coverage sets effectiveTo to today via the governed PATCH
  // path, never a DELETE (which this resource's registry entry has no
  // statusColumn/archiveStatuses mapping for and would reject).
  const endMutation = useMutation({
    mutationFn: (assignment: TerritoryAssignment) => endTerritoryAssignment(assignment.id, new Date().toISOString().slice(0, 10), assignment.updatedAt),
    onSuccess: invalidate,
    onError,
  });

  const assignments = assignmentsQuery.data?.rows ?? [];
  const isEnded = (assignment: TerritoryAssignment) => Boolean(assignment.effectiveTo && new Date(assignment.effectiveTo) <= new Date());

  return (
    <Dialog isOpen={Boolean(territory)} onOpenChange={onOpenChange} title={territory ? `Assignments for ${territory.name}` : "Assignments"}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {assignmentsQuery.isLoading && <p className="text-sm text-text-secondary">Loading assignments…</p>}
          {!assignmentsQuery.isLoading && assignments.length === 0 && <p className="text-sm text-text-muted">No coverage assigned yet.</p>}
          {assignments.map((assignment) => {
            const options = assignment.assigneeType === "user" ? userOptions : teamOptions;
            const ended = isEnded(assignment);
            return (
              <div key={assignment.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
                <div className="flex flex-col text-sm">
                  <span className="font-medium text-text">
                    {options.find((option) => option.value === assignment.assigneeId)?.label ?? assignment.assigneeId} ({assignment.assigneeType})
                  </span>
                  <span className="text-text-secondary">
                    {assignment.assignmentRole || "Coverage"}
                    {assignment.effectiveFrom ? ` · from ${dateFormatter.format(new Date(assignment.effectiveFrom))}` : ""}
                    {assignment.effectiveTo ? ` · to ${dateFormatter.format(new Date(assignment.effectiveTo))}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={ended ? "neutral" : "success"}>{ended ? "ended" : "active"}</StatusBadge>
                  {!ended && (
                    <IconButton aria-label="End assignment" size="compact" variant="danger" onPress={() => endMutation.mutate(assignment)}>
                      <Archive className="size-4" aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-4">
          <Select
            label="Assignee type"
            options={[{ value: "user", label: "User" }, { value: "team", label: "Team" }]}
            selectedKey={assigneeType}
            onSelectionChange={(key) => {
              setAssigneeType(key === "team" ? "team" : "user");
              setAssigneeId("");
            }}
          />
          <Select label="Assignee" options={assigneeOptions} selectedKey={assigneeId} onSelectionChange={(key) => setAssigneeId(String(key ?? ""))} />
          <Select label="Role" options={ASSIGNMENT_ROLE_OPTIONS} selectedKey={assignmentRole} onSelectionChange={(key) => setAssignmentRole(String(key ?? "primary"))} />
          <div className="flex gap-3">
            <TextField label="Effective from" placeholder="YYYY-MM-DD" value={effectiveFrom} onChange={setEffectiveFrom} />
            <TextField label="Effective to" placeholder="YYYY-MM-DD" value={effectiveTo} onChange={setEffectiveTo} />
          </div>
          <Button variant="secondary" size="compact" className="self-start" onPress={() => addMutation.mutate()} isLoading={addMutation.isPending} isDisabled={!assigneeId}>
            Add assignment
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

const QUOTA_TYPE_OPTIONS: SelectOption[] = [
  { value: "revenue", label: "Revenue" },
  { value: "bookings", label: "Bookings" },
  { value: "margin", label: "Margin" },
  { value: "quantity", label: "Quantity" },
  { value: "new_logo", label: "New logo" },
  { value: "activity", label: "Activity" },
];
const ASSIGNEE_KIND_OPTIONS: SelectOption[] = [
  { value: "team", label: "Team" },
  { value: "territory", label: "Territory" },
  { value: "user", label: "Individual" },
];

// F020 Stage A2 §8. quota-plans (tenant.crm_quota_plans) is a real,
// already-migrated resource (FK'd to team/territory/user, CHECK
// num_nonnulls(...)>=1) with zero frontend consumer before this pass —
// confirmed by grep. This is the setup/configuration half of "quotas"
// (F020-CAP-002); F025's own forecast-attainment work (Stage A2 §11)
// consumes these plans, it does not define them.
function QuotaPlanDialog({
  isOpen,
  onOpenChange,
  teamOptions,
  territoryOptions,
  userOptions,
  onSaved,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  teamOptions: SelectOption[];
  territoryOptions: SelectOption[];
  userOptions: SelectOption[];
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [assigneeKind, setAssigneeKind] = useState<"team" | "territory" | "user">("team");
  const [assigneeId, setAssigneeId] = useState("");
  const [quotaType, setQuotaType] = useState("revenue");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [targetAmount, setTargetAmount] = useState(0);
  const [stretchAmount, setStretchAmount] = useState<number | null>(null);

  const assigneeOptions = assigneeKind === "team" ? teamOptions : assigneeKind === "territory" ? territoryOptions : userOptions;

  const mutation = useMutation({
    mutationFn: () =>
      createQuotaPlan({
        name,
        teamId: assigneeKind === "team" ? assigneeId : null,
        territoryId: assigneeKind === "territory" ? assigneeId : null,
        userId: assigneeKind === "user" ? assigneeId : null,
        quotaType,
        periodStart,
        periodEnd,
        currencyCode: currencyCode || null,
        targetAmount,
        stretchAmount,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setName("");
      setAssigneeId("");
      setPeriodStart("");
      setPeriodEnd("");
      setTargetAmount(0);
      setStretchAmount(null);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New quota plan">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select
          label="Assigned to"
          options={ASSIGNEE_KIND_OPTIONS}
          selectedKey={assigneeKind}
          onSelectionChange={(key) => {
            setAssigneeKind((key as "team" | "territory" | "user") ?? "team");
            setAssigneeId("");
          }}
        />
        <Select label={assigneeKind === "team" ? "Team" : assigneeKind === "territory" ? "Territory" : "User"} options={assigneeOptions} selectedKey={assigneeId} onSelectionChange={(key) => setAssigneeId(String(key ?? ""))} />
        <Select label="Quota type" options={QUOTA_TYPE_OPTIONS} selectedKey={quotaType} onSelectionChange={(key) => setQuotaType(String(key ?? "revenue"))} />
        <div className="flex gap-3">
          <TextField label="Period start" isRequired placeholder="YYYY-MM-DD" value={periodStart} onChange={setPeriodStart} />
          <TextField label="Period end" isRequired placeholder="YYYY-MM-DD" value={periodEnd} onChange={setPeriodEnd} />
        </div>
        <TextField label="Currency code" placeholder="e.g. INR, USD" value={currencyCode} onChange={setCurrencyCode} />
        <div className="flex gap-3">
          <NumberField label="Target amount" minValue={0} value={targetAmount} onChange={setTargetAmount} />
          <NumberField label="Stretch amount (optional)" minValue={0} value={stretchAmount ?? 0} onChange={(value) => setStretchAmount(value || null)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={!name.trim() || !assigneeId || !periodStart || !periodEnd}
          >
            Create quota plan
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const TERRITORY_TYPE_OPTIONS = TERRITORY_TYPES.map((value) => ({ value, label: humanize(value) }));
const COVERAGE_FIELDS = ["countryCodes", "states", "cities", "industries"] as const;
type CoverageText = Record<(typeof COVERAGE_FIELDS)[number], string> & { sourceIds: string[] };

function coverageText(rules: TerritoryCoverage | null | undefined): CoverageText {
  return {
    countryCodes: (rules?.countryCodes ?? []).join(", "),
    states: (rules?.states ?? []).join(", "),
    cities: (rules?.cities ?? []).join(", "),
    industries: (rules?.industries ?? []).join(", "),
    sourceIds: rules?.sourceIds ?? [],
  };
}
function coverageFromText(text: CoverageText): TerritoryCoverage {
  const rules: TerritoryCoverage = {};
  for (const field of COVERAGE_FIELDS) {
    const values = text[field].split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length) rules[field] = values;
  }
  if (text.sourceIds.length) rules.sourceIds = text.sourceIds;
  return rules;
}
function describeCoverage(rules: TerritoryCoverage | null | undefined) {
  const parts = [...(rules?.cities ?? []), ...(rules?.states ?? []), ...(rules?.industries ?? [])];
  if (!parts.length && rules?.countryCodes?.length) parts.push(...rules.countryCodes);
  if (rules?.sourceIds?.length) parts.push(`${rules.sourceIds.length} lead source(s)`);
  return parts.length ? parts.join(", ") : "Named in rules only";
}

// F020: try a lead's details against every territory's coverage (the same
// match territory assignment rules use) before any lead arrives.
function TerritoryMatchCheck() {
  const [lead, setLead] = useState({ countryCode: "IN", state: "", city: "", industry: "" });
  const check = useMutation({ mutationFn: () => checkTerritoryMatch(lead) });
  const result = check.data?.match;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-border p-4">
      <div>
        <p className="text-sm font-medium text-text">Check a lead&apos;s territory</p>
        <p className="text-xs text-text-muted">Enter a lead&apos;s details to see which territory it would be routed to.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <TextField label="Country code" value={lead.countryCode} onChange={(value) => setLead((current) => ({ ...current, countryCode: value }))} />
        <TextField label="State" value={lead.state} onChange={(value) => setLead((current) => ({ ...current, state: value }))} />
        <TextField label="City" value={lead.city} onChange={(value) => setLead((current) => ({ ...current, city: value }))} />
        <TextField label="Industry" value={lead.industry} onChange={(value) => setLead((current) => ({ ...current, industry: value }))} />
      </div>
      <div>
        <Button variant="secondary" onPress={() => check.mutate()} isLoading={check.isPending}>
          Check territory
        </Button>
      </div>
      {check.isError && <p className="text-sm text-danger">{check.error instanceof SettingsApiError ? check.error.message : "The check could not be run."}</p>}
      {check.isSuccess && (
        <p className="text-sm text-text" role="status">
          {result
            ? `Routed to ${result.name} (matched on ${result.matchedOn.join(", ")}).${result.alternatives.length ? ` Also covered by ${result.alternatives.map((alt) => alt.name).join(", ")}, which ${result.alternatives.length === 1 ? "is" : "are"} less specific.` : ""}`
            : "No territory covers this lead. A territory rule skips it, and the next rule or the fallback owner takes it."}
        </p>
      )}
    </div>
  );
}
