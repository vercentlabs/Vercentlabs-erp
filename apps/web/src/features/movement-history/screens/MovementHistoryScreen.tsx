"use client";

// Inventory Movement History: every posted physical stock movement and internal reclassification, readable — what moved, from where to
// where, why, which document, who, when it took effect and when it was posted. Item Movements (one row per ledger leg, the default) or
// Transaction Events (one row per posting). Reservations and drafts never appear. Read-only: corrections are reversals and new documents.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import {
  Badge, Button, ComboBox, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, MetricCard, PermissionState, SearchField, Select, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { listItems } from "@/features/items/api/items-api";
import { money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  FLAG_LABEL, MOVEMENTS_BASE, errorCode, errorMessage, exportUrl, getEvents, getItemMovements, getOptions, type EventRow, type Flag, type MovementRow,
} from "../api/movement-history-api";

const ANY = "any";
const PAGE = "100";

function ItemFilter({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const items = useQuery({
    queryKey: scopedQueryKey(workspace, "movement-history", "item-picker", text),
    queryFn: () => listItems({ search: text || undefined, inventoryTracked: "true", limit: 20 }),
    staleTime: 15_000,
  });
  return (
    <ComboBox aria-label="Item" placeholder="Item (SKU or name)" className="w-full sm:w-64" options={(items.data?.products ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))}
      selectedKey={value} onSelectionChange={(key) => onChange(key ? String(key) : null)} onInputChange={setText} isLoading={items.isFetching}
      emptyMessage={items.isError ? "Search failed. Try again." : "No matching items"} allowsEmptyCollection />
  );
}

export function Flags({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return <span className="flex flex-wrap gap-1">{flags.map((flag) => (
    <Badge key={flag} tone={flag === "reversed" || flag === "reversal" ? "neutral" : flag === "backdated" ? "info" : "warning"}>{FLAG_LABEL[flag]}</Badge>))}</span>;
}

function DocumentCell({ source, fallback }: { source: { href: string | null; number: string | null; label: string }; fallback: string }) {
  return (
    <span className="flex flex-col whitespace-nowrap">
      {source.href ? <Link className="text-brand hover:underline" href={source.href} onClick={(event) => event.stopPropagation()}>{source.number ?? fallback}</Link> : source.number ?? fallback}
      <span className="text-xs text-text-muted">{source.label}</span>
    </span>
  );
}

export function MovementHistoryScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const initial = (key: string, fallback = ANY) => params.get(key) ?? fallback;
  const [mode, setMode] = useState<"items" | "events">(params.get("mode") === "events" ? "events" : "items");
  const [view, setView] = useState(initial("view", "all"));
  const [itemId, setItemId] = useState<string | null>(params.get("itemId"));
  const [warehouseId, setWarehouseId] = useState(initial("warehouseId"));
  const [locationId, setLocationId] = useState(initial("locationId"));
  const [category, setCategory] = useState(initial("category"));
  const [type, setType] = useState(initial("type"));
  const [disposition, setDisposition] = useState(initial("disposition"));
  const [direction, setDirection] = useState(initial("direction"));
  const [status, setStatus] = useState(initial("status"));
  const [sourceType, setSourceType] = useState(initial("sourceType"));
  const [postedBy, setPostedBy] = useState(initial("postedBy"));
  const [categoryId, setCategoryId] = useState(initial("categoryId"));
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [postedFrom, setPostedFrom] = useState(params.get("postedFrom") ?? "");
  const [postedTo, setPostedTo] = useState(params.get("postedTo") ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const submitted = useDebouncedValue(search);
  const [sort, setSort] = useState(params.get("sort") === "posted" ? "posted" : "effective");
  const [order, setOrder] = useState(params.get("order") === "asc" ? "asc" : "desc");
  const [batchId, setBatchId] = useState(params.get("batchId"));
  const [serialId, setSerialId] = useState(params.get("serialId"));
  const [sourceId, setSourceId] = useState(params.get("sourceId"));
  const [more, setMore] = useState(false);
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = useMemo(() => ({
    view: view === "all" ? undefined : view, itemId: itemId ?? undefined, warehouseId: pick(warehouseId), locationId: pick(locationId), category: pick(category), type: pick(type),
    disposition: pick(disposition), direction: pick(direction), status: pick(status), sourceType: pick(sourceType), postedBy: pick(postedBy), categoryId: pick(categoryId),
    from: from || undefined, to: to || undefined, postedFrom: postedFrom || undefined, postedTo: postedTo || undefined, search: submitted || undefined, sort, order,
    batchId: batchId ?? undefined, serialId: serialId ?? undefined, sourceId: sourceId ?? undefined,
  }), [view, itemId, warehouseId, locationId, category, type, disposition, direction, status, sourceType, postedBy, categoryId, from, to, postedFrom, postedTo, submitted, sort, order, batchId, serialId, sourceId]);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "movement-history", "options"), queryFn: getOptions, staleTime: 60_000 });
  const itemsQuery = useInfiniteQuery({
    queryKey: scopedQueryKey(workspace, "movement-history", "items", filters),
    queryFn: ({ pageParam }) => getItemMovements({ ...filters, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null, getNextPageParam: (last) => last.nextCursor, enabled: mode === "items",
  });
  const eventsQuery = useInfiniteQuery({
    queryKey: scopedQueryKey(workspace, "movement-history", "events", filters),
    queryFn: ({ pageParam }) => getEvents({ ...filters, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null, getNextPageParam: (last) => last.nextCursor, enabled: mode === "events",
  });
  const first = itemsQuery.data?.pages[0];
  const cost = Boolean(options.data?.canSeeCost);
  const balance = Boolean(first?.balanceShown);
  const itemRows = useMemo(() => itemsQuery.data?.pages.flatMap((page) => page.rows) ?? [], [itemsQuery.data]);
  const eventRows = useMemo(() => eventsQuery.data?.pages.flatMap((page) => page.rows) ?? [], [eventsQuery.data]);

  const itemColumns = useMemo(() => ([
    { id: "effectiveAt", header: "Effective", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.effectiveAt)}</span> },
    { id: "postedAt", header: "Posted", cell: ({ row }) => <span className="whitespace-nowrap text-text-muted">{formatDateTime(row.original.postedAt)}</span> },
    { id: "typeLabel", header: "Movement", cell: ({ row }) => <span className="flex flex-col gap-1">{row.original.typeLabel}<Flags flags={row.original.flags} /></span> },
    { id: "source", header: "Reference", cell: ({ row }) => <DocumentCell source={row.original.source} fallback={row.original.number} /> },
    { id: "sku", header: "SKU", cell: ({ row }) => row.original.sku },
    { id: "itemName", header: "Item", cell: ({ row }) => <span className="flex flex-col">{row.original.itemName}{row.original.atPosting && <span className="text-xs text-text-muted">At posting: {row.original.atPosting.itemName}</span>}</span> },
    { id: "from", header: "From", cell: ({ row }) => row.original.from },
    { id: "to", header: "To", cell: ({ row }) => row.original.to },
    { id: "quantity", header: "Qty", cell: ({ row }) => (
      <span className={`flex flex-col whitespace-nowrap tabular-nums ${row.original.direction === "internal" ? "" : row.original.quantity > 0 ? "text-success" : "text-danger"}`}>
        <span>{row.original.quantity > 0 ? "+" : ""}{quantity(row.original.quantity, row.original.baseUom)}</span>
        {row.original.entered && row.original.entered.uom !== row.original.baseUom && <span className="text-xs text-text-muted">{quantity(row.original.entered.quantity, row.original.entered.uom)} (× {row.original.entered.conversion})</span>}
      </span>
    ) },
    { id: "tracking", header: "Batch / Serial", cell: ({ row }) => row.original.serial ?? row.original.batch ?? "" },
    { id: "balanceAfter", header: "Balance after", cell: ({ row }) => <span className="font-medium tabular-nums">{quantity(row.original.balanceAfter)}</span> },
    { id: "postedBy", header: "User", cell: ({ row }) => row.original.postedBy ?? "" },
    { id: "value", header: "Value", cell: ({ row }) => (row.original.value === null || row.original.value === undefined ? <Badge tone="warning">No value</Badge> : <span className="tabular-nums">{money(row.original.value)}</span>) },
  ] satisfies ColumnDef<MovementRow, unknown>[]).map((column) => ({ ...column, enableSorting: false }))
    .filter((column) => (balance || column.id !== "balanceAfter") && (cost || column.id !== "value")), [balance, cost]);
  const eventColumns = useMemo(() => ([
    { id: "effectiveAt", header: "Effective", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.effectiveAt)}</span> },
    { id: "postedAt", header: "Posted", cell: ({ row }) => <span className="whitespace-nowrap text-text-muted">{formatDateTime(row.original.postedAt)}</span> },
    { id: "label", header: "Event", cell: ({ row }) => <span className="flex flex-col gap-1">{row.original.label}<Flags flags={row.original.flags} /></span> },
    { id: "source", header: "Reference", cell: ({ row }) => <DocumentCell source={row.original.source} fallback="—" /> },
    { id: "items", header: "Items", cell: ({ row }) => (row.original.item ? `${row.original.item.sku} · ${row.original.item.name}` : `${row.original.items} items`) },
    { id: "from", header: "From", cell: ({ row }) => row.original.from },
    { id: "to", header: "To", cell: ({ row }) => row.original.to },
    { id: "quantity", header: "Qty", cell: ({ row }) => (
      <span className="whitespace-nowrap tabular-nums">{row.original.quantity === null ? `${row.original.legs} lines` : row.original.direction === "mixed"
        ? `+${quantity(row.original.quantityIn)} / −${quantity(row.original.quantityOut, row.original.uom)}` : quantity(row.original.quantity, row.original.uom)}</span>
    ) },
    { id: "postedBy", header: "User", cell: ({ row }) => row.original.postedBy ?? "" },
    { id: "value", header: "Value", cell: ({ row }) => <span className="tabular-nums">{money(row.original.value)}</span> },
  ] satisfies ColumnDef<EventRow, unknown>[]).map((column) => ({ ...column, enableSorting: false })).filter((column) => cost || column.id !== "value"), [cost]);

  if (options.isError && errorCode(options.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to movement history" description="Ask an administrator for the View stock ledger permission." />;
  const active = mode === "items" ? itemsQuery : eventsQuery;
  const o = options.data;
  const locations = o?.warehouses.find((entry) => entry.id === warehouseId)?.locations ?? [];
  const types = (o?.movementTypes ?? []).filter((entry) => category === ANY || entry.category === category);
  const serial = first?.serial ?? null;
  const exportFilters = { ...filters, mode: undefined };
  const filterBar = filterBarOf([
    { id: "item", active: Boolean(itemId), label: `Item: ${itemRows[0]?.sku ?? "selected"}`, clear: () => { setItemId(null); setBatchId(null); setSerialId(null); } },
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => { setWarehouseId(ANY); setLocationId(ANY); } },
    { id: "location", active: locationId !== ANY, label: `Location: ${optionLabel(locations, locationId, "code")}`, clear: () => setLocationId(ANY) },
    { id: "category", active: category !== ANY, label: `Category: ${optionLabel(o?.categories, category)}`, clear: () => { setCategory(ANY); setType(ANY); } },
    { id: "type", active: type !== ANY, label: `Movement: ${optionLabel(o?.movementTypes, type)}`, clear: () => setType(ANY) },
    { id: "from", active: Boolean(from), label: `Effective from ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `Effective to ${formatDate(to)}`, clear: () => setTo("") },
    { id: "direction", active: direction !== ANY, label: direction === "in" ? "In only" : "Out only", clear: () => setDirection(ANY) },
    { id: "disposition", active: disposition !== ANY, label: `Disposition: ${optionLabel(o?.dispositions, disposition)}`, clear: () => setDisposition(ANY) },
    { id: "status", active: status !== ANY, label: `Status: ${status === "reversal" ? "Reversals" : status === "reversed" ? "Reversed" : "Active"}`, clear: () => setStatus(ANY) },
    { id: "sourceType", active: sourceType !== ANY, label: `Document: ${optionLabel(o?.sourceTypes, sourceType)}`, clear: () => setSourceType(ANY) },
    { id: "itemCategory", active: categoryId !== ANY, label: `Item category: ${optionLabel(o?.itemCategories, categoryId)}`, clear: () => setCategoryId(ANY) },
    { id: "postedBy", active: postedBy !== ANY, label: `Posted by: ${optionLabel(o?.postedBy, postedBy)}`, clear: () => setPostedBy(ANY) },
    { id: "postedFrom", active: Boolean(postedFrom), label: `Posted from ${formatDate(postedFrom)}`, clear: () => setPostedFrom("") },
    { id: "postedTo", active: Boolean(postedTo), label: `Posted to ${formatDate(postedTo)}`, clear: () => setPostedTo("") },
    { id: "batch", active: Boolean(batchId), label: `Batch ${itemRows.find((row) => row.batchId === batchId)?.batch ?? ""}`.trim(), clear: () => setBatchId(null) },
    { id: "serial", active: Boolean(serialId), label: `Serial ${serial?.serialNumber ?? ""}`.trim(), clear: () => setSerialId(null) },
    { id: "source", active: Boolean(sourceId), label: `Document ${itemRows[0]?.source.number ?? eventRows[0]?.source.number ?? ""}`.trim(), clear: () => setSourceId(null) },
  ]);
  const rowCount = mode === "items" ? itemRows.length : eventRows.length;

  return (
    <EnterpriseListPage
      header={{
        title: "Movement History",
        description: "Every posted stock movement and internal move (transfers, quality holds, location moves), with its document, path, user and dates. Reservations and drafts never appear; nothing here is edited.",
        secondaryActions: (
          <>
            {o?.canExport && <>
              <a className={buttonVariants({ variant: "outline" })} href={exportUrl(exportFilters, "csv")} download><Download className="size-4" aria-hidden="true" />CSV</a>
              <a className={buttonVariants({ variant: "outline" })} href={exportUrl(exportFilters, "xlsx")} download><Download className="size-4" aria-hidden="true" />Excel</a>
            </>}
            {o?.canReconcile && <LinkButton variant="outline" href="/inventory/transactions?tab=ledger">Stock reconciliation</LinkButton>}
          </>
        ),
      }}
      savedViews={o ? { views: o.views.map((entry) => ({ id: entry.id, label: entry.label })), activeViewId: view, onSelect: setView } : undefined}
      actionBar={{
        start: (
          <>
            <SearchField aria-label="Search movements" placeholder="SKU, item, barcode, document, PO / SO, batch or serial" className="w-full sm:w-80" value={search} onChange={setSearch} />
            <ItemFilter value={itemId} onChange={(id) => { setItemId(id); setBatchId(null); setSerialId(null); }} />
            <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => { setWarehouseId(String(key)); setLocationId(ANY); }}
              options={[{ value: ANY, label: "All warehouses" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: entry.system ? `${entry.name} (system)` : `${entry.code} · ${entry.name}` }))]} />
            {warehouseId !== ANY && <Select aria-label="Location" size="compact" selectedKey={locationId} onSelectionChange={(key) => setLocationId(String(key))}
              options={[{ value: ANY, label: "All locations" }, ...locations.map((entry) => ({ value: entry.id, label: entry.code }))]} />}
            <Select aria-label="Category" size="compact" selectedKey={category} onSelectionChange={(key) => { setCategory(String(key)); setType(ANY); }}
              options={[{ value: ANY, label: "All categories" }, ...(o?.categories ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
            <Select aria-label="Movement type" size="compact" selectedKey={type} onSelectionChange={(key) => setType(String(key))}
              options={[{ value: ANY, label: "All movement types" }, ...types.map((entry) => ({ value: entry.id, label: entry.label }))]} />
            <TextField aria-label="Effective from" type="date" value={from} onChange={setFrom} />
            <TextField aria-label="Effective to" type="date" value={to} onChange={setTo} />
            {more && <>
              <Select aria-label="Direction" size="compact" selectedKey={direction} onSelectionChange={(key) => setDirection(String(key))}
                options={[{ value: ANY, label: "In and out" }, { value: "in", label: "In" }, { value: "out", label: "Out" }]} />
              <Select aria-label="Disposition" size="compact" selectedKey={disposition} onSelectionChange={(key) => setDisposition(String(key))}
                options={[{ value: ANY, label: "Any disposition" }, ...(o?.dispositions ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
              <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
                options={[{ value: ANY, label: "Any status" }, { value: "active", label: "Active" }, { value: "reversed", label: "Reversed" }, { value: "reversal", label: "Reversals" }]} />
              <Select aria-label="Source document" size="compact" selectedKey={sourceType} onSelectionChange={(key) => setSourceType(String(key))}
                options={[{ value: ANY, label: "Any document" }, ...(o?.sourceTypes ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
              <Select aria-label="Item category" size="compact" selectedKey={categoryId} onSelectionChange={(key) => setCategoryId(String(key))}
                options={[{ value: ANY, label: "All item categories" }, ...(o?.itemCategories ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
              <Select aria-label="Posted by" size="compact" selectedKey={postedBy} onSelectionChange={(key) => setPostedBy(String(key))}
                options={[{ value: ANY, label: "Anyone" }, ...(o?.postedBy ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
              <TextField aria-label="Posted from" type="date" value={postedFrom} onChange={setPostedFrom} />
              <TextField aria-label="Posted to" type="date" value={postedTo} onChange={setPostedTo} />
            </>}
          </>
        ),
        end: (
          <>
            <Select aria-label="Show" size="compact" selectedKey={mode} onSelectionChange={(key) => setMode(String(key) === "events" ? "events" : "items")}
              options={[{ value: "items", label: "Item movements" }, { value: "events", label: "Transaction events" }]} />
            <Select aria-label="Sort" size="compact" selectedKey={`${sort}:${order}`} onSelectionChange={(key) => { const [s, d] = String(key).split(":"); setSort(s); setOrder(d); }}
              options={[{ value: "effective:desc", label: "Effective, newest first" }, { value: "effective:asc", label: "Effective, oldest first" },
                { value: "posted:desc", label: "Posted, newest first" }, { value: "posted:asc", label: "Posted, oldest first" }]} />
            <Button size="compact" variant="outline" onPress={() => setMore((open) => !open)}>{more ? "Fewer filters" : "More filters"}</Button>
          </>
        ),
      }}
      filterBar={filterBar}
    >
      {mode === "items" && serial && <Notice tone="neutral">
        <span className="font-medium text-text">Serial <Link className="text-brand hover:underline" href={`/inventory/stock/serials/${serial.id}`}>{serial.serialNumber}</Link> · {serial.sku} {serial.itemName}</span>
        {" — "}{serial.inStock ? `in stock at ${serial.warehouse ?? "a warehouse you cannot see"}${serial.location ? ` / ${serial.location}` : ""}${serial.disposition && serial.disposition !== "available" ? ` · ${serial.disposition.replace("_", " ")}` : ""}` : `not in stock (${serial.status})`}
        {serial.batch ? ` · batch ${serial.batch}` : ""}{serial.reservation ? ` · reserved on ${serial.reservation}` : ""}. Its complete journey is below.</Notice>}
      {mode === "items" && first && (first.summary.comparable ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label="Movements" value={first.summary.movements} />
          <MetricCard label="Inbound" value={quantity(first.summary.inbound, first.summary.uom)} />
          <MetricCard label="Outbound" value={quantity(first.summary.outbound, first.summary.uom)} />
          <MetricCard label="Internal" value={quantity(first.summary.internal, first.summary.uom)} />
        </div>
      ) : <Notice tone="neutral">{first.summary.movements} movement{first.summary.movements === 1 ? "" : "s"}. Quantities are not totalled across different units.</Notice>)}
      {mode === "items" && first && <p className="text-xs text-text-muted">{first.scope
        ? <>Balance scope: <span className="font-medium text-text">{first.scope.label}</span>{!first.balanceShown && " (the running balance is shown in effective-date order)."}</>
        : "Choose an item to see a running balance; across items there is no single balance."}</p>}
      {mode === "items" ? (
        <EnterpriseDataGrid<MovementRow>
          aria-label="Item movements"
          columns={itemColumns}
          data={itemRows}
          getRowId={(row) => row.id}
          state={active.isLoading ? "loading" : active.isError ? "error" : rowCount === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading movement history" rows={8} />}
          errorContent={<ErrorState title="Could not load movement history" description={errorMessage(active.error)} action={{ label: "Try again", onPress: () => void active.refetch() }} />}
          emptyContent={<EmptyState title="No movements" description="Posted receipts, deliveries, issues, returns, transfers, adjustments and quality moves appear here. Drafts and reservations never do." />}
          onRowClick={(row) => router.push(`${MOVEMENTS_BASE}/${row.groupId}?movement=${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.typeLabel}</span><span className="tabular-nums">{row.quantity > 0 ? "+" : ""}{quantity(row.quantity, row.baseUom)}</span></span>
              <span className="text-xs text-text-muted">{formatDate(row.effectiveAt)} · {row.sku} · {row.from} → {row.to}</span>
            </div>
          )}
        />
      ) : (
        <EnterpriseDataGrid<EventRow>
          aria-label="Transaction events"
          columns={eventColumns}
          data={eventRows}
          getRowId={(row) => row.id}
          state={active.isLoading ? "loading" : active.isError ? "error" : rowCount === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading movement history" rows={8} />}
          errorContent={<ErrorState title="Could not load movement history" description={errorMessage(active.error)} action={{ label: "Try again", onPress: () => void active.refetch() }} />}
          emptyContent={<EmptyState title="No movements" description="Posted receipts, deliveries, issues, returns, transfers, adjustments and quality moves appear here. Drafts and reservations never do." />}
          onRowClick={(row) => router.push(`${MOVEMENTS_BASE}/${row.id}`)}
        />
      )}
      {active.hasNextPage && <div><Button variant="secondary" isLoading={active.isFetchingNextPage} onPress={() => void active.fetchNextPage()}>Load more</Button></div>}
    </EnterpriseListPage>
  );
}
