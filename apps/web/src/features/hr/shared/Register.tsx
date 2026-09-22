"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, Dialog, EnterpriseDataGrid, MetricStrip, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, HrApiError, readView, useHrOptions, type HrOptions, type Row } from "@/features/hr/shared/client";
import { FieldInput, type FieldDef, type FieldValue } from "@/features/hr/shared/FieldInput";
import { HrAlert, useCan } from "@/features/hr/shared/HrUi";

export type RowAction = {
  label: string;
  permission?: string;
  show?: (row: Row) => boolean;
  run: (row: Row, note: string, values: Record<string, FieldValue>) => Promise<unknown>;
  // Extra inputs asked for in the same dialog (a rating, a date) and passed to run().
  fields?: FieldDef[];
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
  source: { kind: "view"; view: string; params?: Record<string, string> };
  // Stock views only: a select that becomes a query parameter.
  filters?: Array<{ name: string; label: string; options: Array<{ value: string; label: string }> }>;
  columns: (options: HrOptions | undefined) => ColumnDef<Row, unknown>[];
  searchText: (row: Row) => string;
  createLabel?: string;
  // Creating is a screen of its own (a form too big for a dialog): navigate there instead.
  newHref?: string;
  createPermission?: string;
  fields?: FieldDef[];
  save?: { action: string; fixed?: Record<string, unknown>; idempotent?: boolean; success: string; transform?: (values: Record<string, FieldValue>) => Record<string, unknown> };
  // An Edit action per row: the same fields, posted with the row id to this action.
  edit?: { action: string; permission?: string; show?: (row: Row) => boolean };
  rowActions?: RowAction[];
  // Headline numbers over the rows currently shown (computed from what the server returned).
  summary?: (rows: Row[]) => Array<{ label: string; value: string }>;
};

// CSV of what is on screen: the same values the grid shows, one column per accessor.
function downloadCsv(name: string, columns: ColumnDef<Row, unknown>[], rows: Row[]) {
  const cells = columns.filter((column) => "accessorFn" in column && typeof column.header === "string" && column.header);
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [cells.map((column) => escape(column.header)).join(",")];
  for (const row of rows) lines.push(cells.map((column, index) => escape((column as { accessorFn: (row: Row, index: number) => unknown }).accessorFn(row, index))).join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const errorText = (error: unknown) => (error instanceof HrApiError ? error.message : "This could not be saved.");
const initial = (fields: FieldDef[], row?: Row): Record<string, FieldValue> =>
  Object.fromEntries(
    fields.map((field) => {
      const existing = row ? row[field.rowKey ?? field.name] : undefined;
      if (existing !== undefined && existing !== null) return [field.name, field.kind === "bool" ? String(existing) : field.kind === "date" ? String(existing).slice(0, 10) : (existing as FieldValue)];
      return [field.name, field.defaultValue ?? (field.kind === "number" ? 0 : "")];
    }),
  );

// One list-create-edit screen for every HR & Payroll register. Search is applied in the browser over
// the rows the server returns (already scoped to the active company); every field is validated by
// the domain and every action re-checks its own permission there.
export function Register({ config }: { config: RegisterConfig }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const router = useRouter();
  const options = useHrOptions();
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => (config.source.kind === "view" ? Object.fromEntries(Object.entries(config.source.params ?? {}).filter(([name]) => config.filters?.some((filter) => filter.name === name))) : {}));
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; row: Row } | null>(null);
  const [pending, setPending] = useState<{ action: RowAction; row: Row } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const source = config.source;
  const key = scopedQueryKey(workspace, "hr", config.key, JSON.stringify(filterValues));
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await readView(source.view, { ...(source.params ?? {}), ...filterValues })).rows,
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => {
    const all = query.data ?? [];
    const term = search.trim().toLowerCase();
    return term ? all.filter((row) => config.searchText(row).toLowerCase().includes(term)) : all;
  }, [query.data, search, config]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") });

  const denied = query.isError && query.error instanceof HrApiError && query.error.status === 403;

  const canCreate = Boolean((config.fields && config.save) || config.newHref) && can(config.createPermission);
  const startCreate = () => (config.newHref ? router.push(config.newHref) : setDialog({ mode: "create" }));
  const canEdit = Boolean(config.edit) && Boolean(config.fields) && can(config.edit?.permission ?? config.createPermission);

  const actions: RowAction[] = [
    ...(canEdit ? [{ label: "Edit", success: "Saved.", show: config.edit?.show, run: async () => undefined, edit: true } as RowAction & { edit: true }] : []),
    ...(config.rowActions ?? []).filter((action) => can(action.permission)),
  ];

  const runAction = useMutation({
    mutationFn: ({ action, row, note, values }: { action: RowAction; row: Row; note: string; values: Record<string, FieldValue> }) => action.run(row, note, values),
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
    else if (action.note || action.fields) setPending({ action, row });
    else runAction.mutate({ action, row, note: "", values: {} });
  }

  if (denied) return <PermissionState title="You don't have access to HR & Payroll" description="Ask an administrator to grant hr_payroll.view." />;

  const activeFilters = [...(search.trim() ? [`Search: ${search.trim()}`] : [])];
  const clear = () => {
    setSearch("");
    setFilterValues({});
  };

  return (
    <>
      <EnterpriseListPage
        header={{
          title: config.title,
          description: config.description,
          primaryAction: canCreate ? (
            <Button variant="primary" onPress={() => { setNotice(null); startCreate(); }}>
              <Plus className="size-4" aria-hidden="true" />
              {config.createLabel ?? "New"}
            </Button>
          ) : undefined,
          secondaryActions: rows.length ? (
            <Button variant="secondary" onPress={() => downloadCsv(config.key, config.columns(options.data), rows)}>
              Export CSV
            </Button>
          ) : undefined,
        }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label={config.searchLabel} placeholder="Search…" value={search} onChange={setSearch} className="min-w-[280px]" />
              {(config.filters ?? []).map((filter) => (
                <Select key={filter.name} aria-label={filter.label} size="compact" options={[{ value: "", label: `Any ${filter.label.toLowerCase()}` }, ...filter.options]} selectedKey={filterValues[filter.name] ?? ""} onSelectionChange={(k) => setFilterValues((current) => ({ ...current, [filter.name]: String(k ?? "") }))} />
              ))}
            </>
          ),
        }}
        filterBar={{ filters: activeFilters.map((text) => ({ id: text, label: text })), onRemove: clear, onClearAll: activeFilters.length || Object.values(filterValues).some(Boolean) ? clear : undefined }}
      >
        <div className="flex flex-col gap-3">
          {notice && <HrAlert tone="success">{notice}</HrAlert>}
          {actionError && <HrAlert>{actionError}</HrAlert>}
          {config.summary && rows.length > 0 && <MetricStrip metrics={config.summary(rows)} />}
          <EnterpriseDataGrid<Row>
            aria-label={config.title}
            columns={config.columns(options.data)}
            data={rows}
            getRowId={(row) => row.id}
            state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && search.trim() ? "no-results" : rows.length === 0 ? "empty" : "ready"}
            loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
            emptyContent={<NoResultsState title={config.emptyTitle} description={config.emptyDescription} action={canCreate ? { label: config.createLabel ?? "New", onPress: startCreate } : undefined} />}
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
          options={options.data}
          onConfirm={(note, values) => runAction.mutate({ action: pending.action, row: pending.row, note, values })}
        />
      )}
    </>
  );
}

function NoteDialog({ action, onClose, onConfirm, isPending, error, options }: { action: RowAction; onClose: () => void; onConfirm: (note: string, values: Record<string, FieldValue>) => void; isPending: boolean; error: string | null; options: HrOptions | undefined }) {
  const [note, setNote] = useState("");
  const [values, setValues] = useState<Record<string, FieldValue>>(() => initial(action.fields ?? []));
  const fields = (action.fields ?? []).filter((field) => !field.showIf || field.showIf(values));
  const missing = (Boolean(action.note?.required) && !note.trim()) || fields.some((field) => field.required && (values[field.name] === "" || values[field.name] === undefined));
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={action.label}>
      <div className="flex flex-col gap-4">
        {error && <HrAlert>{error}</HrAlert>}
        {fields.map((field) => (
          <FieldInput key={field.name} field={field} value={values[field.name]} onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))} options={options} values={values} />
        ))}
        {action.note && <TextArea label={action.note.label ?? "Note"} isRequired={action.note.required} value={note} onChange={setNote} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => onConfirm(note.trim(), values)} isLoading={isPending} isDisabled={missing}>
            {action.label}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function FormDialog({ config, mode, row, options, onClose, onSaved }: { config: RegisterConfig; mode: "create" | "edit"; row?: Row; options: HrOptions | undefined; onClose: () => void; onSaved: (message: string) => void }) {
  const fields = (config.fields ?? []).filter((field) => mode === "create" || !field.createOnly);
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
        if (mode === "edit" && String(value) === String(start[field.name])) continue;
        payload[field.name] = field.kind === "bool" ? value === "true" : value;
      }
      const target = config.save;
      if (mode === "edit" && row && config.edit) return act(config.edit.action, { id: row.id, ...payload });
      if (target) {
        const extra = target.transform ? target.transform(values) : {};
        return act(target.action, { ...payload, ...extra, ...(target.fixed ?? {}), ...(target.idempotent ? { idempotencyKey } : {}) });
      }
      throw new HrApiError("Nothing to save.", 400);
    },
    onSuccess: () => onSaved(mode === "edit" ? "Saved." : config.save && "action" in config.save ? config.save.success : "Saved."),
  });
  const missing = visible.some((field) => field.required && (values[field.name] === "" || values[field.name] === undefined));
  const title = mode === "edit" ? `Edit ${config.title.toLowerCase().replace(/s$/, "")}` : (config.createLabel ?? "New");

  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {save.error && <HrAlert>{errorText(save.error)}</HrAlert>}
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
