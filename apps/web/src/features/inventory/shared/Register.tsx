"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, createMaster, InvApiError, listMaster, readStock, updateMaster, useInvOptions, type InvOptions, type Row } from "@/features/inventory/shared/client";
import { FieldInput, type FieldDef, type FieldValue } from "@/features/inventory/shared/FieldInput";
import { InvAlert, useCan } from "@/features/inventory/shared/InvUi";
import { label } from "@/features/inventory/shared/format";

export type RowAction = {
  label: string;
  permission?: string;
  show?: (row: Row) => boolean;
  run: (row: Row, note: string) => Promise<unknown>;
  // Ask for a reason/note before running (required when `required`).
  note?: { label: string; required?: boolean };
  success: string;
};

export type RegisterConfig = {
  key: string;
  title: string;
  description: string;
  searchLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  source: { kind: "master"; resource: string } | { kind: "stock"; view: string; params?: Record<string, string> };
  // Stock views only: a select that becomes a query parameter.
  filters?: Array<{ name: string; label: string; options: Array<{ value: string; label: string }> }>;
  columns: (options: InvOptions | undefined) => ColumnDef<Row, unknown>[];
  searchText: (row: Row) => string;
  createLabel?: string;
  createPermission?: string;
  fields?: FieldDef[];
  save?: { master: string } | { action: string; fixed?: Record<string, unknown>; idempotent?: boolean; success: string; transform?: (values: Record<string, FieldValue>) => Record<string, unknown> };
  // Master data: an Edit action per row (and Deactivate / Reactivate when `archive`).
  editPermission?: string;
  // A stock record edited by re-saving it (the domain upserts on its natural key, e.g. reorder rules).
  upsert?: boolean;
  archive?: boolean;
  rowActions?: RowAction[];
};

const errorText = (error: unknown) => (error instanceof InvApiError ? error.message : "This could not be saved.");
const initial = (fields: FieldDef[], row?: Row): Record<string, FieldValue> =>
  Object.fromEntries(
    fields.map((field) => {
      const existing = row ? row[field.rowKey ?? field.name] : undefined;
      if (existing !== undefined && existing !== null) return [field.name, field.kind === "bool" ? String(existing) : field.kind === "date" ? String(existing).slice(0, 10) : (existing as FieldValue)];
      return [field.name, field.defaultValue ?? (field.kind === "number" ? 0 : "")];
    }),
  );

// One list-create-edit screen for every Inventory register. Search is applied in the browser over
// the rows the server returns (already scoped to the active company); every field is validated by
// the domain and every action re-checks its own permission there.
export function Register({ config }: { config: RegisterConfig }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const options = useInvOptions();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => (config.source.kind === "stock" ? Object.fromEntries(Object.entries(config.source.params ?? {}).filter(([name]) => config.filters?.some((filter) => filter.name === name))) : {}));
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; row: Row } | null>(null);
  const [pending, setPending] = useState<{ action: RowAction; row: Row } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const source = config.source;
  const key = scopedQueryKey(workspace, "inventory", config.key, status, JSON.stringify(filterValues));
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      source.kind === "master"
        ? (await listMaster(source.resource, { status: status === "all" ? "all" : status })).rows
        : (await readStock(source.view, { ...(source.params ?? {}), ...filterValues })).rows,
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const term = search.trim().toLowerCase();
    return term ? all.filter((row) => config.searchText(row).toLowerCase().includes(term)) : all;
  }, [query.data, search, config]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "inventory") });

  const denied = query.isError && query.error instanceof InvApiError && query.error.status === 403;

  const canCreate = Boolean(config.fields && config.save) && can(config.createPermission);
  const canEdit = ((source.kind === "master" && Boolean(config.fields)) || Boolean(config.upsert)) && can(config.editPermission ?? config.createPermission);
  const master = source.kind === "master" ? source.resource : null;

  const actions: RowAction[] = [
    ...(canEdit ? [{ label: "Edit", success: "Saved.", run: async () => undefined, edit: true } as RowAction & { edit: true }] : []),
    ...(canEdit && config.archive && master
      ? [
          { label: "Deactivate", success: "Deactivated.", show: (row: Row) => row.status === "active", run: (row: Row) => updateMaster(master, row.id, { status: "inactive" }) },
          { label: "Reactivate", success: "Reactivated.", show: (row: Row) => row.status === "inactive", run: (row: Row) => updateMaster(master, row.id, { status: "active" }) },
        ]
      : []),
    ...(config.rowActions ?? []).filter((action) => can(action.permission)),
  ];

  const runAction = useMutation({
    mutationFn: ({ action, row, note }: { action: RowAction; row: Row; note: string }) => action.run(row, note),
    onSuccess: (_result, variables) => {
      setPending(null);
      setActionError(null);
      setNotice(variables.action.success);
      refresh();
    },
    onError: (error) => setActionError(errorText(error)),
  });
  function invoke(action: RowAction, row: Row) {
    setNotice(null);
    setActionError(null);
    if ("edit" in action) setDialog({ mode: "edit", row });
    else if (action.note) setPending({ action, row });
    else runAction.mutate({ action, row, note: "" });
  }

  if (denied) return <PermissionState title="You don't have access to Inventory" description="Ask an administrator to grant stock.view." />;

  const activeFilters = [...(search.trim() ? [`Search: ${search.trim()}`] : []), ...(status !== "all" ? [`Status: ${label(status)}`] : [])];
  const clear = () => {
    setSearch("");
    setStatus("all");
    setFilterValues({});
  };

  return (
    <>
      <EnterpriseListPage
        header={{
          title: config.title,
          description: config.description,
          primaryAction: canCreate ? (
            <Button variant="primary" onPress={() => { setNotice(null); setDialog({ mode: "create" }); }}>
              <Plus className="size-4" aria-hidden="true" />
              {config.createLabel ?? "New"}
            </Button>
          ) : undefined,
        }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label={config.searchLabel} placeholder="Search…" value={search} onChange={setSearch} className="min-w-[280px]" />
              {source.kind === "master" && <Select aria-label="Status" size="compact" options={[{ value: "all", label: "Any status" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} selectedKey={status} onSelectionChange={(k) => setStatus(String(k ?? "all"))} />}
              {(config.filters ?? []).map((filter) => (
                <Select key={filter.name} aria-label={filter.label} size="compact" options={[{ value: "", label: `Any ${filter.label.toLowerCase()}` }, ...filter.options]} selectedKey={filterValues[filter.name] ?? ""} onSelectionChange={(k) => setFilterValues((current) => ({ ...current, [filter.name]: String(k ?? "") }))} />
              ))}
            </>
          ),
        }}
        filterBar={{ filters: activeFilters.map((text) => ({ id: text, label: text })), onRemove: clear, onClearAll: activeFilters.length || Object.values(filterValues).some(Boolean) ? clear : undefined }}
      >
        <div className="flex flex-col gap-3">
          {notice && <InvAlert tone="success">{notice}</InvAlert>}
          {actionError && <InvAlert>{actionError}</InvAlert>}
          <EnterpriseDataGrid<Row>
            aria-label={config.title}
            columns={config.columns(options.data)}
            data={rows}
            getRowId={(row) => row.id}
            state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && (search.trim() || status !== "all") ? "no-results" : rows.length === 0 ? "empty" : "ready"}
            loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
            emptyContent={<NoResultsState title={config.emptyTitle} description={config.emptyDescription} action={canCreate ? { label: config.createLabel ?? "New", onPress: () => setDialog({ mode: "create" }) } : undefined} />}
            noResultsContent={<NoResultsState title="Nothing matches" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clear }} />}
            errorContent={<ErrorState title={`Could not load ${config.title.toLowerCase()}`} action={{ label: "Retry", onPress: () => query.refetch() }} />}
            rowActions={
              actions.length
                ? (row) => (
                    <div className="flex gap-1">
                      {actions
                        .filter((action) => !action.show || action.show(row))
                        .map((action) => (
                          <Button key={action.label} variant="ghost" size="compact" onPress={() => invoke(action, row)}>
                            {action.label}
                          </Button>
                        ))}
                    </div>
                  )
                : undefined
            }
          />
        </div>
      </EnterpriseListPage>
      {dialog && config.fields && (
        <FormDialog
          config={config}
          mode={dialog.mode}
          row={dialog.mode === "edit" ? dialog.row : undefined}
          options={options.data}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            setNotice(message);
            refresh();
          }}
        />
      )}
      {pending && (
        <NoteDialog
          action={pending.action}
          isPending={runAction.isPending}
          error={actionError}
          onClose={() => { setPending(null); setActionError(null); }}
          onConfirm={(note) => runAction.mutate({ action: pending.action, row: pending.row, note })}
        />
      )}
    </>
  );
}

function NoteDialog({ action, onClose, onConfirm, isPending, error }: { action: RowAction; onClose: () => void; onConfirm: (note: string) => void; isPending: boolean; error: string | null }) {
  const [note, setNote] = useState("");
  const missing = Boolean(action.note?.required) && !note.trim();
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={action.label}>
      <div className="flex flex-col gap-4">
        {error && <InvAlert>{error}</InvAlert>}
        <TextArea label={action.note?.label ?? "Note"} isRequired={action.note?.required} value={note} onChange={setNote} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => onConfirm(note.trim())} isLoading={isPending} isDisabled={missing}>
            {action.label}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function FormDialog({ config, mode, row, options, onClose, onSaved }: { config: RegisterConfig; mode: "create" | "edit"; row?: Row; options: InvOptions | undefined; onClose: () => void; onSaved: (message: string) => void }) {
  const fields = (config.fields ?? []).filter((field) => mode === "create" || config.upsert || !field.createOnly);
  const [start] = useState(() => initial(fields, row));
  const [values, setValues] = useState<Record<string, FieldValue>>(start);
  // One key per opening of the dialog: a double-click or a retry replays the same operation.
  const [idempotencyKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())));
  const visible = fields.filter((field) => !field.showIf || field.showIf(values));

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const field of visible) {
        const value = values[field.name];
        if (mode === "create" && (value === "" || value === undefined)) continue;
        // An edit sends only what changed, so a field the caller cannot see (cost) is never overwritten.
        if (mode === "edit" && !config.upsert && String(value) === String(start[field.name])) continue;
        payload[field.name] = field.kind === "bool" ? value === "true" : value;
      }
      const target = config.save;
      if (mode === "edit" && !config.upsert && config.source.kind === "master" && row) return updateMaster(config.source.resource, row.id, payload);
      if (target && "master" in target) return createMaster(target.master, payload);
      if (target && "action" in target) {
        const extra = target.transform ? target.transform(values) : {};
        return act(target.action, { ...payload, ...extra, ...(target.fixed ?? {}), ...(target.idempotent ? { idempotencyKey } : {}) });
      }
      throw new InvApiError("Nothing to save.", 400);
    },
    onSuccess: () => onSaved(mode === "edit" ? "Saved." : config.save && "action" in config.save ? config.save.success : "Saved."),
  });
  const missing = visible.some((field) => field.required && (values[field.name] === "" || values[field.name] === undefined));
  const title = mode === "edit" ? `Edit ${config.title.toLowerCase().replace(/s$/, "")}` : (config.createLabel ?? "New");

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {save.error && <InvAlert>{errorText(save.error)}</InvAlert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((field) => (
            <div key={field.name} className={field.wide || field.kind === "textarea" ? "sm:col-span-2" : undefined}>
              <FieldInput field={field} value={values[field.name]} onChange={(value) =>
                  setValues((current) => {
                    const next = { ...current, [field.name]: value };
                    // a dependent picker (locations of a warehouse, batches of an item) is cleared when its parent changes
                    for (const other of fields) if (other.dependsOn === field.name) next[other.name] = "";
                    return next;
                  })
                }
                options={options} values={values} />
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
