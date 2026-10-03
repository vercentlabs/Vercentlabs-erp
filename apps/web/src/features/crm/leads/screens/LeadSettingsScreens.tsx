"use client";

// CRM setup for leads: the list of lead sources. Needs the CRM settings
// permission. Lead assignment has its own screen (LeadAssignmentSettingsScreen).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createLeadSource, errorMessage, listLeadSources, updateLeadSource, type LeadSource } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";

function useCanManage() {
  return useWorkspaceContext().permissions.includes(CRM_PERMISSIONS.settingsManage);
}

const NoAccess = () => <PermissionState title="You don't have access to CRM setup" description="Ask an administrator for the Manage CRM settings permission." />;

// ------------------------------------------------------------------ lead sources

export function LeadSourcesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = useCanManage();
  const key = scopedQueryKey(workspace, "crm", "lead-sources");
  const query = useQuery({ queryKey: key, queryFn: () => listLeadSources(true), enabled: canManage });
  const [editing, setEditing] = useState<LeadSource | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
  };
  const toggle = useMutation({
    mutationFn: (source: LeadSource) => updateLeadSource(source.id, { isActive: !source.isActive }),
    onSuccess: () => { setError(null); refresh(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];

  const columns = useMemo<ColumnDef<LeadSource, unknown>[]>(() => [
    { id: "name", header: "Source", accessorKey: "name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "description", header: "Description", accessorKey: "description", cell: ({ row }) => row.original.description ?? "" },
    { id: "leadCount", header: "Leads", accessorKey: "leadCount", cell: ({ row }) => <span className="tabular-nums">{row.original.leadCount ?? 0}</span> },
    { id: "state", header: "State", accessorKey: "isActive", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ], []);

  if (!canManage) return <NoAccess />;
  return (
    <div className="flex flex-col gap-4">
      <ErrorBanner message={error} />
      <EnterpriseListPage
        header={{
          title: "Lead sources",
          description: "Where leads come from. A source in use is never deleted; deactivate it to stop offering it on new leads.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New source</Button>,
        }}
      >
        <EnterpriseDataGrid<LeadSource>
          aria-label="Lead sources"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "lead sources", { title: "No lead sources", description: "Add the channels your leads come from." })}
          rowActions={(row) => (
            <span className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="compact" onPress={() => setEditing(row)}>Edit</Button>
              <Button variant="ghost" size="compact" onPress={() => toggle.mutate(row)} isDisabled={toggle.isPending}>{row.isActive ? "Deactivate" : "Activate"}</Button>
            </span>
          )}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{row.name}</span>
                  {row.description && <span className="text-sm text-text-secondary">{row.description}</span>}
                  <span className="text-xs text-text-muted">{row.leadCount ?? 0} {row.leadCount === 1 ? "lead" : "leads"}</span>
                </div>
                <StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="compact" onPress={() => setEditing(row)}>Edit</Button>
                <Button variant="secondary" size="compact" onPress={() => toggle.mutate(row)} isDisabled={toggle.isPending}>{row.isActive ? "Deactivate" : "Activate"}</Button>
              </div>
            </div>
          )}
        />
      </EnterpriseListPage>
      {editing && <SourceDialog source={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function SourceDialog({ source, onClose, onSaved }: { source: LeadSource | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(source?.name ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => (source ? updateLeadSource(source.id, { name, description }) : createLeadSource({ name, description })),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={source ? "Edit lead source" : "New lead source"}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextField label="Description" value={description} onChange={setDescription} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>{source ? "Save" : "Create source"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
