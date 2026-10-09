"use client";

// The Alerts view of Replenishment: low-stock alerts (out of stock, replenishment required, low stock covered by incoming) of the warehouses
// you can see, urgency first, each explained by its live figures. Acknowledge one or many; act from the alert. Alerts resolve by themselves.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { Badge, Button, EmptyState, EnterpriseDataGrid, ErrorState, MetricCard, NoResultsState, SearchField, Select, StatusBadge, buttonVariants } from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { formatDate } from "@/shared/format/human";
import { ListToolbar, filterBarOf, optionLabel, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  ALERTS_BASE, ALERT_VIEWS, SEVERITY_TONE, acknowledgeAlerts, alertExportUrl, errorMessage, listAlerts, type LowStockAlert, type Options,
} from "../api/replenishment-api";

const ANY = "any";
const INCOMING: Record<string, string> = { yes: "Incoming exists", no: "Nothing incoming" };
const AGES: Record<string, string> = { "1": "Older than a day", "3": "Older than 3 days", "7": "Older than a week" };

export function age(since: string) {
  const hours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}

export function AlertBadges({ alert }: { alert: Pick<LowStockAlert, "severity" | "conditionLabel" | "negativeStock" | "overdueIncoming" | "status"> }) {
  return (
    <span className="flex flex-wrap gap-1">
      <StatusBadge tone={SEVERITY_TONE[alert.severity]}>{alert.conditionLabel}</StatusBadge>
      {alert.negativeStock && <Badge tone="danger">Negative stock</Badge>}
      {alert.overdueIncoming && <Badge tone="warning">Incoming overdue</Badge>}
      {alert.status === "acknowledged" && <Badge tone="neutral">Acknowledged</Badge>}
      {alert.status === "resolved" && <Badge tone="success">Resolved</Badge>}
    </span>
  );
}

const qty = (value: number, uom?: string) => <span className="tabular-nums">{quantity(value, uom)}</span>;

export function AlertsPanel({ options }: { options: Options | undefined }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const client = useQueryClient();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("alerts") ?? "active");
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? ANY);
  const [categoryId, setCategoryId] = useState(ANY);
  const [incoming, setIncoming] = useState(ANY);
  const [minAgeDays, setMinAgeDays] = useState(ANY);
  const [sort, setSort] = useState("urgency");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = useMemo(() => ({ view, warehouseId: pick(warehouseId), categoryId: pick(categoryId), incoming: pick(incoming), minAgeDays: pick(minAgeDays), sort,
    search: submitted || undefined }), [view, warehouseId, categoryId, incoming, minAgeDays, sort, submitted]);
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "alerts", filters), queryFn: () => listAlerts(filters), placeholderData: (previous) => previous });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  // Only open alerts can be acknowledged; a selected row that is no longer open is ignored.
  const selected = rows.filter((row) => selection[row.id] && row.status === "open").map((row) => row.id);
  const acknowledge = useMutation({
    mutationFn: () => acknowledgeAlerts(selected),
    onSuccess: () => { setSelection({}); void client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "replenishment") }); },
  });
  const can = list.data?.capabilities;
  const counts = list.data?.counts;

  const columns = useMemo(() => ([
    { id: "severity", header: "Severity", cell: ({ row }) => <AlertBadges alert={row.original} /> },
    { id: "sku", header: "SKU", cell: ({ row }) => <Link className="font-medium text-brand hover:underline" href={`${ALERTS_BASE}/${row.original.id}`} onClick={(event) => event.stopPropagation()}>{row.original.sku}</Link> },
    { id: "itemName", header: "Item", cell: ({ row }) => row.original.itemName },
    { id: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "eligible", header: "Eligible", cell: ({ row }) => qty((row.original.live ?? row.original.detected).eligibleOnHand, row.original.baseUom ?? undefined) },
    { id: "demand", header: "Demand", cell: ({ row }) => qty((row.original.live ?? row.original.detected).firmDemand) },
    { id: "incoming", header: "Incoming", cell: ({ row }) => qty((row.original.live ?? row.original.detected).firmIncoming) },
    { id: "projected", header: "Projected", cell: ({ row }) => qty((row.original.live ?? row.original.detected).projectedPosition) },
    { id: "reorder", header: "Reorder", cell: ({ row }) => qty((row.original.live ?? row.original.detected).reorderLevel) },
    { id: "suggested", header: "Suggested", cell: ({ row }) => {
      const suggested = (row.original.live ?? row.original.detected).suggested;
      return <span className="font-medium tabular-nums">{suggested > 0 ? quantity(suggested) : "—"}</span>;
    } },
    { id: "nextIncoming", header: "Next incoming", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.live?.nextIncoming ? formatDate(row.original.live.nextIncoming) : ""}</span> },
    { id: "since", header: "Since", cell: ({ row }) => (
      <span className="whitespace-nowrap">{row.original.status === "resolved" ? `Resolved ${row.original.resolvedAt ? formatDate(row.original.resolvedAt) : ""}` : age(row.original.firstDetectedAt)}</span>
    ) },
  ] satisfies ColumnDef<LowStockAlert, unknown>[]).map((column): ColumnDef<LowStockAlert, unknown> => ({ ...column, enableSorting: false })), []);

  const filterBar = filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(options?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
    { id: "category", active: categoryId !== ANY, label: `Category: ${optionLabel(options?.categories, categoryId)}`, clear: () => setCategoryId(ANY) },
    { id: "incoming", active: incoming !== ANY, label: INCOMING[incoming] ?? incoming, clear: () => setIncoming(ANY) },
    { id: "age", active: minAgeDays !== ANY, label: AGES[minAgeDays] ?? minAgeDays, clear: () => setMinAgeDays(ANY) },
  ]);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "active";

  return (
    <div className="flex flex-col gap-3">
      {counts && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" className="text-left" onClick={() => setView("out_of_stock")}><MetricCard label="Out of stock" value={counts.outOfStock} /></button>
          <button type="button" className="text-left" onClick={() => setView("replenishment_required")}><MetricCard label="Replenishment required" value={counts.replenishmentRequired} /></button>
          <button type="button" className="text-left" onClick={() => setView("low_stock")}><MetricCard label="Low stock — covered" value={counts.lowStock} /></button>
          <Link href="/inventory/negative-stock" className="text-left"><MetricCard label="Negative stock (its own exceptions)" value={counts.negativeStock} /></Link>
        </div>
      )}
      <ListToolbar
        savedViews={{ views: ALERT_VIEWS.map((entry) => ({ id: entry.id, label: entry.label })), activeViewId: view, onSelect: (id) => { setView(id); setSelection({}); } }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search alerts" placeholder="SKU, item or warehouse" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
                options={[{ value: ANY, label: "All warehouses" }, ...(options?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
              <Select aria-label="Category" size="compact" selectedKey={categoryId} onSelectionChange={(key) => setCategoryId(String(key))}
                options={[{ value: ANY, label: "All categories" }, ...(options?.categories ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
              <Select aria-label="Incoming" size="compact" selectedKey={incoming} onSelectionChange={(key) => setIncoming(String(key))}
                options={[{ value: ANY, label: "With or without incoming" }, ...Object.entries(INCOMING).map(([value, label]) => ({ value, label }))]} />
              <Select aria-label="Age" size="compact" selectedKey={minAgeDays} onSelectionChange={(key) => setMinAgeDays(String(key))}
                options={[{ value: ANY, label: "Any age" }, ...Object.entries(AGES).map(([value, label]) => ({ value, label }))]} />
            </>
          ),
          end: (
            <>
              <Select aria-label="Sort" size="compact" selectedKey={sort} onSelectionChange={(key) => setSort(String(key))}
                options={[{ value: "urgency", label: "Most urgent first" }, { value: "age", label: "Oldest first" }, { value: "shortage", label: "Largest requirement first" }]} />
              {can?.export && <a className={buttonVariants({ variant: "outline", size: "compact" })} href={alertExportUrl(filters, "csv")} download><Download className="size-4" aria-hidden="true" />Export</a>}
            </>
          ),
        }}
        bulkActionBar={can?.acknowledge ? {
          selectedCount: selected.length,
          onClearSelection: () => setSelection({}),
          actions: <Button variant="secondary" size="compact" isLoading={acknowledge.isPending} onPress={() => acknowledge.mutate()}>Acknowledge</Button>,
        } : undefined}
        filterBar={filterBar}
      />
      {acknowledge.isError && <Notice>{errorMessage(acknowledge.error)}</Notice>}
      <EnterpriseDataGrid<LowStockAlert>
        aria-label="Low-stock alerts"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading alerts" rows={8} />}
        errorContent={<ErrorState title="Could not load alerts" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No alerts" description="Alerts come from enabled reorder rules: an item with no eligible stock, one that needs replenishing, or one that is low but covered by confirmed incoming." />}
        noResultsContent={<NoResultsState title="No alerts match" description="Try a different view, search or filter." />}
        enableRowSelection={Boolean(can?.acknowledge)}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        onRowClick={(row) => router.push(`${ALERTS_BASE}/${row.id}`)}
        renderMobileCard={(row) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.sku} · {row.warehouse}</span><AlertBadges alert={row} /></span>
            <span className="text-xs text-text-muted">Projected {quantity((row.live ?? row.detected).projectedPosition)} · since {age(row.firstDetectedAt)}</span>
          </div>
        )}
      />
    </div>
  );
}
