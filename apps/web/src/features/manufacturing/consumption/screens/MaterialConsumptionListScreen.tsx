"use client";

// Material Consumption: every consumption note with its order, production batch, materials, variance and state. Views by state; search by
// note, order, batch or material. A row opens the note. New notes start from an order in production (its Materials tab).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr } from "@/features/manufacturing/orders/api/mo-api";
import { BAND_TONE, CONSUMPTION_TONE, MC_BASE, listConsumptions, type ConsumptionListRow } from "../api/mc-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "DRAFT", label: "Draft" }, { id: "PENDING_APPROVAL", label: "Pending approval" },
  { id: "POSTED", label: "Posted" }, { id: "RECOVERY_REQUIRED", label: "Recovery required" }, { id: "CANCELLED", label: "Cancelled" }];

export function MaterialConsumptionListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: view === "all" ? undefined : view, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "material-consumptions", filters), queryFn: () => listConsumptions(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<ConsumptionListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Consumption note", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "order", header: "Manufacturing order", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.orderNumber}</span><span className="text-xs text-text-muted">{row.original.finishedItem}</span></span> },
    { id: "materials", header: "Materials", cell: ({ row }) => <span className="text-sm">{row.original.summary ?? "—"}</span> },
    { id: "batch", header: "Production batch", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.batchReference ?? "—"}</span>{row.original.outputBasis ? <span className="text-xs text-text-muted">for {row.original.outputBasis} made</span> : null}</span> },
    { id: "variance", header: "Usage", cell: ({ row }) => (row.original.kind === "CLOSING" ? <StatusBadge tone="neutral">Closing</StatusBadge> : row.original.hasVariance ? <StatusBadge tone={BAND_TONE.WARNING}>Above the BOM</StatusBadge> : "") },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={CONSUMPTION_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
    { id: "when", header: "Posted", cell: ({ row }) => (row.original.postedAt ? <span className="flex flex-col"><span>{formatDateTime(row.original.postedAt)}</span><span className="text-xs text-text-muted">{row.original.postedBy}</span></span>
      : <span className="text-text-muted">Created {formatDateTime(row.original.createdAt)}</span>) },
    { id: "cost", header: "Value", cell: ({ row }) => (row.original.totalCost === null ? "" : row.original.costStatus === "MISSING" ? <StatusBadge tone="danger">Cost missing</StatusBadge> : inr(row.original.totalCost)) },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to material consumption" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Material Consumption", description: "What production actually used of the material issued to it, note by note, against the BOM's expectation — batch and serial units included. Start a note from an order in production (its Materials tab)." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search consumption" placeholder="Note, order, batch or material" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<ConsumptionListRow>
        aria-label="Material consumption" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading consumption notes" rows={8} />}
        errorContent={<ErrorState title="Could not load consumption notes" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No consumption recorded yet" description="Open an order in production and use Record consumption on its Materials tab." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${MC_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={CONSUMPTION_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.orderNumber} · {row.summary}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
