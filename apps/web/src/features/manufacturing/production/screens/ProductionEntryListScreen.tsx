"use client";

// Production entries: every report of output with its order, batch, how it splits and whether it is inspected and received. Views by state
// and by what waits (inspection, receipt); search by entry, order, batch or product. A row opens the entry.
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

import { MO_BASE, errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { ENTRY_TONE, INSPECTION_LABEL, PE_BASE, RECEIPT_LABEL, listEntries, type EntryRow } from "../api/pp-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "pending", label: "Awaiting inspection" }, { id: "receivable", label: "Accepted, not received" }, { id: "DRAFT", label: "Drafts" },
  { id: "REPORTED", label: "Reported" }, { id: "CANCELLED", label: "Cancelled" }];

export function ProductionEntryListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: ["DRAFT", "REPORTED", "CANCELLED"].includes(view) ? view : undefined, inspection: view === "pending" ? "PENDING" : undefined, receivable: view === "receivable" ? "true" : undefined,
    search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "production-entries", filters), queryFn: () => listEntries(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<EntryRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Entry", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "order", header: "Order", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.orderNumber}</span><span className="text-xs text-text-muted">{row.original.product}</span></span> },
    { id: "batch", accessorKey: "batch", header: "Batch" },
    { id: "split", header: "Reported → accepted / rejected / awaiting", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.reported)} → {qty(row.original.accepted)} / {qty(row.original.rejected)} / {qty(row.original.pending)}</span> },
    { id: "received", header: "Received", cell: ({ row }) => `${qty(row.original.received)} · ${RECEIPT_LABEL[row.original.receipt] ?? row.original.receipt}` },
    { id: "inspection", header: "Inspection", cell: ({ row }) => INSPECTION_LABEL[row.original.inspection] ?? row.original.inspection },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={ENTRY_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
    { id: "when", header: "Produced", cell: ({ row }) => (row.original.producedAt ? formatDateTime(row.original.producedAt) : "") },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to production" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Production Entries", description: "Output reported against manufacturing orders, batch by batch — what waits for inspection, what is accepted and what is in stock. Record output from an order's Production tab." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search production entries" placeholder="Entry, order, batch or product" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<EntryRow>
        aria-label="Production entries" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading production entries" rows={8} />}
        errorContent={<ErrorState title="Could not load production entries" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No output reported yet" description="Open an order in production and record output on its Production tab." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${PE_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={ENTRY_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.orderNumber} · {row.batch} · {qty(row.reported)} reported</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
