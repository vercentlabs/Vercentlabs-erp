"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Users } from "lucide-react";
import {
  Badge,
  Button,
  EnterpriseDataGrid,
  EnterpriseListPage,
  ErrorState,
  NoResultsState,
  PermissionState,
  SearchField,
  Select,
  StatusBadge,
  type ActiveFilter,
  type SelectOption,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { archiveLead, LeadApiError, listLeads } from "../api/leads-api";
import type { Lead, LeadListFilters } from "../types";

const PAGE_SIZE = 25;

const PRIORITY_OPTIONS: SelectOption[] = [
  { value: "all", label: "All priorities" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const FOLLOWUP_OPTIONS: SelectOption[] = [
  { value: "all", label: "Any follow-up" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "none", label: "No follow-up set" },
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

export function LeadListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManageLeads = workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);

  const [filters, setFilters] = useState<LeadListFilters>({ limit: PAGE_SIZE, offset: 0 });
  const [searchInput, setSearchInput] = useState("");
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", filters),
    queryFn: () => listLeads(filters),
    placeholderData: (previous) => previous,
  });

  function updateFilter<K extends keyof LeadListFilters>(key: K, value: LeadListFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value, offset: 0 }));
  }

  function submitSearch() {
    updateFilter("search", searchInput || undefined);
  }

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const active: ActiveFilter[] = [];
    if (filters.priority && filters.priority !== "all") active.push({ id: "priority", label: `Priority: ${filters.priority}` });
    if (filters.followup && filters.followup !== "all") active.push({ id: "followup", label: `Follow-up: ${filters.followup}` });
    if (filters.qualification && filters.qualification !== "all") active.push({ id: "qualification", label: `Qualification: ${filters.qualification}` });
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

  const selectedIds = Object.keys(selection).filter((id) => selection[id]);

  async function bulkArchiveSelected() {
    setBulkBusy(true);
    setBulkError(null);
    const targets = rows.filter((row) => selection[row.id]);
    let succeeded = 0;
    const failures: string[] = [];
    for (const lead of targets) {
      try {
        await archiveLead(lead.id, lead.updatedAt);
        succeeded += 1;
      } catch (error) {
        failures.push(`${lead.fullName || lead.firstName}: ${error instanceof LeadApiError ? error.message : "failed"}`);
      }
    }
    setBulkBusy(false);
    setSelection({});
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
    if (failures.length > 0) {
      setBulkError(
        `${succeeded} of ${targets.length} leads archived. ${failures.length} could not be archived: ${failures.join("; ")}`,
      );
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
        : rows.length === 0 && (filters.search || filters.priority || filters.followup || filters.qualification)
          ? "no-results"
          : rows.length === 0
            ? "empty"
            : "ready";

  return (
    <EnterpriseListPage
      header={{
        title: "Leads",
        description: "Every prospect awaiting qualification, assignment, or follow-up.",
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
              className="min-w-[260px]"
            />
            <Select
              aria-label="Priority"
              size="compact"
              options={PRIORITY_OPTIONS}
              selectedKey={filters.priority ?? "all"}
              onSelectionChange={(key) => updateFilter("priority", key === "all" ? undefined : (String(key) as LeadListFilters["priority"]))}
            />
            <Select
              aria-label="Follow-up"
              size="compact"
              options={FOLLOWUP_OPTIONS}
              selectedKey={filters.followup ?? "all"}
              onSelectionChange={(key) => updateFilter("followup", key === "all" ? undefined : (String(key) as LeadListFilters["followup"]))}
            />
          </>
        ),
        end: <Button variant="secondary" onPress={submitSearch}>Search</Button>,
      }}
      filterBar={{ filters: activeFilters, onRemove: removeFilter, onClearAll: activeFilters.length > 0 ? clearAllFilters : undefined }}
      bulkActionBar={{
        selectedCount: selectedIds.length,
        onClearSelection: () => setSelection({}),
        actions: (
          <Button variant="danger" size="compact" onPress={bulkArchiveSelected} isLoading={bulkBusy} isDisabled={!canManageLeads}>
            Archive selected
          </Button>
        ),
      }}
    >
      {bulkError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          {bulkError}
        </p>
      )}
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
    </EnterpriseListPage>
  );
}
