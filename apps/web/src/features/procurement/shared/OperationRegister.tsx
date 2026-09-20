"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError, post } from "@/features/procurement/shared/http";
import { listOperations } from "@/features/procurement/shared/api";
import { FieldInput, type FieldDef, type FieldValue } from "@/features/procurement/shared/FieldInput";
import { ProcAlert } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";
import { useLookup, type Lookup } from "@/features/procurement/shared/use-lookup";

export type OperationRow = { id: string } & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type OperationConfig = {
  kind: string; // /operations?kind=
  createPath?: string; // POST /operations/<createPath>
  title: string;
  description: string;
  searchLabel: string;
  createLabel?: string;
  createPermission?: string;
  fields?: FieldDef[];
  // Extra values derived on save (e.g. an idempotency key).
  transform?: (values: Record<string, FieldValue>) => Record<string, unknown>;
  columns: (lookup: Lookup) => ColumnDef<OperationRow, unknown>[];
  searchText: (row: OperationRow) => string;
  emptyTitle: string;
  emptyDescription: string;
  newHref?: string; // navigate instead of a dialog (e.g. invoice match form)
  onRowHref?: (row: OperationRow) => string;
};

// One list-and-create screen for the operational registers (invoice matches,
// landed costs, supplier prices, lead times, reorder requests, subcontract orders).
// The domain validates every field and enforces the operation's permission.
export function OperationRegister({ config }: { config: OperationConfig }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const lookup = useLookup();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const key = scopedQueryKey(workspace, "procurement", "operations", config.kind);
  const query = useQuery({ queryKey: key, queryFn: () => listOperations<OperationRow>(config.kind) });
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const term = search.trim().toLowerCase();
    return term ? all.filter((row) => config.searchText(row).toLowerCase().includes(term)) : all;
  }, [query.data, search, config]);
  const denied = query.isError && query.error instanceof ProcApiError && query.error.status === 403;
  if (denied) return <PermissionState title="You don't have access to Procurement" description="Ask an administrator to grant procurement.view." />;
  const canCreate = (config.fields || config.newHref) && can(config.createPermission);
  const start = () => (config.newHref ? (window.location.href = config.newHref) : setCreating(true));

  return (
    <>
      <EnterpriseListPage
        header={{
          title: config.title,
          description: config.description,
          primaryAction: canCreate ? (
            <Button variant="primary" onPress={start}>
              <Plus className="size-4" aria-hidden="true" />
              {config.createLabel ?? "New"}
            </Button>
          ) : undefined,
        }}
        actionBar={{ start: <SearchField aria-label={config.searchLabel} placeholder="Search…" value={search} onChange={setSearch} className="min-w-[280px]" /> }}
        filterBar={{ filters: search.trim() ? [{ id: "search", label: `Search: ${search.trim()}` }] : [], onRemove: () => setSearch(""), onClearAll: search.trim() ? () => setSearch("") : undefined }}
      >
        <EnterpriseDataGrid<OperationRow>
          aria-label={config.title}
          columns={config.columns(lookup)}
          data={rows}
          getRowId={(row) => row.id}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && search.trim() ? "no-results" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
          emptyContent={<NoResultsState title={config.emptyTitle} description={config.emptyDescription} action={canCreate ? { label: config.createLabel ?? "New", onPress: start } : undefined} />}
          noResultsContent={<NoResultsState title="Nothing matches this search" description="Try a different term." action={{ label: "Clear search", onPress: () => setSearch("") }} />}
          errorContent={<ErrorState title={`Could not load ${config.title.toLowerCase()}`} action={{ label: "Retry", onPress: () => query.refetch() }} />}
          onRowClick={config.onRowHref ? (row) => (window.location.href = config.onRowHref!(row)) : undefined}
        />
      </EnterpriseListPage>
      {creating && config.fields && config.createPath && (
        <CreateDialog
          config={config}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
          }}
        />
      )}
    </>
  );
}

function CreateDialog({ config, onClose, onSaved }: { config: OperationConfig; onClose: () => void; onSaved: () => void }) {
  const lookup = useLookup();
  const [values, setValues] = useState<Record<string, FieldValue>>(() => Object.fromEntries((config.fields ?? []).map((field) => [field.name, field.defaultValue ?? (field.kind === "number" ? 0 : "")])));
  const save = useMutation({
    mutationFn: () => post(`/operations/${config.createPath}`, { ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")), ...(config.transform ? config.transform(values) : {}) }),
    onSuccess: onSaved,
  });
  const message = save.error ? (save.error instanceof ProcApiError ? save.error.message : "This could not be saved.") : null;
  const missing = (config.fields ?? []).some((field) => field.required && (values[field.name] === "" || values[field.name] === undefined));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={config.createLabel ?? "New"}>
      <div className="flex flex-col gap-4">
        {message && <ProcAlert>{message}</ProcAlert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(config.fields ?? []).map((field) => (
            <div key={field.name} className={field.wide || field.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <FieldInput field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} options={lookup.options} />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={missing}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
