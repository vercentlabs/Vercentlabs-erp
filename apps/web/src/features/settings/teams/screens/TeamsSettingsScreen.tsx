"use client";

// CRM › Setup › Teams (/crm/settings/team): the teams people belong to. Lead assignment routes to teams (round robin, team queues) and
// team managers see their team's records. A company with Sales and no CRM keeps it at Settings › Teams (/settings/teams); with CRM on,
// that address moves here.
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Users } from "lucide-react";
import { Button, EnterpriseDataGrid, EnterpriseListPage, PermissionState, StatusBadge, type SelectOption } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { useApp } from "@/shell/workspace-context/useApp";
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
  // CRM's "manage teams", or Sales' "manage settings" for a company with Sales and no CRM (Sales audit B10).
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(CRM_PERMISSIONS.teamsManage)
    || workspace.permissions.includes("sales.settings.manage");
  const crmOn = useApp("crm");
  const router = useRouter();
  const pathname = usePathname();
  const inCrm = pathname.startsWith("/crm/");
  // With CRM on, teams are part of CRM Setup: the old Settings address moves there.
  useEffect(() => {
    if (crmOn && !inCrm) router.replace("/crm/settings/team");
  }, [crmOn, inCrm, router]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SalesTeam | null>(null);
  const [membersTeam, setMembersTeam] = useState<SalesTeam | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams"), queryFn: listSalesTeams, enabled: canManage });
  // The people (and pipelines) come from CRM; without CRM, the people come from Sales.
  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, crmOn ? "crm" : "sales", "team-options"),
    queryFn: async () => (crmOn ? getCrmOptions() : getSalesOptions().then((r) => ({ options: { users: r.options.users.map((user) => ({ id: user.id, fullName: user.full_name })), pipelines: [] } }) as unknown as Awaited<ReturnType<typeof getCrmOptions>>)),
    enabled: canManage,
  });
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

  const personName = useMemo(() => new Map(people.map((row) => [String(row.id), String(row.fullName || row.name || "")])), [people]);
  const columns: ColumnDef<SalesTeam, unknown>[] = useMemo(() => [
    {
      id: "name", header: "Team", accessorKey: "name",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-text">{row.original.name}</span>
          <span className="text-xs text-text-muted">{row.original.code}</span>
        </span>
      ),
    },
    { id: "manager", header: "Manager", accessorFn: (row) => (row.managerUserId ? personName.get(row.managerUserId) || "—" : "No manager") },
    { id: "parentTeamId", header: "Parent team", accessorFn: (row) => (row.parentTeamId ? teamNameById.get(row.parentTeamId) || "—" : "—") },
    {
      id: "status", header: "Status", accessorKey: "status",
      cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{getValue() === "active" ? "Active" : "Inactive"}</StatusBadge>,
    },
    { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
  ], [teamNameById, personName]);

  if (!canManage) return <PermissionState title="You don't have access to teams" description="Ask an administrator for the Manage teams permission." />;

  return (
    <div className="flex flex-col gap-4">
      {inCrm && <SetupBackLink />}
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
          onRowClick={(row) => setEditing(row)}
          rowActions={(row) => (
            // Members is the everyday action; Edit and Archive (asked first) wait under More.
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-2">
              <Button aria-label={`Members of ${row.name}`} size="compact" variant="outline" onPress={() => setMembersTeam(row)}><Users className="size-4" aria-hidden="true" /><span>Members</span></Button>
              <MoreMenu label={`More actions for ${row.name}`} items={[
                { id: "edit", label: "Edit team", onAction: () => setEditing(row) },
                ...(row.status === "active" ? [{ id: "archive", label: "Archive team", danger: true, onAction: () => archive.mutate(row),
                  confirm: { title: `Archive ${row.name}?`, description: "The team stops receiving leads and disappears from the pickers. Its records keep their history.", confirmLabel: "Archive team" } }] : []),
              ]} />
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
