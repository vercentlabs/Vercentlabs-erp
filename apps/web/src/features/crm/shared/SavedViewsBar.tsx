"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, IconButton, SavedViewBar, TextField, type SavedView } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { createSavedView, deleteSavedView, listSavedViews, SavedViewApiError, type CrmSavedView } from "./saved-views-api";

const ALL_VIEW_ID = "__all__";

// F009/Tranche 9 — reusable across every list screen (currently composed
// into Leads and Opportunities; not yet Accounts/Contacts/Tasks/Calls/
// Meetings/Follow-ups/Communications, a disclosed, deliberate scope
// boundary — see the register). Wraps design-system's SavedViewBar (pure
// selection UI) with real create/delete against the generic
// tenant.crm_saved_views resource; a saved view marked isDefault is
// auto-applied once, on first load, only when the caller hasn't already
// navigated in with explicit filters (never overrides an explicit URL).
export function SavedViewsBar<TFilters extends Record<string, unknown>>({
  resource,
  baseFilters,
  currentFilters,
  hasExplicitFilters,
  onApply,
}: {
  resource: string;
  baseFilters: TFilters;
  currentFilters: TFilters;
  hasExplicitFilters: boolean;
  onApply: (filters: TFilters) => void;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [activeViewId, setActiveViewId] = useState(ALL_VIEW_ID);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [appliedDefault, setAppliedDefault] = useState(false);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "saved-views", resource),
    queryFn: () => listSavedViews(resource),
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  // Adjusting state while rendering (React's own sanctioned alternative to
  // an effect for "run once when data the effect would have waited on
  // arrives") rather than a useEffect that calls setState synchronously —
  // appliedDefault guards this to exactly one state adjustment.
  if (!appliedDefault && !hasExplicitFilters && rows.length > 0) {
    const defaultView = rows.find((row) => row.isDefault);
    setAppliedDefault(true);
    if (defaultView) {
      setActiveViewId(defaultView.id);
      onApply({ ...baseFilters, ...(defaultView.filters as Partial<TFilters>) });
    }
  }

  const views: SavedView[] = useMemo(
    () => [{ id: ALL_VIEW_ID, label: "All" }, ...rows.map((row) => ({ id: row.id, label: row.name }))],
    [rows],
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "saved-views", resource) });
  }

  function selectView(id: string) {
    setActiveViewId(id);
    if (id === ALL_VIEW_ID) {
      onApply(baseFilters);
      return;
    }
    const view = rows.find((row) => row.id === id);
    if (view) onApply({ ...baseFilters, ...(view.filters as Partial<TFilters>) });
  }

  const deleteMutation = useMutation({
    mutationFn: (view: CrmSavedView) => deleteSavedView(view.id, view.updatedAt),
    onSuccess: (_, view) => {
      invalidate();
      if (activeViewId === view.id) selectView(ALL_VIEW_ID);
    },
  });

  return (
    <div className="flex items-center gap-2">
      <SavedViewBar views={views} activeViewId={activeViewId} onSelect={selectView} onCreateView={() => setCreateOpen(true)} />
      {rows.length > 0 && (
        <button type="button" onClick={() => setManageOpen(true)} className="shrink-0 text-xs font-medium text-text-secondary hover:text-text hover:underline">
          Manage
        </button>
      )}

      <CreateSavedViewDialog
        isOpen={createOpen}
        onOpenChange={setCreateOpen}
        resource={resource}
        filters={currentFilters}
        onCreated={(view) => {
          invalidate();
          setActiveViewId(view.id);
        }}
      />

      <Dialog isOpen={manageOpen} onOpenChange={setManageOpen} title="Manage saved views">
        <div className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm text-text">
                {row.name}
                {row.isDefault && <span className="ml-1.5 text-xs text-text-muted">(default)</span>}
              </span>
              <IconButton aria-label={`Delete ${row.name}`} size="compact" variant="danger" onPress={() => deleteMutation.mutate(row)} isDisabled={deleteMutation.isPending}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
          {rows.length === 0 && <p className="py-2 text-sm text-text-muted">No saved views yet.</p>}
        </div>
      </Dialog>
    </div>
  );
}

function CreateSavedViewDialog<TFilters extends Record<string, unknown>>({
  isOpen,
  onOpenChange,
  resource,
  filters,
  onCreated,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  resource: string;
  filters: TFilters;
  onCreated: (view: CrmSavedView) => void;
}) {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => createSavedView({ resource, name, filters: { ...filters }, isDefault }),
    onSuccess: ({ record }) => {
      onCreated(record);
      onOpenChange(false);
      setName("");
      setIsDefault(false);
      setError(null);
    },
    onError: (err) => setError(err instanceof SavedViewApiError ? err.message : "This view could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="Save current filters as a view">
      <div className="flex flex-col gap-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Checkbox isSelected={isDefault} onChange={setIsDefault}>Open this view by default</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim()}>
            Save view
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
