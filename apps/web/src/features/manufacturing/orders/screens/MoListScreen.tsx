"use client";

// Manufacturing Orders: every order with its state, product, progress (accepted against plan) and schedule. Views by state; search by
// number, product or source; filter by priority. A row opens the order.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDate } from "@/shared/format/human";
import { useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { MO_BASE, STATUS_TONE, errorMessage, errorStatus, listOrders, qty, type MoListRow } from "../api/mo-api";

const VIEWS = [{ id: "OPEN", label: "Open" }, { id: "DRAFT", label: "Draft" }, { id: "AWAITING_APPROVAL", label: "Awaiting approval" }, { id: "RELEASED", label: "Released" },
  { id: "IN_PROGRESS", label: "In progress" }, { id: "ON_HOLD", label: "On hold" }, { id: "COMPLETED", label: "Completed" }, { id: "CANCELLED", label: "Cancelled" }, { id: "all", label: "All" }];

export function MoListScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);
  const [view, setView] = useState("OPEN");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [priority, setPriority] = useState("any");
  const filters = { status: view, search: submitted || undefined, priority: priority === "any" ? undefined : priority };
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "manufacturing", "orders", filters), queryFn: () => listOrders(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const paged = usePagedRows(rows);
  const columns = useMemo<ColumnDef<MoListRow, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Order", enableHiding: false, cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "product", header: "Product", cell: ({ row }) => <span className="flex flex-col"><span>{row.original.finishedItem.name}</span><span className="text-xs text-text-muted">{row.original.finishedItem.code}{row.original.bom ? ` · ${row.original.bom}` : ""}</span></span> },
    { id: "progress", header: "Accepted / planned", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums"><span>{qty(row.original.accepted)} / {qty(row.original.planned)} {row.original.baseUom ?? ""}</span>
        <span className="text-xs text-text-muted">{row.original.progressPct ?? "0"}%{Number(row.original.pendingInspection) ? ` · ${qty(row.original.pendingInspection)} awaiting inspection` : ""}</span></span>
    ) },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
    { id: "priority", accessorKey: "priority", header: "Priority", cell: ({ row }) => (row.original.priority === "HIGH" ? <StatusBadge tone="warning">High</StatusBadge> : row.original.priority === "LOW" ? "Low" : "Normal") },
    { id: "schedule", header: "Schedule", cell: ({ row }) => <span className={row.original.overdue ? "text-danger" : ""}>{formatDate(row.original.plannedStartAt)} → {formatDate(row.original.plannedEndAt)}{row.original.overdue ? " (late)" : ""}</span> },
    { id: "source", header: "Demand", cell: ({ row }) => row.original.source ?? (row.original.sourceType === "MANUAL" ? "Manual" : row.original.sourceType.toLowerCase().replace("_", " ")) },
    { id: "warehouses", header: "Materials → goods", cell: ({ row }) => `${row.original.materialWarehouse} → ${row.original.finishedGoodsWarehouse}` },
  ], []);
  if (list.isError && errorStatus(list.error) === 403) return <PermissionState title="You don't have access to manufacturing orders" description="Ask an administrator for access." />;
  return (
    <EnterpriseListPage
      header={{
        title: "Manufacturing Orders",
        description: "What to make, from which approved recipe, and how it is going: materials reserved and issued, output accepted and received. Stock moves through Inventory; cost through Finance.",
        primaryAction: can("manufacturing.mo.create") ? <LinkButton href={`${MO_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New order</LinkButton> : undefined,
      }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search orders" placeholder="Order, product or source" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="Priority" size="compact" selectedKey={priority} onSelectionChange={(key) => { setPriority(String(key)); paged.resetPage(); }}
            options={[{ value: "any", label: "Any priority" }, { value: "HIGH", label: "High" }, { value: "NORMAL", label: "Normal" }, { value: "LOW", label: "Low" }]} />
        </>
      ) }}
    >
      <EnterpriseDataGrid<MoListRow>
        aria-label="Manufacturing orders" columns={columns} data={paged.pageRows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (submitted || view !== "OPEN" || priority !== "any" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading manufacturing orders" rows={8} />}
        errorContent={<ErrorState title="Could not load manufacturing orders" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No open manufacturing orders" description="Create an order to make a product from its approved bill of materials."
          action={can("manufacturing.mo.create") ? { label: "New order", onPress: () => router.push(`${MO_BASE}/new`) } : undefined} />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try another view, search or priority." />}
        {...paged.grid}
        onRowClick={(row) => router.push(`${MO_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.statusLabel}</StatusBadge></span>
            <span className="text-xs text-text-muted">{row.finishedItem.code} · {qty(row.accepted)}/{qty(row.planned)} · due {formatDate(row.plannedEndAt)}</span>
          </div>
        )}
      />
    </EnterpriseListPage>
  );
}
