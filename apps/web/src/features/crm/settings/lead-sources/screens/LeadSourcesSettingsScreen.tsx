"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, Power } from "lucide-react";
import {
  Button,
  Checkbox,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  NumberField,
  PermissionState,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { getCrmDashboardData } from "@/features/crm/dashboard/api/dashboard-api";
import { humanize } from "@/features/crm/shared/human";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  createLeadSource,
  LeadSourceApiError,
  listLeadSources,
  setLeadSourceActive,
  updateLeadSource,
} from "../api/lead-sources-api";
import { LEAD_SOURCE_CHANNELS, type LeadSource } from "../types";


const CHANNEL_OPTIONS: SelectOption[] = LEAD_SOURCE_CHANNELS.map((value) => ({
  value,
  label: value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
}));

// F004 Lead Sources — a governed setup screen against the dedicated
// lead-source-operations.js module (not the generic resource boundary,
// which redirects "sources" mutations here). Real default-source
// uniqueness, sort order and lead-count-in-use projection all come from
// that module; nothing re-derived client-side.
export function LeadSourcesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<LeadSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "lead-sources"), queryFn: listLeadSources });
  const rows = query.data?.rows ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-sources") });
  }
  function handleError(err: unknown) {
    setError(err instanceof LeadSourceApiError ? err.message : "This action could not be completed.");
    if (err instanceof LeadSourceApiError && err.code === "CRM_STALE_WRITE") invalidate();
  }

  const toggleActiveMutation = useMutation({
    mutationFn: (source: LeadSource) => setLeadSourceActive(source.id, source.status !== "active", source.updatedAt),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  // How each source performs comes from the dashboard's own aggregation, matched by source name.
  const statsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "dashboard"), queryFn: () => getCrmDashboardData() });
  const statsByName = useMemo(() => new Map((statsQuery.data?.dashboard.sources ?? []).map((row) => [row.name, row])), [statsQuery.data]);

  const columns: ColumnDef<LeadSource, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Source",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="flex items-center gap-2 font-medium text-text">
            {row.original.name}
            {row.original.isDefault && <StatusBadge tone="info">Default</StatusBadge>}
          </span>
        ),
      },
      { id: "channel", header: "Channel", accessorFn: (row) => (row.channel ? humanize(row.channel) : "Not set") },
      { id: "leadCount", header: "Leads", accessorFn: (row) => row.leadCount },
      { id: "converted", header: "Converted", accessorFn: (row) => statsByName.get(row.name)?.convertedCount ?? "", cell: ({ row }) => { const st = statsByName.get(row.original.name); return st ? <span className="tabular-nums">{st.convertedCount}</span> : <span className="text-text-muted">{statsQuery.isLoading ? "…" : "None yet"}</span>; } },
      { id: "conversion", header: "Conversion", accessorFn: (row) => { const st = statsByName.get(row.name); return st && st.leadCount > 0 ? Math.round((st.convertedCount / st.leadCount) * 100) : ""; }, cell: ({ row }) => { const st = statsByName.get(row.original.name); return st && st.leadCount > 0 ? <span className="tabular-nums">{Math.round((st.convertedCount / st.leadCount) * 100)}%</span> : <span className="text-text-muted">No leads</span>; } },
      {
        id: "status",
        header: "State",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{getValue() === "active" ? "Active" : "Inactive"}</StatusBadge>,
      },
    ],
    [statsByName, statsQuery.isLoading],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Lead sources",
          description: "Where leads come from and how well each source converts. The default source is used when a lead has none.",
          primaryAction: (
            <Button variant="primary" onPress={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New source
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<LeadSource>
          aria-label="Lead sources"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "lead sources", { title: "No lead sources yet", description: "A source says where a lead came from, such as Website, Referral or Trade show. Sources let you see which channels bring in customers." })}
          rowActions={(row) => (
            <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
              <IconButton aria-label={`Edit ${row.name}`} size="compact" variant="ghost" onPress={() => setEditingSource(row)}>
                <Pencil className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={row.status === "active" ? `Deactivate ${row.name}` : `Activate ${row.name}`}
                size="compact"
                variant={row.status === "active" ? "danger" : "ghost"}
                onPress={() => toggleActiveMutation.mutate(row)}
                isDisabled={toggleActiveMutation.isPending}
              >
                <Power className="size-4" aria-hidden="true" />
              </IconButton>
            </span>
          )}
        />
      </EnterpriseListPage>

      <CreateLeadSourceDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={invalidate} onError={handleError} />
      <EditLeadSourceDialog source={editingSource} onOpenChange={(open) => !open && setEditingSource(null)} onSaved={invalidate} />
    </div>
  );
}

function CreateLeadSourceDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createLeadSource({ name, channel: channel || undefined, isDefault }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setChannel("");
      setIsDefault(false);
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New lead source">
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Channel" options={CHANNEL_OPTIONS} selectedKey={channel} onSelectionChange={(key) => setChannel(String(key ?? ""))} />
        <Checkbox isSelected={isDefault} onChange={setIsDefault}>Make this the default source</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Create source
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// F004 gap-closure — updateCrmLeadSource / the PATCH /api/crm/lead-sources/[id]
// endpoint / updateLeadSource client function all already existed, fully
// governed (optimistic concurrency, is_system/status/code left immutable
// server-side) — this screen just never called any of it. Only Create and
// Activate/Deactivate existed before this pass.
function EditLeadSourceDialog({
  source,
  onOpenChange,
  onSaved,
}: {
  source: LeadSource | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState("");
  const [sortOrder, setSortOrder] = useState(100);
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the draft from whichever source was just opened for editing — the
  // render-time "adjust state on prop change" pattern (not an effect), same
  // convention AccountPlanPanel.tsx uses for the same reason: it can't
  // cause a stale-then-correct flash the way a useEffect-driven update can.
  const [seededFor, setSeededFor] = useState<LeadSource | null>(null);
  if (source && source !== seededFor) {
    setSeededFor(source);
    setName(source.name);
    setDescription(source.description ?? "");
    setChannel(source.channel ?? "");
    setSortOrder(source.sortOrder ?? 100);
    setIsDefault(source.isDefault);
    setError(null);
  }

  const mutation = useMutation({
    mutationFn: () =>
      updateLeadSource(
        source!.id,
        { name, description: description || null, channel: channel || undefined, sortOrder, isDefault },
        source!.updatedAt,
      ),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(err instanceof LeadSourceApiError ? err.message : "This action could not be completed."),
  });

  return (
    <Dialog isOpen={Boolean(source)} onOpenChange={onOpenChange} title={source ? `Edit ${source.name}` : "Edit source"}>
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <Select label="Channel" options={CHANNEL_OPTIONS} selectedKey={channel} onSelectionChange={(key) => setChannel(String(key ?? ""))} />
        <NumberField label="Display order" value={sortOrder} onChange={setSortOrder} minValue={0} maxValue={10000} />
        <Checkbox isSelected={isDefault} onChange={setIsDefault}>Make this the default source</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
