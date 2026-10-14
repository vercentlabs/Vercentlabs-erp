"use client";

// Finished-Goods Receipts: every receipt note with its order, product, quantity, destination and state. Views by state (and reversed); search
// by note, order, product, lot or serial. A row opens the note. New receipts start from a manufacturing order (its Production tab), so the
// output comes from what the order has accepted and not yet received.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, errorMessage, errorStatus, inr, qty } from "@/features/manufacturing/orders/api/mo-api";
import { FGR_BASE, RECEIPT_TONE, listReceipts, type ReceiptListRow } from "../api/fgr-api";

const VIEWS = [{ id: "all", label: "All" }, { id: "DRAFT", label: "Draft" }, { id: "PENDING_APPROVAL", label: "Pending approval" }, { id: "POSTED", label: "Posted" },
  { id: "REVERSED", label: "Reversed" }, { id: "RECOVERY_REQUIRED", label: "Recovery required" }, { id: "CANCELLED", label: "Cancelled" }];

export function FinishedGoodsReceiptListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const filters = { status: view === "all" || view === "REVERSED" ? undefined : view, correction: view === "REVERSED" ? "REVERSED" : undefined, search: submitted || undefined };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "finished-goods-receipts", filters), queryFn: () => listReceipts(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<ReceiptListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Receipt", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "order", header: "Manufacturing order", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.orderNumber}</span><span className="text-xs text-text-muted">{row.original.item}</span></span> },
    { id: "quantity", header: "Quantity", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantity)} {row.original.uom}</span> },
    { id: "source", header: "From entries", cell: ({ row }) => <span className="flex flex-col text-sm"><span>{row.original.entries ?? "—"}</span>{row.original.lots && <span className="text-xs text-text-muted">Lot {row.original.lots}</span>}</span> },
    { id: "to", header: "Into", cell: ({ row }) => `${row.original.warehouse}${row.original.location ? ` / ${row.original.location}` : ""}` },
    { id: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        <StatusBadge tone={RECEIPT_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge>
        {row.original.correctionStatus === "REVERSED" && <StatusBadge tone="neutral">Reversed</StatusBadge>}
        {row.original.correctionStatus === "REQUESTED" && <StatusBadge tone="warning">Correction requested</StatusBadge>}
      </span>
    ) },
    { id: "when", header: "Received", cell: ({ row }) => (row.original.postedAt ? <span className="flex flex-col"><span>{formatDateTime(row.original.postedAt)}</span><span className="text-xs text-text-muted">{row.original.receivedBy}</span></span>
      : <span className="text-text-muted">Created {formatDateTime(row.original.createdAt)}</span>) },
    { id: "cost", header: "Value", cell: ({ row }) => (row.original.totalCost === null ? "" : inr(row.original.totalCost)) },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to finished-goods receipts" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Finished-Goods Receipts", description: "Accepted production received into stock, receipt by receipt: which order and batch it came from, how much, into which warehouse and lot. Start a receipt from a manufacturing order's Production tab.",
        primaryAction: <Button variant="secondary" onPress={() => router.push("/manufacturing/finished-goods-receipt-reports?report=exceptions")}>Exceptions</Button> }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: <SearchField aria-label="Search finished-goods receipts" placeholder="Receipt, order, product, lot or serial" className="w-full sm:w-80" value={search} onChange={setSearch} /> }}
    >
      <EnterpriseDataGrid<ReceiptListRow>
        aria-label="Finished-goods receipts" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading finished-goods receipts" rows={8} />}
        errorContent={<ErrorState title="Could not load finished-goods receipts" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No finished-goods receipts yet" description="Open a manufacturing order in production and use Receive finished goods on its Production tab." action={{ label: "Manufacturing orders", onPress: () => router.push(MO_BASE) }} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view or search." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${FGR_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={RECEIPT_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.orderNumber} · {qty(row.quantity)} {row.uom} into {row.warehouse}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
