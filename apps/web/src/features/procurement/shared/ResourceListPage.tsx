"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { Button, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, type ActiveFilter } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError } from "@/features/procurement/shared/http";
import { listRecords, type ProcRecord } from "@/features/procurement/shared/api";
import { statusLabel } from "@/features/procurement/shared/format";
import { useCan } from "@/features/procurement/shared/use-can";
import { useLookup, type Lookup } from "@/features/procurement/shared/use-lookup";

export type ListConfig = {
  resource: string;
  title: string;
  description: string;
  searchLabel: string;
  statuses: string[];
  columns: (lookup: Lookup) => ColumnDef<ProcRecord, unknown>[];
  detailHref?: (record: ProcRecord) => string;
  newHref?: string;
  newLabel?: string;
  createPermission?: string;
  emptyTitle: string;
  emptyDescription: string;
  // Fixed filter applied on top of the user's (e.g. show only one kind of record).
  baseFilter?: (record: ProcRecord) => boolean;
};

// One list screen for every Procurement resource. Search and status are applied
// server-side; the domain scopes rows to the caller's company and permission.
export function ResourceListPage({ config }: { config: ListConfig }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = useCan();
  const lookup = useLookup();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "procurement", config.resource, status, search),
    queryFn: () => listRecords(config.resource, { status: status === "all" ? undefined : status, search: search.trim() || undefined, limit: 200 }),
    placeholderData: (previous) => previous,
  });
  const rows = (query.data?.rows ?? []).filter((row) => (config.baseFilter ? config.baseFilter(row) : true));
  const denied = query.isError && query.error instanceof ProcApiError && query.error.status === 403;

  const filters: ActiveFilter[] = [];
  if (status !== "all") filters.push({ id: "status", label: `Status: ${statusLabel(status)}` });
  if (search.trim()) filters.push({ id: "search", label: `Search: ${search.trim()}` });
  function clear() {
    setStatus("all");
    setSearch("");
  }
  if (denied) return <PermissionState title="You don't have access to Procurement" description="Ask an administrator to grant procurement.view." />;

  const canCreate = Boolean(config.newHref) && can(config.createPermission);
  return (
    <EnterpriseListPage
      header={{
        title: config.title,
        description: config.description,
        primaryAction: canCreate ? (
          <Button variant="primary" onPress={() => router.push(config.newHref!)}>
            <Plus className="size-4" aria-hidden="true" />
            {config.newLabel ?? "New"}
          </Button>
        ) : undefined,
      }}
      actionBar={{
        start: (
          <>
            <SearchField aria-label={config.searchLabel} placeholder="Search…" value={search} onChange={setSearch} className="min-w-[280px]" />
            <Select aria-label="Status" size="compact" options={[{ value: "all", label: "Any status" }, ...config.statuses.map((s) => ({ value: s, label: statusLabel(s) }))]} selectedKey={status} onSelectionChange={(key) => setStatus(String(key ?? "all"))} />
          </>
        ),
      }}
      filterBar={{ filters, onRemove: (id) => (id === "status" ? setStatus("all") : setSearch("")), onClearAll: filters.length ? clear : undefined }}
    >
      <EnterpriseDataGrid<ProcRecord>
        aria-label={config.title}
        columns={config.columns(lookup)}
        data={rows}
        getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 && filters.length ? "no-results" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
        emptyContent={<NoResultsState title={config.emptyTitle} description={config.emptyDescription} action={canCreate ? { label: config.newLabel ?? "New", onPress: () => router.push(config.newHref!) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try clearing a filter or broadening your search." action={{ label: "Clear filters", onPress: clear }} />}
        errorContent={<ErrorState title={`Could not load ${config.title.toLowerCase()}`} action={{ label: "Retry", onPress: () => query.refetch() }} />}
        onRowClick={config.detailHref ? (row) => router.push(config.detailHref!(row)) : undefined}
      />
    </EnterpriseListPage>
  );
}
