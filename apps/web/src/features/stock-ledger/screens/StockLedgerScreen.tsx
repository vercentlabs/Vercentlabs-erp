"use client";

// Stock Ledger: every physical stock movement, as posted, with the document behind it and the running balance of the scope the filters name
// (an item, and optionally its warehouse, location, batch, serial number or disposition). Reservations never appear here (Reserved Stock).
// Nothing is edited: a wrong movement is corrected by its document's reversal or another stock transaction. Rows come in posting order (the
// running balance depends on it), a page at a time.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import {
  Badge, Button, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, PermissionState, SearchField, Select, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { listItems } from "@/features/items/api/items-api";
import { ErrorBanner, money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  errorCode, errorMessage, getLedgerOptions, getSerialHistory, getStockLedger, ledgerExportUrl, listReconciliations, runReconciliation, type LedgerRow,
} from "../api/stock-ledger-api";

export const LEDGER_BASE = "/inventory/stock-ledger";
const ANY = "any";
const PAGE = "100";

function ItemFilter({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const items = useQuery({
    queryKey: scopedQueryKey(workspace, "stock-ledger", "item-picker", text),
    queryFn: () => listItems({ search: text || undefined, inventoryTracked: "true", limit: 20 }),
    staleTime: 15_000,
  });
  const rows = items.data?.products ?? [];
  return (
    <ComboBox aria-label="Item" placeholder="Item (SKU or name)" className="w-full sm:w-64" options={rows.map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))}
      selectedKey={value} onSelectionChange={(key) => onChange(key ? String(key) : null)} onInputChange={setText} isLoading={items.isFetching}
      emptyMessage={items.isError ? "Search failed. Try again." : "No matching items"} allowsEmptyCollection />
  );
}

export function StockLedgerScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const [itemId, setItemId] = useState<string | null>(params.get("itemId"));
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? ANY);
  const [locationId, setLocationId] = useState(params.get("locationId") ?? ANY);
  const [type, setType] = useState(params.get("type") ?? ANY);
  const [disposition, setDisposition] = useState(params.get("disposition") ?? ANY);
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const submitted = useDebouncedValue(search);
  const [categoryId, setCategoryId] = useState(params.get("categoryId") ?? ANY);
  const [postedFrom, setPostedFrom] = useState(params.get("postedFrom") ?? "");
  const [postedTo, setPostedTo] = useState(params.get("postedTo") ?? "");
  const [more, setMore] = useState(Boolean(params.get("categoryId") || params.get("postedFrom") || params.get("postedTo")));
  const [order, setOrder] = useState(params.get("order") === "desc" ? "desc" : "asc");
  const [batchId, setBatchId] = useState(params.get("batchId"));
  const [serialId, setSerialId] = useState(params.get("serialId"));
  const [sourceId, setSourceId] = useState(params.get("sourceId"));
  const [reconciling, setReconciling] = useState(false);
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = useMemo(() => ({
    itemId: itemId ?? undefined, warehouseId: pick(warehouseId), locationId: pick(locationId), type: pick(type), disposition: pick(disposition), from: from || undefined,
    to: to || undefined, search: submitted || undefined, order, batchId: batchId ?? undefined, serialId: serialId ?? undefined, sourceId: sourceId ?? undefined,
    categoryId: pick(categoryId), postedFrom: postedFrom || undefined, postedTo: postedTo || undefined,
  }), [itemId, warehouseId, locationId, type, disposition, from, to, submitted, order, batchId, serialId, sourceId, categoryId, postedFrom, postedTo]);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "stock-ledger", "options"), queryFn: getLedgerOptions, staleTime: 60_000 });
  const ledger = useInfiniteQuery({
    queryKey: scopedQueryKey(workspace, "stock-ledger", "list", filters),
    queryFn: ({ pageParam }) => getStockLedger({ ...filters, limit: PAGE, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const serial = useQuery({ queryKey: scopedQueryKey(workspace, "stock-ledger", "serial", serialId), queryFn: () => getSerialHistory(serialId!), enabled: Boolean(serialId) });
  const first = ledger.data?.pages[0];
  const rows = useMemo(() => ledger.data?.pages.flatMap((page) => page.rows) ?? [], [ledger.data]);
  const cost = Boolean(first?.canSeeCost);
  const scope = first?.scope ?? null;

  const columns = useMemo(() => ([
    { id: "effectiveAt", header: "Effective", cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.effectiveAt)}</span> },
    { id: "postedAt", header: "Posted", cell: ({ row }) => <span className="whitespace-nowrap text-text-muted">{formatDateTime(row.original.postedAt)}</span> },
    { id: "typeLabel", header: "Movement", cell: ({ row }) => <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">{row.original.typeLabel}{row.original.reversedById && <Badge tone="neutral">Reversed</Badge>}</span> },
    { id: "source", header: "Reference", cell: ({ row }) => (
      <span className="flex flex-col whitespace-nowrap">{row.original.source.href
        ? <Link className="text-brand hover:underline" href={row.original.source.href} onClick={(event) => event.stopPropagation()}>{row.original.source.number ?? row.original.number}</Link>
        : row.original.source.number ?? row.original.number}<span className="text-xs text-text-muted">{row.original.source.label}</span></span>
    ) },
    { id: "sku", header: "SKU", cell: ({ row }) => row.original.sku },
    { id: "itemName", header: "Item", cell: ({ row }) => row.original.itemName },
    { id: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "location", header: "Location", cell: ({ row }) => row.original.location },
    { id: "tracking", header: "Batch / Serial", cell: ({ row }) => row.original.serial ?? row.original.batch ?? "" },
    { id: "disposition", header: "Disposition", cell: ({ row }) => (row.original.disposition === "available" ? "Available" : <Badge tone="warning">{row.original.dispositionLabel}</Badge>) },
    { id: "quantityIn", header: "Qty in", cell: ({ row }) => <span className="tabular-nums text-success">{row.original.quantityIn === null ? "" : quantity(row.original.quantityIn)}</span> },
    { id: "quantityOut", header: "Qty out", cell: ({ row }) => <span className="tabular-nums text-danger">{row.original.quantityOut === null ? "" : quantity(row.original.quantityOut)}</span> },
    { id: "balance", header: "Balance", cell: ({ row }) => <span className="font-medium tabular-nums">{quantity(row.original.balance)}</span> },
    { id: "uom", header: "UOM", cell: ({ row }) => (
      <span className="flex flex-col">{row.original.baseUom}{row.original.entered && row.original.entered.uom !== row.original.baseUom
        && <span className="text-xs text-text-muted">{quantity(row.original.entered.quantity, row.original.entered.uom)} × {row.original.entered.conversion}</span>}</span>
    ) },
    { id: "unitCost", header: "Unit cost", cell: ({ row }) => <span className="tabular-nums">{money(row.original.unitCost)}</span> },
    { id: "value", header: "Value", cell: ({ row }) => <span className="tabular-nums">{money(row.original.value)}</span> },
  ] satisfies ColumnDef<LedgerRow, unknown>[]).map((column) => ({ ...column, enableSorting: false }))
    .filter((column) => (scope || column.id !== "balance") && (cost || !["unitCost", "value"].includes(column.id))), [scope, cost]);

  if (options.isError && errorCode(options.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to the stock ledger" description="Ask an administrator for the View stock ledger permission." />;
  const o = options.data;
  const locations = o?.warehouses.find((entry) => entry.id === warehouseId)?.locations ?? [];
  const filterBar = filterBarOf([
    { id: "item", active: Boolean(itemId), label: `Item: ${rows[0]?.sku ?? "selected"}`, clear: () => { setItemId(null); setBatchId(null); setSerialId(null); } },
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => { setWarehouseId(ANY); setLocationId(ANY); } },
    { id: "location", active: locationId !== ANY, label: `Location: ${optionLabel(locations, locationId, "code")}`, clear: () => setLocationId(ANY) },
    { id: "type", active: type !== ANY, label: `Movement: ${optionLabel(o?.movementTypes, type)}`, clear: () => setType(ANY) },
    { id: "disposition", active: disposition !== ANY, label: `Disposition: ${optionLabel(o?.dispositions, disposition)}`, clear: () => setDisposition(ANY) },
    { id: "from", active: Boolean(from), label: `Effective from ${formatDate(from)}`, clear: () => setFrom("") },
    { id: "to", active: Boolean(to), label: `Effective to ${formatDate(to)}`, clear: () => setTo("") },
    { id: "category", active: categoryId !== ANY, label: `Category: ${optionLabel(o?.categories, categoryId)}`, clear: () => setCategoryId(ANY) },
    { id: "postedFrom", active: Boolean(postedFrom), label: `Posted from ${formatDate(postedFrom)}`, clear: () => setPostedFrom("") },
    { id: "postedTo", active: Boolean(postedTo), label: `Posted to ${formatDate(postedTo)}`, clear: () => setPostedTo("") },
    { id: "batch", active: Boolean(batchId), label: `Batch ${rows.find((row) => row.batchId === batchId)?.batch ?? ""}`.trim(), clear: () => setBatchId(null) },
    { id: "serial", active: Boolean(serialId), label: `Serial ${serial.data?.serial.serialNumber ?? ""}`.trim(), clear: () => setSerialId(null) },
    { id: "source", active: Boolean(sourceId), label: `Document ${rows[0]?.source.number ?? ""}`.trim(), clear: () => setSourceId(null) },
  ]);

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Stock Ledger",
          description: "Every physical stock movement, in base units, with the document that caused it and the running balance. Posted movements are never edited; corrections are compensating movements.",
          secondaryActions: (
            <>
              {first?.canExport && rows.length > 0 && <>
                <a className={buttonVariants({ variant: "outline" })} href={ledgerExportUrl(filters, "csv")} download><Download className="size-4" aria-hidden="true" />CSV</a>
                <a className={buttonVariants({ variant: "outline" })} href={ledgerExportUrl(filters, "xlsx")} download><Download className="size-4" aria-hidden="true" />Excel</a>
              </>}
              {o?.canReconcile && <Button variant="outline" onPress={() => setReconciling(true)}>Reconcile</Button>}
            </>
          ),
        }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search the ledger" placeholder="SKU, item, barcode, document, batch or serial" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <ItemFilter value={itemId} onChange={(id) => { setItemId(id); setBatchId(null); setSerialId(null); }} />
              <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => { setWarehouseId(String(key)); setLocationId(ANY); }}
                options={[{ value: ANY, label: "All warehouses" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: entry.system ? `${entry.name} (system)` : `${entry.code} · ${entry.name}` }))]} />
              {warehouseId !== ANY && <Select aria-label="Location" size="compact" selectedKey={locationId} onSelectionChange={(key) => setLocationId(String(key))}
                options={[{ value: ANY, label: "All locations" }, ...locations.map((entry) => ({ value: entry.id, label: entry.code }))]} />}
              <Select aria-label="Movement type" size="compact" selectedKey={type} onSelectionChange={(key) => setType(String(key))}
                options={[{ value: ANY, label: "All movement types" }, ...(o?.movementTypes ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
              <Select aria-label="Disposition" size="compact" selectedKey={disposition} onSelectionChange={(key) => setDisposition(String(key))}
                options={[{ value: ANY, label: "Any disposition" }, ...(o?.dispositions ?? []).map((entry) => ({ value: entry.id, label: entry.label }))]} />
              <TextField aria-label="Effective from" type="date" value={from} onChange={setFrom} />
              <TextField aria-label="Effective to" type="date" value={to} onChange={setTo} />
              {more && <>
                <Select aria-label="Category" size="compact" selectedKey={categoryId} onSelectionChange={(key) => setCategoryId(String(key))}
                  options={[{ value: ANY, label: "All categories" }, ...(o?.categories ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
                <TextField aria-label="Posted from" type="date" value={postedFrom} onChange={setPostedFrom} />
                <TextField aria-label="Posted to" type="date" value={postedTo} onChange={setPostedTo} />
              </>}
            </>
          ),
          end: (
            <>
              <Select aria-label="Order" size="compact" selectedKey={order} onSelectionChange={(key) => setOrder(String(key) === "desc" ? "desc" : "asc")}
                options={[{ value: "asc", label: "Oldest first" }, { value: "desc", label: "Newest first" }]} />
              <Button size="compact" variant="outline" onPress={() => setMore((open) => !open)}>{more ? "Fewer filters" : "More filters"}</Button>
            </>
          ),
        }}
        filterBar={filterBar}
      >
        {serial.data && <Notice tone="neutral"><span className="font-medium text-text">Serial history · {serial.data.serial.serialNumber} · {serial.data.serial.sku} {serial.data.serial.itemName}</span>
          {" — "}{serial.data.serial.inStock ? `in stock at ${serial.data.serial.warehouse} / ${serial.data.serial.location}` : "no longer in stock"} · {serial.data.movements.length} movement{serial.data.movements.length === 1 ? "" : "s"}</Notice>}
        {scope ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <MetricCard label={from ? `Opening (${formatDate(from)})` : "Opening"} value={quantity(first?.openingBalance, first?.baseUom)} />
            <MetricCard label="In" value={quantity(first?.totals.quantityIn, first?.baseUom)} />
            <MetricCard label="Out" value={quantity(first?.totals.quantityOut, first?.baseUom)} />
            <MetricCard label={to ? `Closing (${formatDate(to)})` : "Closing"} value={quantity(first?.closingBalance, first?.baseUom)} />
            <MetricCard label={`Movements · ${scope.label}`} value={first?.totals.movements ?? 0} />
          </div>
        ) : first ? <Notice tone="neutral">{first.totals.movements} movement{first.totals.movements === 1 ? "" : "s"}. Choose an item to see its running balance; across items there is no single balance to run.</Notice> : null}
        <EnterpriseDataGrid<LedgerRow>
          aria-label="Stock ledger"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          state={ledger.isLoading ? "loading" : ledger.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
          loadingContent={<LoadingState label="Loading the stock ledger" rows={8} />}
          errorContent={<ErrorState title="Could not load the stock ledger" description={errorMessage(ledger.error)} action={{ label: "Try again", onPress: () => void ledger.refetch() }} />}
          emptyContent={<EmptyState title="No movements" description="Opening stock, receipts, deliveries, returns, transfers and adjustments appear here once they are posted. Drafts and reservations never do." />}
          onRowClick={(row) => router.push(`${LEDGER_BASE}/${row.id}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.typeLabel}</span><span className="tabular-nums">{row.quantityIn !== null ? `+${quantity(row.quantityIn)}` : `−${quantity(row.quantityOut)}`}</span></span>
              <span className="text-xs text-text-muted">{formatDate(row.effectiveAt)} · {row.sku} · {row.warehouse}</span>
              <span className="text-xs text-text-secondary">{row.source.number ?? row.number}</span>
            </div>
          )}
        />
        {ledger.hasNextPage && <div><Button variant="secondary" isLoading={ledger.isFetchingNextPage} onPress={() => void ledger.fetchNextPage()}>Load more</Button></div>}
      </EnterpriseListPage>
      {reconciling && <ReconcileDialog itemId={itemId} warehouseId={pick(warehouseId)} onClose={() => setReconciling(false)} />}
    </>
  );
}

// Does every balance, batch and serial number agree with the ledger, and does every internal posting net to zero? Each run is recorded.
function ReconcileDialog({ itemId, warehouseId, onClose }: { itemId: string | null; warehouseId?: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const run = useMutation({ mutationFn: () => runReconciliation({ itemId: itemId ?? undefined, warehouseId }) });
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "stock-ledger", "reconciliations", run.data?.runId ?? null), queryFn: listReconciliations });
  const result = run.data;
  const count = result ? result.positions.length + result.batches.length + result.serials.length + result.groups.length : 0;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Reconcile the stock ledger">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Compares {itemId || warehouseId ? "the selected item / warehouse" : "the whole company"}: current balances against the sum of their movements, batch-tracked stock
          without a batch, serial-tracked on hand against the serial numbers in stock, and transfers and moves that do not net to zero.</p>
        <ErrorBanner message={run.isError ? errorMessage(run.error) : null} />
        {result && (result.consistent
          ? <p role="status" className="text-success">No unexplained difference. Every balance is explained by the ledger.</p>
          : <div role="alert" className="flex flex-col gap-1 text-danger">
            <p>{count} difference{count === 1 ? "" : "s"} found. Find the cause, then rebuild the balances from Stock Balance → Check balances.</p>
            {result.positions.slice(0, 10).map((row) => <p key={`p-${row.itemId}-${row.warehouse}-${row.location}-${row.batch}`}>{row.sku} · {row.warehouse}/{row.location}{row.batch ? ` · ${row.batch}` : ""}: balance {row.balance}, ledger {row.ledger}</p>)}
            {result.batches.slice(0, 10).map((row) => <p key={`b-${row.itemId}-${row.warehouse}-${row.location}`}>{row.sku} · {row.warehouse}: {row.quantityWithoutBatch} held without a batch</p>)}
            {result.serials.slice(0, 10).map((row) => <p key={`s-${row.itemId}-${row.warehouse}-${row.location}`}>{row.sku} · {row.warehouse}/{row.location}: on hand {row.onHand}, serials in stock {row.serialsInStock}</p>)}
            {result.groups.slice(0, 10).map((row) => <p key={`g-${row.groupId}`}>{row.document ?? row.groupId} ({row.operation}) nets to {row.net}</p>)}
          </div>)}
        {history.data && history.data.length > 0 && <p className="text-text-muted">Last runs: {history.data.slice(0, 3).map((entry) => `${formatDateTime(entry.runAt)} (${entry.differences} difference${entry.differences === 1 ? "" : "s"}${entry.runBy ? `, ${entry.runBy}` : ""})`).join(" · ")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={run.isPending} onPress={() => run.mutate()}>{result ? "Run again" : "Run reconciliation"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
