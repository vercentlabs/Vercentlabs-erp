"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Power, Star } from "lucide-react";
import {
  Button,
  Checkbox,
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
import {
  createLeadSource,
  LeadSourceApiError,
  listLeadSources,
  setLeadSourceActive,
} from "../api/lead-sources-api";
import { LEAD_SOURCE_CHANNELS, type LeadSource } from "../types";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

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

  const columns: ColumnDef<LeadSource, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 font-medium text-text">
            {row.original.isDefault && <Star className="size-3.5 fill-warning text-warning" aria-label="Default" />}
            {row.original.name}
          </span>
        ),
      },
      { id: "channel", header: "Channel", accessorFn: (row) => (row.channel ? row.channel.replace(/_/g, " ") : "—") },
      { id: "leadCount", header: "Leads", accessorFn: (row) => row.leadCount },
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
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Lead sources",
          description: "Where leads come from. The default source is used when none is specified.",
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
          state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
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
