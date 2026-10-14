"use client";

// Sales demand: confirmed customer orders for manufactured products, with what covers them — stock reserved, production assigned, drafts
// proposed — and what is still uncovered. Views by planning status; search by order, customer or product; filter by BOM readiness. A row
// opens the demand review, where a draft manufacturing order is created.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { FactList } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, qty } from "@/features/manufacturing/orders/api/mo-api";
import { DEMAND_BASE, DEMAND_TONE, listDemand, type Demand } from "../api/demand-api";

const VIEWS = [{ id: "OPEN", label: "Open" }, { id: "NEEDS_REVIEW", label: "Needs review" }, { id: "PARTIALLY_COVERED", label: "Partially covered" }, { id: "IN_PRODUCTION", label: "In production" },
  { id: "READY_FOR_FULFILLMENT", label: "Ready to ship" }, { id: "ON_HOLD", label: "On hold" }, { id: "FULFILLED", label: "Fulfilled" }, { id: "CANCELLED", label: "Cancelled" }, { id: "all", label: "All" }];
const BOM_LABEL = { EFFECTIVE: "Ready", NOT_EFFECTIVE: "No revision in use", MISSING: "No BOM" } as const;

export function SalesDemandListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [view, setView] = useState("OPEN");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [bom, setBom] = useState("any");
  const filters = { status: view, search: submitted || undefined, bom: bom === "any" ? undefined : bom };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "sales-demand", filters), queryFn: () => listDemand(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.demands ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<Demand, unknown>[]>(() => [
    { id: "order", header: "Sales order", enableHiding: false, cell: ({ row }) => <span className="flex flex-col"><span className="font-medium text-text">{row.original.salesOrder.number}</span><span className="text-xs text-text-muted">{row.original.salesOrder.customer}</span></span> },
    { id: "product", header: "Product", cell: ({ row }) => `${row.original.item.code} · ${row.original.item.name}` },
    { id: "ordered", header: "Ordered", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantities.ordered)}</span> },
    { id: "delivered", header: "Delivered", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantities.delivered)}</span> },
    { id: "stock", header: "Stock reserved", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantities.reservedStock)}</span> },
    { id: "production", header: "In production", cell: ({ row }) => <span className="tabular-nums">{qty(row.original.quantities.inProduction)}{Number(row.original.quantities.proposed) ? ` (+${qty(row.original.quantities.proposed)} draft)` : ""}</span> },
    { id: "uncovered", header: "Uncovered", cell: ({ row }) => <span className={`tabular-nums ${Number(row.original.quantities.uncovered) ? "font-medium text-danger" : ""}`}>{qty(row.original.quantities.uncovered)}</span> },
    { id: "required", header: "Required", cell: ({ row }) => (row.original.requiredDate ? formatDate(row.original.requiredDate) : "—") },
    { id: "bom", header: "BOM", cell: ({ row }) => <StatusBadge tone={row.original.bom.status === "EFFECTIVE" ? "success" : "danger"}>{BOM_LABEL[row.original.bom.status]}</StatusBadge> },
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex flex-col gap-1"><StatusBadge tone={DEMAND_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge>
      {row.original.warnings.length > 0 && <span className="text-xs text-warning">{row.original.warnings.length} warning{row.original.warnings.length > 1 ? "s" : ""}</span>}</span> },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to manufacturing demand" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{ title: "Sales Demand", description: "Confirmed customer orders for manufactured products: what stock and production already cover, and what still needs a production decision. Sales stays the authority on what was ordered and delivered." }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search demand" placeholder="Order, customer or product" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="BOM" size="compact" selectedKey={bom} onSelectionChange={(key) => { setBom(String(key)); paged.resetPage(); }}
            options={[{ value: "any", label: "Any BOM state" }, { value: "EFFECTIVE", label: "BOM ready" }, { value: "NOT_EFFECTIVE", label: "No revision in use" }, { value: "MISSING", label: "No BOM" }]} />
        </>
      ) }}
    >
      {list.data && <FactList items={[["Lines", String(list.data.totals.lines)], ["Uncovered", qty(list.data.totals.uncovered)], ["Recommended to make", qty(list.data.totals.recommended)]]} />}
      <EnterpriseDataGrid<Demand>
        aria-label="Sales demand" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "OPEN" || bom !== "any" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading demand" rows={8} />}
        errorContent={<ErrorState title="Could not load demand" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No open customer demand" description="Confirmed Sales Orders for products with a BOM (or a manufacturing policy) appear here." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or BOM state." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${DEMAND_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.salesOrder.number}</span><StatusBadge tone={DEMAND_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.item.code} · uncovered {qty(row.quantities.uncovered)} · {row.requiredDate ? formatDate(row.requiredDate) : "no date"}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
