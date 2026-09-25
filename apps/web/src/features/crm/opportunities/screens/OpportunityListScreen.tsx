"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  TextField,
  type ActiveFilter,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { Kanban, Table2 } from "lucide-react";
import { dueState, formatMoney } from "@/features/crm/shared/human";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { money } from "@/features/crm/shared/format";
import { SavedViewsBar } from "@/features/crm/shared/SavedViewsBar";
import { bulkUpdateOpportunitiesRequest, listOpportunities, OpportunityApiError, type OpportunityBulkSyncResult } from "../api/opportunities-api";
import type { Opportunity, OpportunityListFilters } from "../types";

const PAGE_SIZE = 25;

function filtersFromSearchParams(params: URLSearchParams): OpportunityListFilters {
  const filters: OpportunityListFilters = { limit: PAGE_SIZE, offset: 0, status: "open" };
  const search = params.get("search");
  const stageId = params.get("stageId");
  const status = params.get("status");
  const stalled = params.get("stalled");
  const offset = params.get("offset");
  if (search) filters.search = search;
  if (stageId) filters.stageId = stageId;
  if (status) filters.status = status;
  if (stalled === "true") filters.stalled = "true";
  const ownerId = params.get("ownerId");
  if (ownerId) filters.ownerId = ownerId;
  const forecastCategory = params.get("forecastCategory");
  if (forecastCategory) filters.forecastCategory = forecastCategory;
  const outcomeReasonId = params.get("outcomeReasonId");
  if (outcomeReasonId) filters.outcomeReasonId = outcomeReasonId;
  for (const key of ["closedFrom", "closedTo", "expectedCloseFrom", "expectedCloseTo"] as const) {
    const value = params.get(key);
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) filters[key] = value;
  }
  if (offset) filters.offset = Number(offset) || 0;
  return filters;
}

const BULK_FIELD_OPTIONS: SelectOption[] = [
  { value: "ownerUserId", label: "Owner" },
  { value: "expectedCloseDate", label: "Expected close date" },
  { value: "nextStep", label: "Next step" },
];

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  open: "info",
  won: "success",
  lost: "danger",
  archived: "neutral",
};

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

export function OpportunityListScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.opportunitiesManage);

  const [filters, setFilters] = useState<OpportunityListFilters>(() => filtersFromSearchParams(searchParams));
  const [searchInput, setSearchInput] = useState(() => filtersFromSearchParams(searchParams).search ?? "");
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [bulkField, setBulkField] = useState<string>("ownerUserId");
  const [bulkValue, setBulkValue] = useState<string>("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // URL-addressable list state (Tranche 9), same pattern as Leads.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "" && value !== "all" && key !== "limit" && !(key === "status" && value === "open")) params.set(key, String(value));
    }
    router.replace(`/crm/opportunities${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", filters),
    queryFn: () => listOpportunities(filters),
    placeholderData: (previous) => previous,
  });

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });

  const stageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.stages ?? []) as Array<{ id: string; name: string }>;
    return [{ value: "all", label: "Any stage" }, ...rows.map((row) => ({ value: row.id, label: row.name }))];
  }, [optionsQuery.data]);

  const ownerOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.users ?? []) as Array<{ id: string; fullName?: string; name?: string }>;
    return rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }));
  }, [optionsQuery.data]);

  function updateFilter<K extends keyof OpportunityListFilters>(key: K, value: OpportunityListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.status && filters.status !== "open") active.push({ id: "status", label: filters.status === "closed" ? "Status: won or lost" : `Status: ${filters.status}` });
    if (filters.ownerId) active.push({ id: "ownerId", label: filters.ownerId === "me" ? "Owner: me" : filters.ownerId === "team" ? "Owner: my team" : filters.ownerId === "unassigned" ? "Owner: unassigned" : `Owner: ${ownerOptions.find((option) => option.value === filters.ownerId)?.label ?? "someone outside your list"}` });
    if (filters.closedFrom || filters.closedTo) active.push({ id: "closed", label: `Closed ${filters.closedFrom ?? "…"} – ${filters.closedTo ?? "…"}` });
    if (filters.expectedCloseFrom || filters.expectedCloseTo) active.push({ id: "expectedClose", label: `Expected to close ${filters.expectedCloseFrom ?? "…"} – ${filters.expectedCloseTo ?? "…"}` });
    if (filters.forecastCategory) active.push({ id: "forecastCategory", label: `Forecast: ${filters.forecastCategory.replace("_", " ")}` });
    if (filters.outcomeReasonId) {
      const reason = ((optionsQuery.data?.options?.lostReasons ?? []) as Array<{ id: string; name: string }>).find((row) => String(row.id) === filters.outcomeReasonId);
      active.push({ id: "outcomeReasonId", label: filters.outcomeReasonId === "none" ? "Reason: none recorded" : `Reason: ${reason?.name ?? "a retired reason"}` });
    }
    if (filters.stageId) active.push({ id: "stageId", label: "Stage filter" });
    if (filters.stalled) active.push({ id: "stalled", label: "Stalled" });
    if (filters.search) active.push({ id: "search", label: `Search: ${filters.search}` });
    return active;
  }, [filters, ownerOptions, optionsQuery.data]);

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageIndex = Math.floor((filters.offset ?? 0) / PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(filters.search || filters.stageId || (filters.status && filters.status !== "open"));
  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const hasExplicitFilters = searchParams.toString().length > 0;
  const filtersWithoutPaging: OpportunityListFilters = useMemo(() => {
    const rest = { ...filters };
    delete rest.limit;
    delete rest.offset;
    return rest;
  }, [filters]);

  // F029 — every row runs through the single-record rules; the summary
  // names what will not (or did not) change and why. Preview writes nothing.
  function describeBulk(result: OpportunityBulkSyncResult) {
    const done = result.preview ? `${result.would_apply} of ${result.requested} would be updated` : `${result.applied} of ${result.requested} updated`;
    const parts = [
      result.conflict ? `${result.conflict} changed since you selected them` : "",
      result.skipped ? `${result.skipped} not available to you` : "",
      result.failed ? `${result.failed} refused` : "",
    ].filter(Boolean);
    const problems = result.items
      .filter((item) => item.status !== "applied" && item.status !== "would_apply")
      .slice(0, 5)
      .map((item) => `${item.name ?? item.id.slice(0, 8)}: ${item.message ?? item.status}`);
    return [`${result.preview ? "Preview: " : ""}${done}${parts.length ? `; ${parts.join(", ")}` : ""}.`, ...problems].join(" ");
  }

  async function runBulkUpdate(preview = false) {
    if (!bulkValue) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const result = await bulkUpdateOpportunitiesRequest(
        selectedIds,
        { [bulkField]: bulkValue },
        `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        preview,
      );
      if (result.mode === "synchronous") {
        setBulkResult(describeBulk(result));
        if (result.preview) return;
      } else {
        setBulkResult(`Large selection queued as background job ${result.job.id} (status: ${result.job.status}).`);
      }
    } catch (error) {
      setBulkResult(error instanceof OpportunityApiError ? error.message : "The bulk update could not be completed.");
    } finally {
      setBulkBusy(false);
    }
    setSelection({});
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunities") });
  }

  const columns: ColumnDef<Opportunity, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Opportunity", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "account", header: "Account", accessorFn: (row) => row.partyName || "No account" },
      { id: "stage", header: "Stage", accessorFn: (row) => row.stageName || "" },
      {
        id: "amount",
        header: "Amount",
        accessorFn: (row) => (row.amount !== null ? formatMoney(row.currencyCode, row.amount) : "Not set"),
      },
      { id: "probability", header: "Probability", accessorFn: (row) => (row.probability !== null ? `${Number(row.probability)}%` : "Not set") },
      { id: "owner", header: "Owner", accessorFn: (row) => row.ownerName || "Unassigned" },
      {
        id: "expectedCloseDate",
        header: "Expected close",
        accessorFn: (row) => (row.expectedCloseDate ? dateFormatter.format(new Date(row.expectedCloseDate)) : "Not set"),
        cell: ({ row }) => {
          const d = row.original.expectedCloseDate;
          if (!d) return <span className="text-text-muted">Not set</span>;
          return row.original.status === "open" && dueState(d) === "overdue" ? <span className="font-medium text-danger">{`⚠ ${dateFormatter.format(new Date(d))} (overdue)`}</span> : <span>{dateFormatter.format(new Date(d))}</span>;
        },
      },
    ],
    [],
  );

  const gridState = query.isLoading
    ? "loading"
    : query.isError && query.error instanceof OpportunityApiError && query.error.status === 403
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
        title: "Opportunities",
        description: "Open commercial pursuits and their pipeline progress.",
        primaryAction: canManage ? (
          <Button variant="primary" onPress={() => router.push("/crm/opportunities/new")}>
            <Plus className="size-4" aria-hidden="true" />
            New opportunity
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField
              aria-label="Search opportunities"
              placeholder="Search by name…"
              value={searchInput}
              onChange={setSearchInput}
              onKeyDown={(event) => event.key === "Enter" && updateFilter("search", searchInput || undefined)}
              className="min-w-[240px]"
            />
            <Select aria-label="Stage" size="compact" options={stageOptions} selectedKey={filters.stageId ?? "all"} onSelectionChange={(key) => updateFilter("stageId", key === "all" ? undefined : String(key))} />
            <Select
              aria-label="Status"
              size="compact"
              options={[
                { value: "open", label: "Open" },
                { value: "won", label: "Won" },
                { value: "lost", label: "Lost" },
                { value: "closed", label: "Won or lost" },
                { value: "all", label: "All" },
              ]}
              selectedKey={filters.status ?? "open"}
              onSelectionChange={(key) => updateFilter("status", String(key))}
            />
          </>
        ),
        end: (
          <>
            <ViewToggle options={[{ id: "table", label: "Table", icon: <Table2 className="size-3.5" aria-hidden="true" /> }, { id: "board", label: "Board", icon: <Kanban className="size-3.5" aria-hidden="true" /> }]} value="table" onChange={(id) => { if (id === "board") router.push("/crm/pipeline"); }} />
            <Button variant="secondary" onPress={() => updateFilter("search", searchInput || undefined)}>Search</Button>
          </>
        ),
      }}
      filterBar={{
        filters: activeFilters,
        onRemove: (id) => setFilters((current) => (id === "closed" ? { ...current, closedFrom: undefined, closedTo: undefined, offset: 0 } : id === "expectedClose" ? { ...current, expectedCloseFrom: undefined, expectedCloseTo: undefined, offset: 0 } : { ...current, [id]: undefined, offset: 0 })),
        onClearAll: activeFilters.length > 0 ? () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0, status: "open" }); } : undefined,
      }}
      bulkActionBar={{
        selectedCount: selectedIds.length,
        onClearSelection: () => setSelection({}),
        actions: (
          <>
            <Select aria-label="Bulk field" size="compact" options={BULK_FIELD_OPTIONS} selectedKey={bulkField} onSelectionChange={(key) => { setBulkField(String(key)); setBulkValue(""); }} />
            {bulkField === "ownerUserId" ? (
              <Select aria-label="New owner" size="compact" options={ownerOptions} selectedKey={bulkValue} onSelectionChange={(key) => setBulkValue(String(key))} placeholder="Choose…" />
            ) : (
              <TextField aria-label="New value" size="compact" placeholder={bulkField === "expectedCloseDate" ? "YYYY-MM-DD" : "Next step"} value={bulkValue} onChange={setBulkValue} className="w-40" />
            )}
            <Button variant="ghost" size="compact" onPress={() => runBulkUpdate(true)} isLoading={bulkBusy} isDisabled={!canManage || !bulkValue || selectedIds.length > 200}>
              Preview
            </Button>
            <Button variant="secondary" size="compact" onPress={() => runBulkUpdate(false)} isLoading={bulkBusy} isDisabled={!canManage || !bulkValue}>
              Apply to selected
            </Button>
          </>
        ),
      }}
    >
      <SavedViewsBar
        resource="opportunities"
        baseFilters={{ limit: PAGE_SIZE, offset: 0, status: "open" } as OpportunityListFilters}
        currentFilters={filtersWithoutPaging}
        hasExplicitFilters={hasExplicitFilters}
        onApply={(next) => setFilters(next)}
      />
      {bulkResult && (
        <p role="status" className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2 text-sm text-text">
          {bulkResult}
        </p>
      )}
      <EnterpriseDataGrid<Opportunity>
        aria-label="Opportunities"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={gridState}
        loadingContent={<LoadingState label="Loading opportunities" onRetry={() => query.refetch()} />}
        emptyContent={<NoResultsState title="No opportunities yet" action={canManage ? { label: "New opportunity", onPress: () => router.push("/crm/opportunities/new") } : undefined} />}
        noResultsContent={<NoResultsState title="No opportunities match these filters" action={{ label: "Clear filters", onPress: () => { setSearchInput(""); setFilters({ limit: PAGE_SIZE, offset: 0, status: "open" }); } }} />}
        errorContent={<ErrorState title="Could not load opportunities" action={{ label: "Retry", onPress: () => query.refetch() }} />}
        permissionDeniedContent={<PermissionState title="You don't have access to Opportunities" />}
        enableRowSelection
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        pageIndex={pageIndex}
        pageSize={PAGE_SIZE}
        pageCount={pageCount}
        totalRowCount={total}
        onPageChange={(nextIndex) => setFilters((current) => ({ ...current, offset: nextIndex * PAGE_SIZE }))}
        onRowClick={(row) => router.push(`/crm/opportunities/${row.id}`)}
        renderMobileCard={(row) => (
          <button type="button" onClick={() => router.push(`/crm/opportunities/${row.id}`)} className="flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-text">{row.name}</span>
              <StatusBadge tone={statusTone[row.status] ?? "neutral"}>{row.status}</StatusBadge>
            </div>
            <span className="text-xs text-text-muted">{row.stageName || "—"} · {row.amount !== null ? money(row.currencyCode, row.amount) : "—"}</span>
          </button>
        )}
      />
    </EnterpriseListPage>
  );
}
