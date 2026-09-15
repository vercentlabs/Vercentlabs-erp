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
  PermissionState,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  archiveSalesTeam,
  archiveSalesTeamMember,
  archiveTerritory,
  createSalesTeam,
  createSalesTeamMember,
  createTerritory,
  createTerritoryAssignment,
  endTerritoryAssignment,
  listSalesTeamMembers,
  listSalesTeams,
  listTerritories,
  listTerritoryAssignments,
  SettingsApiError,
  updateSalesTeam,
  updateTerritory,
} from "../api/territories-api";
import type { SalesTeam, SalesTeamMember, Territory, TerritoryAssignment } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// F020 Territories & Sales Teams — a governed setup screen, not frontend
// constants. All four resources reuse the generic /api/crm/[resource]
// boundary (crm.settings.manage). Hierarchy (parentTeamId/parentTerritoryId)
// is server-cycle-guarded (resource-mutation-service.js); membership/
// assignment lists are server-scoped by teamId/territoryId (Tranche D —
// buildFilters had no such key before this pass, which would otherwise
// have leaked every team's/territory's rows into one dialog).
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
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams"), queryFn: listSalesTeams });
  const territoriesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "territories"), queryFn: listTerritories });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });

  const teams = useMemo(() => teamsQuery.data?.rows ?? [], [teamsQuery.data]);
  const territories = useMemo(() => territoriesQuery.data?.rows ?? [], [territoriesQuery.data]);
  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const territoryNameById = useMemo(() => new Map(territories.map((territory) => [territory.id, territory.name])), [territories]);

  const managerOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "No manager" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);
  const userOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }));
  }, [optionsQuery.data]);
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
      { id: "territoryType", header: "Type", accessorFn: (row) => row.territoryType || "—" },
      { id: "parentTerritoryId", header: "Parent territory", accessorFn: (row) => (row.parentTerritoryId ? territoryNameById.get(row.parentTerritoryId) || "—" : "—") },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [territoryNameById],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-8">
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
            <Button variant="primary" onPress={() => setTeamDialogOpen(true)}>
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
          state={teamsQuery.isLoading ? "loading" : teams.length === 0 ? "empty" : "ready"}
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
          description: "Coverage boundaries used for assignment routing.",
          primaryAction: (
            <Button variant="primary" onPress={() => setTerritoryDialogOpen(true)}>
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
          state={territoriesQuery.isLoading ? "loading" : territories.length === 0 ? "empty" : "ready"}
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
  const [assignmentRulesText, setAssignmentRulesText] = useState(territory?.assignmentRules ? JSON.stringify(territory.assignmentRules, null, 2) : "");
  const [rulesError, setRulesError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<Territory | null | undefined>(undefined);
  if (isOpen && territory !== seededFor) {
    setSeededFor(territory);
    setCode(territory?.code ?? "");
    setName(territory?.name ?? "");
    setTerritoryType(territory?.territoryType ?? "");
    setManagerUserId(territory?.managerUserId ?? "");
    setParentTerritoryId(territory?.parentTerritoryId ?? "");
    setAssignmentRulesText(territory?.assignmentRules ? JSON.stringify(territory.assignmentRules, null, 2) : "");
    setRulesError(null);
  }

  const mutation = useMutation({
    mutationFn: () => {
      let assignmentRules: Record<string, unknown> | null = null;
      if (assignmentRulesText.trim()) {
        try {
          assignmentRules = JSON.parse(assignmentRulesText);
        } catch {
          throw new Error("Assignment rules must be valid JSON.");
        }
      }
      const input = {
        code,
        name,
        territoryType: territoryType || null,
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
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === "Assignment rules must be valid JSON.") {
        setRulesError(err.message);
        return;
      }
      onError(err);
    },
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={territory ? `Edit ${territory.name}` : "New territory"}>
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Type" placeholder="e.g. geography, industry" value={territoryType} onChange={setTerritoryType} />
        <Select label="Parent territory" options={parentTerritoryOptions} selectedKey={parentTerritoryId} onSelectionChange={(key) => setParentTerritoryId(String(key ?? ""))} />
        <Select label="Manager" options={managerOptions} selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key ?? ""))} />
        <TextArea
          label="Assignment rules (JSON)"
          description="Stored as opaque coverage-routing data; no automated matching engine reads this yet."
          value={assignmentRulesText}
          onChange={(value) => {
            setAssignmentRulesText(value);
            setRulesError(null);
          }}
          errorMessage={rulesError ?? undefined}
        />
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
  const [assignmentRole, setAssignmentRole] = useState("");
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
        assignmentRole: assignmentRole || null,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        source: "manual",
      }),
    onSuccess: () => {
      invalidate();
      setAssigneeId("");
      setAssignmentRole("");
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
          <TextField label="Role" placeholder="e.g. primary, backup" value={assignmentRole} onChange={setAssignmentRole} />
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
