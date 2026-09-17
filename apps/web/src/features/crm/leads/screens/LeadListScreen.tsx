"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, Kanban, Plus, SlidersHorizontal, Table2, Users } from "lucide-react";
import {
  Badge,
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  IconButton,
  NoResultsState,
  PermissionState,
  Popover,
  PopoverTrigger,
  SearchField,
  Select,
  StatusBadge,
  TextField,
  type ActiveFilter,
  type SelectOption,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SavedViewsBar } from "@/features/crm/shared/SavedViewsBar";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { LeadKanbanBoard, type LeadStageOption } from "../components/LeadKanbanBoard";
import {
  archiveLead,
  bulkUpdateLeads,
  getCrmOptions,
  LeadApiError,
  listLeads,
  type LeadBulkItemResult,
} from "../api/leads-api";
import type { Lead, LeadListFilters } from "../types";

const KANBAN_PAGE_SIZE = 200;

const PAGE_SIZE = 25;

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "all", label: "All priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const RATING_OPTIONS: SelectOption[] = [
  { value: "all", label: "Any rating" },
  { value: "hot", label: "Hot" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];

const FOLLOWUP_OPTIONS: SelectOption[] = [
  { value: "all", label: "Any follow-up" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "none", label: "No follow-up set" },
];

const QUALIFICATION_OPTIONS: SelectOption[] = [
  { value: "all", label: "Any qualification" },
  { value: "not_reviewed", label: "Not reviewed" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
];

const BULK_FIELD_OPTIONS: SelectOption[] = [
  { value: "priority", label: "Priority" },
  { value: "rating", label: "Rating" },
  { value: "sourceId", label: "Source" },
  { value: "nextFollowUpAt", label: "Next follow-up date" },
];

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  new: "info",
  contacted: "info",
  qualified: "success",
  unqualified: "neutral",
  converted: "success",
  archived: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

function filtersFromSearchParams(params: URLSearchParams): LeadListFilters {
  const filters: LeadListFilters = { limit: PAGE_SIZE, offset: 0 };
  const search = params.get("search");
  const status = params.get("status");
  const ownerId = params.get("ownerId");
  const sourceId = params.get("sourceId");
  const priority = params.get("priority");
  const rating = params.get("rating");
  const followup = params.get("followup");
  const qualification = params.get("qualification");
  const dwellBreached = params.get("dwellBreached");
  const highPriority = params.get("highPriority");
  const offset = params.get("offset");
  if (search) filters.search = search;
  if (status) filters.status = status;
  if (ownerId) filters.ownerId = ownerId;
  if (sourceId) filters.sourceId = sourceId;
  if (priority) filters.priority = priority;
  if (rating) filters.rating = rating;
  if (followup) filters.followup = followup as LeadListFilters["followup"];
  if (qualification) filters.qualification = qualification as LeadListFilters["qualification"];
  if (dwellBreached === "true") filters.dwellBreached = "true";
  if (highPriority === "true") filters.highPriority = "true";
  if (offset) filters.offset = Number(offset) || 0;
  return filters;
}

export function LeadListScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManageLeads = workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);

  const [filters, setFilters] = useState<LeadListFilters>(() => filtersFromSearchParams(searchParams));
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [bulkField, setBulkField] = useState<string>("priority");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ summary: string; failures: LeadBulkItemResult[] } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // URL-addressable list state (Tranche 9): every filter/page change is
  // reflected in the URL so a saved link, browser back, or a reload all
  // restore the exact same view.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "" && value !== "all" && key !== "limit") params.set(key, String(value));
    }
    router.replace(`/crm/leads${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", filters),
    queryFn: () => listLeads(filters),
    placeholderData: (previous) => previous,
  });

  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: getCrmOptions,
  });

  function updateFilter<K extends keyof LeadListFilters>(key: K, value: LeadListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function submitSearch() {
    updateFilter("search", searchInput || undefined);
  }

  const ownerOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [{ value: "all", label: "Any owner" }, ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }))];
  }, [optionsQuery.data]);

  const stageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{ id: string; code: string; name: string; status: string }>;
    return [{ value: "all", label: "Any stage" }, ...rows.filter((row) => row.status === "active").map((row) => ({ value: row.code, label: row.name }))];
  }, [optionsQuery.data]);

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.status) active.push({ id: "status", label: `Stage: ${filters.status}` });
    if (filters.ownerId) active.push({ id: "ownerId", label: "Owner filter" });
    if (filters.priority) active.push({ id: "priority", label: `Priority: ${filters.priority}` });
    if (filters.rating) active.push({ id: "rating", label: `Rating: ${filters.rating}` });
    if (filters.followup) active.push({ id: "followup", label: `Follow-up: ${filters.followup}` });
    if (filters.qualification) active.push({ id: "qualification", label: `Qualification: ${filters.qualification}` });
    if (filters.dwellBreached) active.push({ id: "dwellBreached", label: "Dwell-breached" });
    if (filters.highPriority) active.push({ id: "highPriority", label: "High priority" });
    if (filters.search) active.push({ id: "search", label: `Search: ${filters.search}` });
    return active;
  }, [filters]);

  function removeFilter(id: string) {
    if (id === "search") setSearchInput("");
    setFilters((current) => ({ ...current, [id]: undefined, offset: 0 }));
  }

  function clearAllFilters() {
    setSearchInput("");
    setFilters({ limit: PAGE_SIZE, offset: 0 });
  }

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Qualification/Priority/Rating/Follow-up are real but less-used filters
  // (UI refinement addendum #5) — kept out of the always-visible toolbar
  // and grouped behind "More filters" so the default surface stays compact;
  // Stage/Owner/Search are the ones people reach for on every visit.
  const secondaryFilterCount = [filters.qualification, filters.priority, filters.rating, filters.followup].filter(Boolean).length;

  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const hasFilters = Boolean(filters.search || filters.status || filters.ownerId || filters.priority || filters.rating || filters.followup || filters.qualification || filters.dwellBreached || filters.highPriority);
  const hasExplicitFilters = searchParams.toString().length > 0;
  const filtersWithoutPaging: LeadListFilters = useMemo(() => {
    const rest = { ...filters };
    delete rest.limit;
    delete rest.offset;
    return rest;
  }, [filters]);

  // Kanban shows every matching lead across stage columns at once, not a
  // single page of PAGE_SIZE — same filters as the table (search/stage/
  // owner/etc.), just a much larger limit and no offset. Only fetched
  // while the Kanban view is actually active.
  const kanbanQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "kanban", filtersWithoutPaging),
    queryFn: () => listLeads({ ...filtersWithoutPaging, limit: KANBAN_PAGE_SIZE, offset: 0 }),
    enabled: view === "kanban",
  });

  const leadStageColumns: LeadStageOption[] = useMemo(() => {
    const stageRows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{ id: string; code: string; name: string; status: string }>;
    return stageRows.filter((row) => row.status === "active").map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }, [optionsQuery.data]);

  async function runBulkUpdate() {
    if (!bulkValue && bulkField !== "nextFollowUpAt") return;
    setBulkBusy(true);
    setBulkResult(null);
    const targets = rows.filter((row) => selection[row.id]);
    const expectedVersions = Object.fromEntries(targets.map((row) => [row.id, row.updatedAt]));
    try {
      const result = await bulkUpdateLeads(
        targets.map((row) => row.id),
        { [bulkField]: bulkField === "nextFollowUpAt" ? bulkValue || null : bulkValue },
        expectedVersions,
        `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      if (result.mode === "synchronous") {
        const failures = result.items.filter((item) => item.status !== "applied");
        setBulkResult({
          summary: `${result.applied} of ${result.requested} leads updated. ${result.conflict} changed since selection, ${result.skipped} out of scope, ${result.failed} failed.`,
          failures,
        });
      } else {
        setBulkResult({ summary: `Large selection queued as background job ${result.job.id} (status: ${result.job.status}).`, failures: [] });
      }
    } catch (error) {
      setBulkResult({ summary: error instanceof LeadApiError ? error.message : "The bulk update could not be completed.", failures: [] });
    } finally {
      setBulkBusy(false);
      setSelection({});
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
    }
  }

  async function archiveRow(lead: Lead) {
    setRowError(null);
    try {
      await archiveLead(lead.id, lead.updatedAt);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
    } catch (error) {
      setRowError(error instanceof LeadApiError ? error.message : "This Lead could not be archived.");
    }
  }

  const columns: ColumnDef<Lead, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Lead",
        accessorFn: (row) => row.fullName || `${row.firstName} ${row.lastName || ""}`.trim(),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-text">{row.original.fullName || `${row.original.firstName} ${row.original.lastName || ""}`.trim()}</span>
            {row.original.companyName && <span className="text-xs text-text-muted">{row.original.companyName}</span>}
          </div>
        ),
      },
      {
        id: "status",
        header: "Stage",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={statusTone[String(getValue())] ?? "neutral"}>{String(getValue())}</StatusBadge>,
      },
      {
        id: "qualificationState",
        header: "Qualification",
        accessorFn: (row) => row.qualificationState || "not_reviewed",
      },
      {
        id: "priority",
        header: "Priority",
        accessorKey: "priority",
        cell: ({ getValue }) => <Badge>{String(getValue())}</Badge>,
      },
      {
        id: "owner",
        header: "Owner",
        accessorFn: (row) => row.ownerName || "Unassigned",
      },
      {
        id: "score",
        header: "Score",
        accessorKey: "score",
        cell: ({ getValue }) => {
          const value = getValue();
          return <span className="tabular-nums">{value === null || value === undefined ? "—" : String(value)}</span>;
        },
      },
      {
        id: "nextFollowUpAt",
        header: "Next follow-up",
        accessorKey: "nextFollowUpAt",
        cell: ({ getValue }) => {
          const value = getValue() as string | null;
          return value ? dateFormatter.format(new Date(value)) : "—";
        },
      },
      {
        id: "updatedAt",
        header: "Updated",
        accessorKey: "updatedAt",
        cell: ({ getValue }) => dateFormatter.format(new Date(getValue() as string)),
      },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof LeadApiError && query.error.status === 403
      ? "permission-denied"
      : query.isError
        ? "error"
        : rows.length === 0 && hasFilters
          ? "no-results"
          : rows.length === 0
            ? "empty"
            : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Leads",
        description: "Every prospect awaiting qualification, assignment, or follow-up.",
        secondaryActions: (
          <div className="flex items-center rounded-[var(--radius-control)] border border-border bg-surface p-0.5">
            <button
              type="button"
              aria-pressed={view === "table"}
              onClick={() => setView("table")}
              className={[
                "flex items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1.5 text-sm font-medium transition-colors",
                view === "table" ? "bg-brand-soft text-brand" : "text-text-secondary hover:bg-surface-muted",
              ].join(" ")}
            >
              <Table2 className="size-3.5" aria-hidden="true" />
              Table
            </button>
            <button
              type="button"
              aria-pressed={view === "kanban"}
              onClick={() => setView("kanban")}
              className={[
                "flex items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1.5 text-sm font-medium transition-colors",
                view === "kanban" ? "bg-brand-soft text-brand" : "text-text-secondary hover:bg-surface-muted",
              ].join(" ")}
            >
              <Kanban className="size-3.5" aria-hidden="true" />
              Kanban
            </button>
          </div>
        ),
        primaryAction: canManageLeads ? (
          <Button variant="primary" onPress={() => router.push("/crm/leads/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New lead
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField
              aria-label="Search leads"
              placeholder="Search by name, email, phone, company…"
              value={searchInput}
              onChange={setSearchInput}
              onKeyDown={(event) => event.key === "Enter" && submitSearch()}
              className="min-w-[240px]"
            />
            <Select aria-label="Stage" size="compact" options={stageOptions} selectedKey={filters.status ?? "all"} onSelectionChange={(key) => updateFilter("status", key === "all" ? undefined : String(key))} />
            <Select aria-label="Owner" size="compact" options={ownerOptions} selectedKey={filters.ownerId ?? "all"} onSelectionChange={(key) => updateFilter("ownerId", key === "all" ? undefined : String(key))} />
            <PopoverTrigger>
              <Button variant="secondary" size="compact">
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                More filters
                {secondaryFilterCount > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-[var(--radius-pill)] bg-brand text-[10px] font-semibold text-white">
                    {secondaryFilterCount}
                  </span>
                )}
              </Button>
              <Popover placement="bottom start">
                <div className="flex w-64 flex-col gap-3">
                  <Select label="Qualification" size="compact" options={QUALIFICATION_OPTIONS} selectedKey={filters.qualification ?? "all"} onSelectionChange={(key) => updateFilter("qualification", key === "all" ? undefined : (String(key) as LeadListFilters["qualification"]))} />
                  <Select label="Priority" size="compact" options={PRIORITY_OPTIONS} selectedKey={filters.priority ?? "all"} onSelectionChange={(key) => updateFilter("priority", key === "all" ? undefined : (String(key) as LeadListFilters["priority"]))} />
                  <Select label="Rating" size="compact" options={RATING_OPTIONS} selectedKey={filters.rating ?? "all"} onSelectionChange={(key) => updateFilter("rating", key === "all" ? undefined : String(key))} />
                  <Select label="Follow-up" size="compact" options={FOLLOWUP_OPTIONS} selectedKey={filters.followup ?? "all"} onSelectionChange={(key) => updateFilter("followup", key === "all" ? undefined : (String(key) as LeadListFilters["followup"]))} />
                </div>
              </Popover>
            </PopoverTrigger>
          </>
        ),
        end: <Button variant="secondary" onPress={submitSearch}>Search</Button>,
      }}
      filterBar={{ filters: activeFilters, onRemove: removeFilter, onClearAll: activeFilters.length > 0 ? clearAllFilters : undefined }}
      bulkActionBar={{
        selectedCount: selectedIds.length,
        onClearSelection: () => setSelection({}),
        actions: (
          <>
            <Select aria-label="Bulk field" size="compact" options={BULK_FIELD_OPTIONS} selectedKey={bulkField} onSelectionChange={(key) => { setBulkField(String(key)); setBulkValue(""); }} />
            {bulkField === "priority" ? (
              <Select aria-label="New priority" size="compact" options={PRIORITY_OPTIONS.filter((o) => o.value !== "all")} selectedKey={bulkValue} onSelectionChange={(key) => setBulkValue(String(key))} placeholder="Choose…" />
            ) : bulkField === "rating" ? (
              <Select aria-label="New rating" size="compact" options={RATING_OPTIONS.filter((o) => o.value !== "all")} selectedKey={bulkValue} onSelectionChange={(key) => setBulkValue(String(key))} placeholder="Choose…" />
            ) : (
              <TextField aria-label="New value" size="compact" placeholder={bulkField === "nextFollowUpAt" ? "YYYY-MM-DD" : "Source id"} value={bulkValue} onChange={setBulkValue} className="w-40" />
            )}
            <Button variant="secondary" size="compact" onPress={runBulkUpdate} isLoading={bulkBusy} isDisabled={!canManageLeads}>
              Apply to selected
            </Button>
          </>
        ),
      }}
    >
      <SavedViewsBar
        resource="leads"
        baseFilters={{ limit: PAGE_SIZE, offset: 0 } as LeadListFilters}
        currentFilters={filtersWithoutPaging}
        hasExplicitFilters={hasExplicitFilters}
        onApply={(next) => setFilters(next)}
      />
      {rowError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {rowError}
        </p>
      )}
      {bulkResult && (
        <div className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <p>{bulkResult.summary}</p>
          {bulkResult.failures.length > 0 && (
            <ul className="list-disc pl-5 text-xs">
              {bulkResult.failures.map((item) => (
                <li key={item.id}>{item.message || item.code || item.status}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view === "kanban" ? (
        <LeadKanbanBoard
          leads={kanbanQuery.data?.rows ?? []}
          stages={leadStageColumns}
          isLoading={kanbanQuery.isLoading}
          onOpen={(id) => router.push(`/crm/leads/${id}`)}
        />
      ) : (
        <EnterpriseDataGrid<Lead>
          aria-label="Leads"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={gridState}
          loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading leads…</p>}
          emptyContent={
            <NoResultsState
              title="No leads yet"
              description="New leads captured from forms, imports, or manual entry will appear here."
              action={canManageLeads ? { label: "New lead", onPress: () => router.push("/crm/leads/new") } : undefined}
            />
          }
          noResultsContent={
            <NoResultsState title="No leads match these filters" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clearAllFilters }} />
          }
          errorContent={<ErrorState title="Could not load leads" description="Something went wrong loading this list." action={{ label: "Retry", onPress: () => query.refetch() }} />}
          permissionDeniedContent={<PermissionState title="You don't have access to Leads" description="Ask an administrator to grant CRM lead access." />}
          enableRowSelection
          rowSelection={selection}
          onRowSelectionChange={setSelection}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          pageCount={pageCount}
          totalRowCount={total}
          onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
          onRowClick={(row) => router.push(`/crm/leads/${row.id}`)}
          rowActions={
            canManageLeads
              ? (row) =>
                  row.recordStatus === "converted" || row.recordStatus === "archived" ? null : (
                    <span onClick={(event) => event.stopPropagation()}>
                      <IconButton aria-label={`Archive ${row.fullName || row.firstName}`} size="compact" variant="ghost" onPress={() => archiveRow(row)}>
                        <Archive className="size-4" aria-hidden="true" />
                      </IconButton>
                    </span>
                  )
              : undefined
          }
          renderMobileCard={(row) => (
            <button
              type="button"
              onClick={() => router.push(`/crm/leads/${row.id}`)}
              className="flex w-full flex-col gap-1.5 border-b border-border px-4 py-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-text">{row.fullName || `${row.firstName} ${row.lastName || ""}`.trim()}</span>
                <StatusBadge tone={statusTone[row.status] ?? "neutral"}>{row.status}</StatusBadge>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Users className="size-3.5" aria-hidden="true" />
                <span>{row.ownerName || "Unassigned"}</span>
                {row.nextFollowUpAt && <span>· Follow up {dateFormatter.format(new Date(row.nextFollowUpAt))}</span>}
              </div>
            </button>
          )}
        />
      )}
    </EnterpriseListPage>
  );
}
