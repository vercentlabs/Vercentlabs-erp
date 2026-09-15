"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import {
  archiveSalesTeam,
  archiveTerritory,
  createSalesTeam,
  createTerritory,
  listSalesTeams,
  listTerritories,
  SettingsApiError,
} from "../api/territories-api";
import type { SalesTeam, Territory } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// F020 Territories & Sales Teams — a governed setup screen, not frontend
// constants. Both resources reuse the generic /api/crm/[resource]
// boundary (crm.settings.manage, extended into that route's permission
// map this same pass — see resource-permissions.ts).
export function SalesOrganizationSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [territoryDialogOpen, setTerritoryDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "sales-teams"), queryFn: listSalesTeams });
  const territoriesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "territories"), queryFn: listTerritories });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });

  const managerOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "", label: "No manager" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

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
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [],
  );

  const territoryColumns: ColumnDef<Territory, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "territoryType", header: "Type", accessorFn: (row) => row.territoryType || "—" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{String(getValue())}</StatusBadge>,
      },
      { id: "updatedAt", header: "Updated", accessorFn: (row) => dateFormatter.format(new Date(row.updatedAt)) },
    ],
    [],
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
          data={teamsQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          state={teamsQuery.isLoading ? "loading" : (teamsQuery.data?.rows.length ?? 0) === 0 ? "empty" : "ready"}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archiveTeamMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
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
          data={territoriesQuery.data?.rows ?? []}
          getRowId={(row) => row.id}
          state={territoriesQuery.isLoading ? "loading" : (territoriesQuery.data?.rows.length ?? 0) === 0 ? "empty" : "ready"}
          rowActions={(row) =>
            row.status === "active" ? (
              <span onClick={(event) => event.stopPropagation()}>
                <IconButton aria-label={`Archive ${row.name}`} size="compact" variant="danger" onPress={() => archiveTerritoryMutation.mutate(row)}>
                  <Archive className="size-4" aria-hidden="true" />
                </IconButton>
              </span>
            ) : null
          }
        />
      </EnterpriseListPage>

      <TeamDialog isOpen={teamDialogOpen} onOpenChange={setTeamDialogOpen} managerOptions={managerOptions} onCreated={invalidateTeams} onError={handleError} />
      <TerritoryDialog isOpen={territoryDialogOpen} onOpenChange={setTerritoryDialogOpen} managerOptions={managerOptions} onCreated={invalidateTerritories} onError={handleError} />
    </div>
  );
}

function TeamDialog({
  isOpen,
  onOpenChange,
  managerOptions,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  managerOptions: SelectOption[];
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [managerUserId, setManagerUserId] = useState("");

  const mutation = useMutation({
    mutationFn: () => createSalesTeam({ code, name, managerUserId: managerUserId || null }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setCode("");
      setName("");
      setManagerUserId("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New sales team">
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Manager" options={managerOptions} selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key ?? ""))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!code.trim() || !name.trim()}>
            Create team
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TerritoryDialog({
  isOpen,
  onOpenChange,
  managerOptions,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  managerOptions: SelectOption[];
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [territoryType, setTerritoryType] = useState("");
  const [managerUserId, setManagerUserId] = useState("");

  const mutation = useMutation({
    mutationFn: () => createTerritory({ code, name, territoryType: territoryType || null, managerUserId: managerUserId || null }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setCode("");
      setName("");
      setTerritoryType("");
      setManagerUserId("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New territory">
      <div className="flex flex-col gap-4">
        <TextField label="Code" isRequired value={code} onChange={setCode} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Type" placeholder="e.g. geography, industry" value={territoryType} onChange={setTerritoryType} />
        <Select label="Manager" options={managerOptions} selectedKey={managerUserId} onSelectionChange={(key) => setManagerUserId(String(key ?? ""))} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!code.trim() || !name.trim()}>
            Create territory
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
