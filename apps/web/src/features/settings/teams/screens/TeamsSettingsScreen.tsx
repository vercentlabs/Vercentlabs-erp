"use client";

// Settings → People and access → Teams: the teams people belong to. Lead
// assignment routes to teams (round robin, team queues) and team managers
// see their team's records. Shared across modules, so it lives in Settings
// rather than CRM Settings.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Pencil, Plus, Users } from "lucide-react";
import { Button, EnterpriseDataGrid, EnterpriseListPage, IconButton, PermissionState, StatusBadge, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

import { archiveSalesTeam, listSalesTeams, SettingsApiError } from "../api/teams-api";
import { TeamDialog } from "../components/TeamDialog";
import { TeamMembersDialog } from "../components/TeamMembersDialog";
import type { SalesTeam } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

export function TeamsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(CRM_PERMISSIONS.teamsManage);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SalesTeam | null>(null);
  const [membersTeam, setMembersTeam] = useState<SalesTeam | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams"), queryFn: listSalesTeams, enabled: canManage });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions, enabled: canManage });
  const teams = useMemo(() => teamsQuery.data?.rows ?? [], [teamsQuery.data]);
  const teamNameById = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const people = useMemo(() => optionsQuery.data?.options?.members ?? optionsQuery.data?.options?.users ?? [], [optionsQuery.data]);
  const userOptions: SelectOption[] = useMemo(() => people.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) })), [people]);
  const managerOptions: SelectOption[] = useMemo(() => [{ value: "", label: "No manager" }, ...userOptions], [userOptions]);
  const pipelineOptions: SelectOption[] = useMemo(
    () => [{ value: "", label: "No default pipeline" }, ...(optionsQuery.data?.options?.pipelines ?? []).map((row) => ({ value: String(row.id), label: String(row.name || row.id) }))],
    [optionsQuery.data],
  );
  const parentTeamOptions = (excludeId?: string): SelectOption[] => [
    { value: "", label: "No parent team" },
    ...teams.filter((team) => team.id !== excludeId).map((team) => ({ value: team.id, label: team.name })),
  ];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams") });
  function handleError(failure: unknown) {
    setError(failure instanceof SettingsApiError ? failure.message : "This action could not be completed.");
    if (failure instanceof SettingsApiError && failure.code === "CRM_STALE_WRITE") void invalidate();
  }
  const archive = useMutation({ mutationFn: (team: SalesTeam) => archiveSalesTeam(team.id, team.updatedAt), onSuccess: invalidate, onError: handleError });

  const columns: ColumnDef<SalesTeam, unknown>[] = useMemo(() => [
    { id: "code", header: "Code", accessorKey: "code" },
    { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
    { id: "parentTeamId", header: "Parent team", accessorFn: (row) => (row.parentTeamId ? teamNameById.get(row.parentTeamId) || "—" : "—") },
    {
      id: "status", header: "Status", accessorKey: "status",
      cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{getValue() === "active" ? "Active" : "Inactive"}</StatusBadge>,
    },
    { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
  ], [teamNameById]);

  if (!canManage) return <PermissionState title="You don't have access to teams" description="Ask an administrator for the Manage teams permission." />;

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <EnterpriseListPage
        header={{
          title: "Teams",
          description: "Teams group people for lead assignment (round robin and team queues) and let a team's manager see the team's records.",
          primaryAction: (
            <Button variant="primary" isDisabled={!optionsQuery.isSuccess} onPress={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />New team
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<SalesTeam>
          aria-label="Teams"
          columns={columns}
          data={teams}
          getRowId={(row) => row.id}
          {...gridStates(teamsQuery, teams.length, "teams", { title: "No teams yet", description: "Create a team, then add its members." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Edit ${row.name}`} size="compact" variant="outline" onPress={() => setEditing(row)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
              <IconButton aria-label={`Manage members of ${row.name}`} size="compact" variant="outline" onPress={() => setMembersTeam(row)}><Users className="size-4" aria-hidden="true" /></IconButton>
              {row.status === "active" && (
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archive.mutate(row)}><Archive className="size-4" aria-hidden="true" /></IconButton>
              )}
            </span>
          )}
        />
      </EnterpriseListPage>
      <TeamDialog
        isOpen={creating || Boolean(editing)}
        onOpenChange={(open) => { if (!open) { setCreating(false); setEditing(null); } }}
        team={editing}
        managerOptions={managerOptions}
        pipelineOptions={pipelineOptions}
        parentTeamOptions={parentTeamOptions(editing?.id)}
        onSaved={invalidate}
        onError={handleError}
      />
      <TeamMembersDialog team={membersTeam} onOpenChange={(open) => !open && setMembersTeam(null)} userOptions={userOptions} onError={handleError} />
    </div>
  );
}
