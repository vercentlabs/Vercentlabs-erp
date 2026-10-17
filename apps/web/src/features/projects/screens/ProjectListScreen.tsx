"use client";

// The project directory: the standard views (all, active, on hold, completed, archived, drafts — or the person's own projects) and the
// person's saved views (one may be the default), search, filters, sorting and paging on the server, export, and CSV import. Only the projects
// the person may see; health and progress are derived, never typed.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge, TextField,
} from "@vercentlabs/design-system";

import { filterBarOf, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  HEALTH_TONE, PRIORITY_LABEL, PROJECTS_BASE, STATUS_TONE, dateLabel, deleteView, errorMessage, errorStatus, exportHref, getOptions, getViews, importProjects, listProjects,
  newKey, saveView, targetLabel, type ProjectRow,
} from "../api/projects-api";
import { PriorityBadge } from "../priority/Priority";

const VIEWS = [{ id: "all", label: "All projects" }, { id: "active", label: "Active" }, { id: "on_hold", label: "On hold" }, { id: "completed", label: "Completed" },
  { id: "archived", label: "Archived" }, { id: "drafts", label: "Drafts" }, { id: "cancelled", label: "Cancelled" }];
const FILTER_KEYS = ["status", "priority", "health", "due", "managerId", "classification", "customer", "typeId", "tag"] as const;
const CUSTOMER_FILTERS = [{ value: "review", label: "Needs commercial review" }, { value: "no_primary_contact", label: "No primary contact" },
  { value: "provisional", label: "CRM account, not yet a Customer" }, { value: "inactive", label: "Inactive customer" }];
type Filters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;
const SORT_ID: Record<string, string> = { code: "code", name: "name", status: "status", priority: "priority", target: "target", manager: "manager", customer: "customer", health: "health", updated: "updated" };

export function ProjectListScreen({ mine = false }: { mine?: boolean }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const views = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "views"), queryFn: getViews });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [view, setView] = useState(() => (mine ? "mine" : VIEWS.some((row) => row.id === params.get("view")) ? params.get("view")! : "all"));
  const [filters, setFilters] = useState<Filters>(() => Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? undefined]).filter(([, value]) => value)) as Filters);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const term = useDebouncedValue(search);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<"save" | "import" | null>(null);
  const appliedDefault = useRef(false);
  // A sidebar link changes only ?view=: follow it.
  const urlView = params.get("view");
  const [seenUrlView, setSeenUrlView] = useState(urlView);
  if (urlView !== seenUrlView) {
    setSeenUrlView(urlView);
    if (!mine && urlView && VIEWS.some((row) => row.id === urlView)) { setView(urlView); setPage(0); }
  }
  // The person's default saved view applies when the page opens without a view of its own.
  useEffect(() => {
    if (appliedDefault.current || mine || params.get("view") || !views.data) return;
    appliedDefault.current = true;
    const preferred = views.data.find((row) => row.isDefault);
    if (preferred) apply(`saved:${preferred.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the views arrive
  }, [views.data]);
  const savedFilters = view.startsWith("saved:") ? views.data?.find((row) => `saved:${row.id}` === view)?.filters ?? {} : null;
  const baseView = savedFilters ? savedFilters.view ?? "all" : view;
  const query = { view: baseView, search: term || undefined, ...filters, sort: sorting[0] ? SORT_ID[sorting[0].id] : undefined, direction: sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined,
    page: page + 1, pageSize: 25 };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "list", query), queryFn: () => listProjects(query), placeholderData: (previous) => previous });
  const rows = list.data?.rows ?? [];
  function apply(id: string) {
    setView(id); setPage(0);
    const saved = id.startsWith("saved:") ? views.data?.find((row) => `saved:${row.id}` === id) : null;
    if (saved) {
      setFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, saved.filters[key]]).filter(([, value]) => value)) as Filters);
      setSearch(saved.filters.search ?? "");
    }
    if (!mine && !saved) router.replace(`${pathname}?view=${id}`);
  }
  const setFilter = (key: keyof Filters) => (value: string | null) => { setFilters((current) => ({ ...current, [key]: value || undefined })); setPage(0); };
  const managerName = (id: string) => options.data?.users.find((user) => user.id === id)?.name ?? "Manager";
  const columns = useMemo<ColumnDef<ProjectRow, unknown>[]>(() => [
    { id: "code", accessorKey: "code", header: "Project", enableHiding: false, cell: ({ row }) => (
      <span className="flex min-w-0 flex-col"><span className="truncate font-medium text-text" title={row.original.name ?? undefined}>{row.original.name ?? "Untitled draft"}</span>
        <span className="text-xs text-text-muted">{row.original.code} · {row.original.classification === "CUSTOMER" ? `${row.original.customer ?? "Customer not set"}${row.original.customerNumber ? ` (${row.original.customerNumber})` : ""}` : "Internal"}
          {row.original.provisionalCustomer ? " · CRM account" : ""}{row.original.customerInactive ? " · inactive customer" : ""}</span></span>) },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge>
      {row.original.archived && <StatusBadge tone="neutral">Archived</StatusBadge>}{row.original.approval === "PENDING" && <StatusBadge tone="info">Awaiting approval</StatusBadge>}
      {row.original.customerReview && <StatusBadge tone="warning">Review</StatusBadge>}</span> },
    { id: "health", accessorKey: "health", header: "Health", cell: ({ row }) => <span title={row.original.healthReasons.join("\n")}><StatusBadge tone={HEALTH_TONE[row.original.health]}>{row.original.healthLabel}</StatusBadge></span> },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
    { id: "manager", accessorKey: "manager", header: "Manager", cell: ({ row }) => row.original.manager ?? <span className="text-text-muted">Not assigned</span> },
    { id: "target", accessorKey: "targetEndDate", header: "Target", cell: ({ row }) => <span className="flex flex-col"><span>{dateLabel(row.original.targetEndDate)}</span>
      {targetLabel(row.original) && <span className={`text-xs ${row.original.overdue ? "text-danger" : "text-text-muted"}`}>{targetLabel(row.original)}</span>}</span> },
    { id: "progress", header: "Progress", cell: ({ row }) => (row.original.progress === null ? <span className="text-xs text-text-muted">{row.original.progressLabel}</span> : `${row.original.progress}%`) },
    { id: "updated", accessorKey: "updatedAt", header: "Updated", cell: ({ row }) => dateLabel(row.original.updatedAt) },
  ], []);
  if (list.error && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to projects" description="Ask an administrator for access." />;
  const filtered = Boolean(term || Object.values(filters).some(Boolean));
  const canCreate = list.data?.can.create ?? false;
  const allViews = [...(mine ? [{ id: "mine", label: "My projects" }] : VIEWS), ...(views.data ?? []).map((row) => ({ id: `saved:${row.id}`, label: row.isDefault ? `${row.name} (default)` : row.name }))];
  const chips = [
    { id: "status", active: Boolean(filters.status), label: `Status: ${filters.status?.toLowerCase().replace(/_/g, " ")}`, clear: () => setFilter("status")(null) },
    { id: "priority", active: Boolean(filters.priority), label: `Priority: ${filters.priority?.toLowerCase()}`, clear: () => setFilter("priority")(null) },
    { id: "health", active: Boolean(filters.health), label: `Health: ${filters.health?.toLowerCase().replace(/_/g, " ")}`, clear: () => setFilter("health")(null) },
    { id: "due", active: Boolean(filters.due), label: filters.due === "overdue" ? "Overdue" : "Due soon", clear: () => setFilter("due")(null) },
    { id: "managerId", active: Boolean(filters.managerId), label: `Manager: ${filters.managerId ? managerName(filters.managerId) : ""}`, clear: () => setFilter("managerId")(null) },
    { id: "classification", active: Boolean(filters.classification), label: filters.classification === "CUSTOMER" ? "Customer projects" : "Internal projects", clear: () => setFilter("classification")(null) },
    { id: "customer", active: Boolean(filters.customer), label: CUSTOMER_FILTERS.find((row) => row.value === filters.customer)?.label ?? "", clear: () => setFilter("customer")(null) },
    { id: "typeId", active: Boolean(filters.typeId), label: `Type: ${options.data?.types.find((type) => type.id === filters.typeId)?.name ?? ""}`, clear: () => setFilter("typeId")(null) },
    { id: "tag", active: Boolean(filters.tag), label: `Tag: ${filters.tag}`, clear: () => setFilter("tag")(null) },
  ];
  return (
    <EnterpriseListPage
      header={{ title: mine ? "My Projects" : "Projects", description: mine ? "The projects you manage or work on." : "Every project you can see: who leads it, where it stands and whether it is on track.",
        primaryAction: canCreate ? <LinkButton variant="primary" href={`${PROJECTS_BASE}/new`}>New project</LinkButton> : undefined,
        secondaryActions: (
          <span className="flex flex-wrap gap-2">
            {canCreate && !mine && <Button variant="secondary" onPress={() => setDialog("import")}>Import</Button>}
            {list.data?.can.export && <LinkButton variant="secondary" href={exportHref({ view: baseView, search: term || undefined, ...filters })}>Export</LinkButton>}
          </span>
        ) }}
      savedViews={{ views: allViews, activeViewId: view, onSelect: apply, onCreateView: () => setDialog("save") }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search projects" placeholder="Code, name, customer or tag" className="w-full sm:w-80" value={search} onChange={(value) => { setSearch(value); setPage(0); }} />
            <Select aria-label="Status" label="Status" size="compact" placeholder="Any status" selectedKey={filters.status ?? null} onSelectionChange={(key) => setFilter("status")(key ? String(key) : null)}
              options={[["DRAFT", "Draft"], ["PLANNED", "Planned"], ["IN_PROGRESS", "In progress"], ["ON_HOLD", "On hold"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]].map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Health" label="Health" size="compact" placeholder="Any health" selectedKey={filters.health ?? null} onSelectionChange={(key) => setFilter("health")(key ? String(key) : null)}
              options={[["ON_TRACK", "On track"], ["AT_RISK", "At risk"], ["BLOCKED", "Blocked"], ["UNKNOWN", "Unknown"]].map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Priority" label="Priority" size="compact" placeholder="Any priority" selectedKey={filters.priority ?? null} onSelectionChange={(key) => setFilter("priority")(key ? String(key) : null)}
              options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))} />
            <Select aria-label="Deadline" label="Deadline" size="compact" placeholder="Any date" selectedKey={filters.due ?? null} onSelectionChange={(key) => setFilter("due")(key ? String(key) : null)}
              options={[{ value: "overdue", label: "Overdue" }, { value: "soon", label: "Due soon" }]} />
            <Select aria-label="Manager" label="Manager" size="compact" placeholder="Any manager" selectedKey={filters.managerId ?? null} onSelectionChange={(key) => setFilter("managerId")(key ? String(key) : null)}
              options={(options.data?.users ?? []).map((user) => ({ value: user.id, label: user.name }))} />
            <Select aria-label="Kind" label="Kind" size="compact" placeholder="Internal and customer" selectedKey={filters.classification ?? null} onSelectionChange={(key) => setFilter("classification")(key ? String(key) : null)}
              options={[{ value: "CUSTOMER", label: "Customer projects" }, { value: "INTERNAL", label: "Internal projects" }]} />
            <Select aria-label="Customer" label="Customer" size="compact" placeholder="Any customer state" selectedKey={filters.customer ?? null} onSelectionChange={(key) => setFilter("customer")(key ? String(key) : null)}
              options={CUSTOMER_FILTERS} />
            <Select aria-label="Type" label="Type" size="compact" placeholder="Any type" selectedKey={filters.typeId ?? null} onSelectionChange={(key) => setFilter("typeId")(key ? String(key) : null)}
              options={(options.data?.types ?? []).map((type) => ({ value: type.id, label: type.name }))} />
          </>
        ),
      }}
      filterBar={filterBarOf(chips, () => setPage(0))}
    >
      <EnterpriseDataGrid<ProjectRow>
        aria-label="Projects" columns={columns} data={rows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered || !["all", "mine"].includes(baseView) ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading projects" rows={8} />}
        errorContent={<ErrorState title="Could not load projects" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title={mine ? "You are not on any project yet" : "No projects yet"} description={mine ? "Projects you manage or are added to appear here." : "Create the first project, or start one from a confirmed sales order."}
          action={canCreate ? { label: "New project", onPress: () => router.push(`${PROJECTS_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or filter." />}
        sorting={sorting} onSortingChange={(next) => { setSorting(next); setPage(0); }} manualSorting
        pageIndex={page} pageSize={25} pageCount={list.data?.pages ?? 1} totalRowCount={list.data?.total ?? 0} onPageChange={setPage}
        onRowClick={(row) => router.push(`${PROJECTS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-medium">{row.name ?? "Untitled draft"}</span><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.code} · {row.manager ?? "No manager"} · {row.healthLabel}{targetLabel(row) ? ` · ${targetLabel(row)}` : ""}</span>
          </div>
        )}
      />
      {dialog === "save" && <SaveViewDialog filters={{ view: baseView, ...(term ? { search: term } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) as Record<string, string> }}
        savedId={view.startsWith("saved:") ? view.slice(6) : null} onClose={() => setDialog(null)}
        onSaved={async () => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "views") }); setDialog(null); }} />}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") })} />}
    </EnterpriseListPage>
  );
}

function SaveViewDialog({ filters, savedId, onClose, onSaved }: { filters: Record<string, string>; savedId: string | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(null); try { await work(); await onSaved(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Save this view" size="sm">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">Keeps the current view, search and filters under a name only you see.</p>
        <TextField label="Name" value={name} onChange={setName} maxLength={80} />
        <Checkbox isSelected={isDefault} onChange={setIsDefault}>Open Projects with this view</Checkbox>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-between gap-2">
          {savedId ? <Button variant="ghost" isDisabled={busy} onPress={() => run(() => deleteView(savedId))}>Delete the current saved view</Button> : <span />}
          <span className="flex gap-2"><Button variant="ghost" onPress={onClose}>Cancel</Button>
            <Button variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={() => run(() => saveView({ name: name.trim(), filters, isDefault }))}>Save view</Button></span>
        </div>
      </div>
    </Dialog>
  );
}

const TEMPLATE = "Name,Classification,Type,Customer,Manager email,Start,Target,Priority,Tags,Description\nERP rollout,CUSTOMER,IMPLEMENTATION,CUST-000001,manager@example.com,2026-11-01,2026-12-15,HIGH,ERP;rollout,Configuration and training\n";
function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof importProjects>> | null>(null);
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Import projects" size="lg">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">A CSV with a header row; each row becomes a draft project (Name is required; Customer is a customer number or exact name; Manager is a colleague&apos;s email; dates as YYYY-MM-DD; tags separated by semicolons). Rows with a problem are listed and skipped.</p>
        <a className="text-sm text-brand underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="projects-template.csv">Download a template</a>
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="text-sm" onChange={async (event) => {
          const file = event.target.files?.[0]; setResult(null); setError(null);
          if (!file) { setCsv(null); return; }
          if (file.size > 2_000_000) { setError("Use a file under 2 MB."); return; }
          setFileName(file.name); setCsv(await file.text());
        }} />
        {error && <Notice tone="danger">{error}</Notice>}
        {result && (
          <>
            <Notice tone={result.failed ? "warning" : "success"}>{`${result.created} project(s) created${result.failed ? `, ${result.failed} row(s) skipped` : ""}.`}</Notice>
            {result.results.some((row) => row.status !== "CREATED") && (
              <LinesTable columns={["Row", "Result"]}>
                {result.results.filter((row) => row.status !== "CREATED").map((row) => <tr key={row.row}><Cell>{row.row}</Cell><Cell>{row.status === "FAILED" ? row.message : `Already imported as ${row.projectCode}`}</Cell></tr>)}
              </LinesTable>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>{result ? "Close" : "Cancel"}</Button>
          {!result && <Button variant="primary" isLoading={busy} isDisabled={!csv || busy} onPress={async () => {
            setBusy(true); setError(null);
            try { setResult(await importProjects(csv as string, `${key}:${fileName}`)); onDone(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Import</Button>}
        </div>
      </div>
    </Dialog>
  );
}
