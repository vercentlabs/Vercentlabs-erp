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
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { createLeadSource, errorMessage, listLeadSources, updateLeadSource, type LeadSource } from "../api/leads-api";
import { ErrorBanner } from "../lead-format";
import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";

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
  const all = useMemo(() => query.data ?? [], [query.data]);
  const [show, setShow] = useState<"active" | "inactive" | "all">("all");
  const rows = all.filter((row) => show === "all" || (show === "active") === row.isActive);
  const activeCount = all.filter((row) => row.isActive).length;
  const leadTotal = all.reduce((sum, row) => sum + (row.leadCount ?? 0), 0);
  const busiest = Math.max(1, ...all.map((row) => row.leadCount ?? 0));
  const actions = (row: LeadSource) => [
    { id: "edit", label: "Edit source", onAction: () => setEditing(row) },
    { id: "active", label: row.isActive ? "Deactivate" : "Activate", isDisabled: toggle.isPending, onAction: () => toggle.mutate(row) },
  ];

  const columns = useMemo<ColumnDef<LeadSource, unknown>[]>(() => [
    {
      id: "name", header: "Source", accessorKey: "name",
      cell: ({ row }) => (
        <span className={`flex min-w-0 flex-col ${row.original.isActive ? "" : "opacity-60"}`}>
          <span className="truncate font-medium text-text">{row.original.name}</span>
          {row.original.description && <span className="truncate text-xs text-text-secondary">{row.original.description}</span>}
        </span>
      ),
    },
    {
      id: "leadCount", header: "Leads", accessorKey: "leadCount",
      // The count, with a bar against the busiest source.
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <span className="w-8 text-right tabular-nums text-text">{row.original.leadCount ?? 0}</span>
          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(((row.original.leadCount ?? 0) / busiest) * 100)}%` }} />
          </span>
        </span>
      ),
    },
    { id: "state", header: "Status", accessorKey: "isActive", cell: ({ row }) => <StatusBadge tone={row.original.isActive ? "success" : "neutral"}>{row.original.isActive ? "Active" : "Inactive"}</StatusBadge> },
  ], [busiest]);

  if (!canManage) return <NoAccess />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      <ErrorBanner message={error} />
      <EnterpriseListPage
        header={{
          title: "Lead sources",
          description: "Where leads come from. A source in use is never deleted; deactivate it to stop offering it on new leads.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New source</Button>,
        }}
        actionBar={{
          start: query.isSuccess ? (
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text">{`${all.length} ${all.length === 1 ? "source" : "sources"}`}</span>{` · ${activeCount} active · ${leadTotal} ${leadTotal === 1 ? "lead" : "leads"}`}
            </p>
          ) : undefined,
          end: <ViewToggle label="Show" value={show} onChange={(id) => setShow(id as typeof show)}
            options={[{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "inactive", label: "Inactive" }]} />,
        }}
      >
        <EnterpriseDataGrid<LeadSource>
          aria-label="Lead sources"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "lead sources", { title: "No lead sources", description: "Add the channels your leads come from." })}
          onRowClick={(row) => setEditing(row)}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <MoreMenu label={`Actions for ${row.name}`} items={actions(row)} />
            </span>
          )}
          // One compact row per source on a phone: name and use on the left, its actions in a menu.
          renderMobileCard={(row) => (
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{row.name}</span>
                {row.description && <span className="line-clamp-2 text-sm text-text-secondary">{row.description}</span>}
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <span className={`size-1.5 shrink-0 rounded-full ${row.isActive ? "bg-success" : "bg-border-strong"}`} aria-hidden="true" />
                  {row.isActive ? "Active" : "Inactive"} · {row.leadCount ?? 0} {row.leadCount === 1 ? "lead" : "leads"}
                </span>
                <span className="mt-1 h-1 w-full max-w-40 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(((row.leadCount ?? 0) / busiest) * 100)}%` }} />
                </span>
              </div>
              <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
                <MoreMenu label={`Actions for ${row.name}`} items={actions(row)} />
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
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={source ? "Edit lead source" : "New lead source"}
      description="Where a lead came from. It is chosen on the lead and used in assignment rules, scoring and reports."
      footer={<>
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>{source ? "Save changes" : "Create source"}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <ErrorBanner message={error} />
        <TextField label="Name" isRequired value={name} onChange={setName} placeholder="For example: IndiaMART" />
        <TextField label="Description" value={description} onChange={setDescription} description="Optional. Shown under the name in this list." />
      </div>
    </Dialog>
  );
}
