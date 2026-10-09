"use client";

// On-Hand Inventory (Stock Balance): the current stock position, derived from the Inventory ledger and the active reservations. On hand,
// Reserved, Available, Restricted, In transit and Incoming are separate, never summed; quantities are in each item's base unit. A wrong quantity
// is corrected by an adjustment or another stock transaction: nothing here edits stock. "As of" shows on hand at the end of an earlier day,
// from the ledger. Rows come in item, warehouse, location and batch order, a page at a time.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, MoreHorizontal } from "lucide-react";
import {
  Badge, Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, Menu, MenuItem, MenuTrigger, MetricCard, NoResultsState, PermissionState, SearchField,
  Select, TextArea, TextField,
} from "@vercentlabs/design-system";

import { ErrorBanner, money, quantity } from "@/features/items/item-format";
import { NegativeStockAlert } from "@/features/negative-stock/components/NegativeStockAlert";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorCode, errorMessage, getBalanceOptions, getReconciliation, getStockBalance, rebuildBalances, type BalanceResult, type BalanceRow } from "../api/stock-balance-api";

export const STOCK_BASE = "/inventory/stock";
const ANY = "any";
const PAGE = 200;
const STATUSES: Record<string, string> = {
  in_stock: "In stock", out_of_stock: "Out of stock", reserved: "Reserved", restricted: "Restricted", in_transit: "In transit", incoming: "Incoming",
};

function exportCsv(result: BalanceResult) {
  const headers = ["SKU", "Item", "Warehouse", "Location", "Batch", "Base UOM", "On hand", ...(result.asOf ? [] : ["Reserved", "Available", "Restricted", "Incoming", "In transit"]),
    ...(result.showsValue ? ["Value"] : [])];
  const cell = (value: unknown) => { const text = value === null || value === undefined ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const lines = [headers.join(","), ...result.rows.map((row) => [row.sku, row.itemName, row.warehouseCode, row.locationCode, row.batchNumber, row.baseUom, row.onHand,
    ...(result.asOf ? [] : [row.reserved, row.available, row.restricted, row.incoming, row.inTransit]), ...(result.showsValue ? [row.value] : [])].map(cell).join(","))];
  const url = URL.createObjectURL(new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-balance${result.asOf ? `-${result.asOf}` : ""}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const amount = (value: number | null | undefined) => <span className="tabular-nums">{value === null || value === undefined ? "—" : quantity(value)}</span>;

export function StockBalanceScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // Opened on a view or position from elsewhere (?view=available | reserved | restricted | in_transit | negative | by_batch …, ?warehouseId, ?locationId, ?search).
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "all");
  const [search, setSearch] = useState(params.get("search") ?? "");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? ANY);
  const [locationId, setLocationId] = useState(params.get("locationId") ?? ANY);
  const [categoryId, setCategoryId] = useState(ANY);
  const [status, setStatus] = useState(ANY);
  const [includeZero, setIncludeZero] = useState(false);
  const [asOf, setAsOf] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [checking, setChecking] = useState(false);
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = { view, search: submitted || undefined, warehouseId: pick(warehouseId), locationId: pick(locationId), categoryId: pick(categoryId), status: pick(status),
    includeZero: includeZero ? "true" : undefined, asOf: asOf || undefined, limit: String(limit) };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "options"), queryFn: getBalanceOptions, staleTime: 60_000 });
  const balance = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "list", filters), queryFn: () => getStockBalance(filters), placeholderData: (previous) => previous });
  const result = balance.data;
  const rows = useMemo(() => result?.rows ?? [], [result]);
  const grain = result?.grain ?? "position";
  const historic = Boolean(result?.asOf);
  const showsValue = Boolean(result?.showsValue);

  const columns = useMemo(() => {
    const showWarehouse = grain !== "item";
    const showLocation = grain === "position";
    const showBatch = grain === "position" || grain === "batch";
    const commitments = grain === "warehouse" || grain === "item";
    const when = (show: boolean, column: ColumnDef<BalanceRow, unknown>): ColumnDef<BalanceRow, unknown> | null => (show ? { ...column, enableSorting: false } : null);
    const all = [
      when(true, { id: "sku", header: "SKU", cell: ({ row }) => <Link href={`${STOCK_BASE}/items/${row.original.itemId}`} className="font-medium text-brand hover:underline" onClick={(event) => event.stopPropagation()}>{row.original.sku}</Link> }),
      when(true, { id: "itemName", header: "Item", cell: ({ row }) => row.original.itemName }),
      when(showWarehouse, { id: "warehouseCode", header: "Warehouse", cell: ({ row }) => row.original.warehouseCode ?? "" }),
      when(showLocation, { id: "locationCode", header: "Location", cell: ({ row }) => row.original.locationCode ?? "" }),
      when(showBatch, { id: "batchNumber", header: "Batch", cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">{row.original.batchId
          ? <Link className="text-brand hover:underline" href={`${STOCK_BASE}/batches/${row.original.batchId}`} onClick={(event) => event.stopPropagation()}>{row.original.batchNumber}</Link> : "—"}
          {row.original.expired ? <Badge tone="danger">Expired</Badge> : null}</span>
      ) }),
      when(true, { id: "baseUom", header: "UOM", cell: ({ row }) => row.original.baseUom }),
      when(true, { id: "onHand", header: "On hand", cell: ({ row }) => (
        <span className={`flex flex-wrap items-center gap-1.5 tabular-nums ${row.original.hasNegativeStock ? "font-semibold text-danger" : ""}`}>{quantity(row.original.onHand)}
          {row.original.hasNegativeStock ? <Badge tone="danger">Negative</Badge> : null}</span>
      ) }),
      when(!historic, { id: "reserved", header: "Reserved", cell: ({ row }) => (row.original.reserved
        ? <Link className="tabular-nums text-brand hover:underline" onClick={(event) => event.stopPropagation()}
          href={`/inventory/reservations?itemId=${row.original.itemId}${row.original.warehouseId ? `&warehouseId=${row.original.warehouseId}` : ""}`}>{quantity(row.original.reserved)}</Link>
        : amount(0)) }),
      when(!historic, { id: "available", header: "Available", cell: ({ row }) => amount(row.original.available) }),
      when(!historic, { id: "restricted", header: "Restricted", cell: ({ row }) => (
        <span className="flex flex-col tabular-nums">{row.original.restricted ? <span className="text-warning">{quantity(row.original.restricted)}</span> : quantity(0)}
          {row.original.qualityHold || row.original.quarantined || row.original.damaged ? <span className="text-xs text-text-muted">{[row.original.qualityHold ? `QH ${quantity(row.original.qualityHold)}` : "",
            row.original.quarantined ? `Quarantine ${quantity(row.original.quarantined)}` : "", row.original.damaged ? `Damaged ${quantity(row.original.damaged)}` : ""].filter(Boolean).join(" · ")}</span> : null}</span>
      ) }),
      when(!historic && commitments, { id: "incoming", header: "Incoming", cell: ({ row }) => amount(row.original.incoming) }),
      when(!historic && commitments, { id: "inTransit", header: "In transit", cell: ({ row }) => amount(row.original.inTransit) }),
      when(showsValue && !historic, { id: "value", header: "Value", cell: ({ row }) => <span className="tabular-nums">{money(row.original.value ?? 0)}</span> }),
    ];
    return all.filter((column): column is ColumnDef<BalanceRow, unknown> => column !== null);
  }, [grain, historic, showsValue]);

  if (balance.isError && errorCode(balance.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to stock" description="Ask an administrator for the View stock permission." />;
  const can = options.data?.capabilities;
  const o = options.data;
  const locations = (o?.locations ?? []).filter((entry) => entry.warehouseId === warehouseId);
  const totals = result?.totals;
  const commitments = grain === "warehouse" || grain === "item";
  const filterBar = filterBarOf([
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => { setWarehouseId(ANY); setLocationId(ANY); } },
    { id: "location", active: locationId !== ANY, label: `Location: ${optionLabel(locations, locationId, "code")}`, clear: () => setLocationId(ANY) },
    { id: "category", active: categoryId !== ANY, label: `Category: ${optionLabel(o?.categories, categoryId)}`, clear: () => setCategoryId(ANY) },
    { id: "status", active: status !== ANY, label: `Status: ${STATUSES[status] ?? status}`, clear: () => setStatus(ANY) },
    { id: "zero", active: includeZero, label: "Including zero stock", clear: () => setIncludeZero(false) },
    { id: "asOf", active: Boolean(asOf), label: `As of ${formatDate(asOf)}`, clear: () => setAsOf("") },
  ], () => setLimit(PAGE));
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "all";

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "On-Hand Inventory",
          description: "What the company holds now, by warehouse, location and batch, derived from the stock ledger and reservations. Quantities are in each item's base unit.",
          secondaryActions: (
            <>
              {can?.export && result && rows.length > 0 && <Button variant="outline" onPress={() => exportCsv(result)}><Download className="size-4" aria-hidden="true" />Export</Button>}
              <Button variant="outline" onPress={() => setChecking(true)}>Check balances</Button>
            </>
          ),
        }}
        savedViews={{ views: (o?.views ?? [{ id: "all", label: "All stock" }]).map((entry) => ({ id: entry.id, label: entry.label })), activeViewId: view,
          onSelect: (id) => { setView(id); setLimit(PAGE); } }}
        actionBar={{
          start: (
            <>
              <SearchField aria-label="Search stock" placeholder="SKU, name, barcode, batch or serial" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => { setWarehouseId(String(key)); setLocationId(ANY); }}
                options={[{ value: ANY, label: "All warehouses" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
              {warehouseId !== ANY && <Select aria-label="Location" size="compact" selectedKey={locationId} onSelectionChange={(key) => setLocationId(String(key))}
                options={[{ value: ANY, label: "All locations" }, ...locations.map((entry) => ({ value: entry.id, label: entry.code }))]} />}
              <Select aria-label="Category" size="compact" selectedKey={categoryId} onSelectionChange={(key) => setCategoryId(String(key))}
                options={[{ value: ANY, label: "All categories" }, ...(o?.categories ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
              <Select aria-label="Stock status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
                options={[{ value: ANY, label: "Any status" }, ...Object.entries(STATUSES).map(([value, label]) => ({ value, label }))]} />
              <TextField aria-label="As of" type="date" value={asOf} onChange={setAsOf} />
              <Checkbox isSelected={includeZero} onChange={setIncludeZero}>Include zero stock</Checkbox>
            </>
          ),
        }}
        filterBar={filterBar}
      >
        <NegativeStockAlert />
        {view === "negative" && <Notice tone="neutral">The positions below zero now. Since when, the transaction that caused it, who overrode and why: <Link className="text-brand hover:underline" href="/inventory/negative-stock">Negative-stock exceptions</Link>.</Notice>}
        {totals && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
              <MetricCard label="On hand" value={quantity(totals.onHand)} />
              {!historic && <>
                <MetricCard label="Reserved" value={quantity(totals.reserved ?? 0)} />
                <MetricCard label="Available" value={quantity(totals.available ?? 0)} />
                <MetricCard label="Restricted" value={quantity(totals.restricted ?? 0)} />
                {commitments && <MetricCard label="Incoming" value={quantity(totals.incoming ?? 0)} />}
                {commitments && <MetricCard label="In transit" value={quantity(totals.inTransit ?? 0)} />}
                {totals.value !== undefined && <MetricCard label="Value" value={money(totals.value)} />}
              </>}
            </div>
            <p className="text-xs text-text-muted">{historic ? `On hand at the end of ${formatDate(result?.asOf ?? "")}, from the ledger.` : `As of ${formatDateTime(result?.asOfTime ?? "")}.`} Mixed units are summed only within each row.</p>
          </>
        )}
        <EnterpriseDataGrid<BalanceRow>
          aria-label="On-hand inventory"
          columns={columns}
          data={rows}
          getRowId={(row) => row.key}
          state={balance.isLoading ? "loading" : balance.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading stock" rows={8} />}
          errorContent={<ErrorState title="Could not load stock" description={errorMessage(balance.error)} action={{ label: "Try again", onPress: () => void balance.refetch() }} />}
          emptyContent={<EmptyState title="No stock yet" description="Stock appears once it is received, opened or transferred in." />}
          noResultsContent={<NoResultsState title="No stock matches" description="Try another view, search or filter." />}
          rowActions={(row) => <RowActions row={row} />}
          onRowClick={(row) => router.push(`${STOCK_BASE}/items/${row.itemId}`)}
          renderMobileCard={(row) => (
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.sku}</span><span className="tabular-nums">{quantity(row.onHand)} {row.baseUom}</span></span>
              <span className="text-xs text-text-muted">{row.itemName}{row.warehouseCode ? ` · ${row.warehouseCode}` : ""}{row.locationCode ? ` / ${row.locationCode}` : ""}</span>
              {!historic && <span className="text-xs text-text-secondary">Available {quantity(row.available ?? 0)} · reserved {quantity(row.reserved ?? 0)}</span>}
            </div>
          )}
        />
        {result && result.total > rows.length && (
          <div className="flex items-center justify-between text-sm text-text-muted">
            <span>Showing {rows.length} of {result.total}</span>
            <Button size="compact" variant="secondary" onPress={() => setLimit((current) => current + PAGE)}>Show more</Button>
          </div>
        )}
      </EnterpriseListPage>
      {checking && <IntegrityDialog canRebuild={Boolean(can?.rebuild)} onClose={() => setChecking(false)} />}
    </>
  );
}

// Does every balance equal the ledger and the active reservations? Differences are listed; a rebuild (its own permission, with a reason)
// recomputes the balances from them and is recorded.
function IntegrityDialog({ canRebuild, onClose }: { canRebuild: boolean; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const check = useQuery({ queryKey: scopedQueryKey(workspace, "stock-balance", "reconciliation"), queryFn: getReconciliation });
  const rebuild = useMutation({
    mutationFn: () => rebuildBalances(reason.trim()),
    onSuccess: () => { setReason(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "stock-balance") }); },
  });
  const data = check.data?.reconciliation;
  const differences = data ? data.quantity.length + data.reservations.length + data.serials.length : 0;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Check stock balances">
      <div className="flex flex-col gap-3 text-sm">
        {check.isLoading ? <LoadingState label="Checking" rows={2} /> : check.isError ? <ErrorBanner message={errorMessage(check.error)} /> : data && (
          <>
            <p>{data.consistent ? "Every balance equals the stock ledger and the active reservations." : `${differences} difference${differences === 1 ? "" : "s"} found.`}
              <span className="text-text-muted"> · {data.checkedRows} balance rows · {formatDateTime(data.checkedAt)}</span></p>
            {data.quantity.length > 0 && <p className="text-danger">{data.quantity.length} on-hand balance{data.quantity.length === 1 ? "" : "s"} differ from the ledger.</p>}
            {data.reservations.length > 0 && <p className="text-danger">{data.reservations.length} reserved quantit{data.reservations.length === 1 ? "y differs" : "ies differ"} from the active reservations.</p>}
            {data.serials.length > 0 && <p className="text-danger">{data.serials.length} serial-numbered position{data.serials.length === 1 ? "" : "s"} where on hand is not the number of serials in stock (investigate: a rebuild does not change serials).</p>}
            {check.data && check.data.rebuilds.length > 0 && <p className="text-text-muted">Last rebuild: {formatDateTime(check.data.rebuilds[0].createdAt)} · {check.data.rebuilds[0].reason}</p>}
          </>
        )}
        <ErrorBanner message={rebuild.isError ? errorMessage(rebuild.error) : null} />
        {rebuild.data && <p role="status">Rebuilt: {rebuild.data.quantityCorrections} on-hand and {rebuild.data.reservationCorrections} reserved corrections.</p>}
        {canRebuild && data && (data.quantity.length > 0 || data.reservations.length > 0) && (
          <TextArea label="Reason for rebuilding" rows={2} value={reason} onChange={setReason} description="The balances are recomputed from the ledger and the reservations; the change is recorded." />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => void check.refetch()}>Check again</Button>
          {canRebuild && data && (data.quantity.length > 0 || data.reservations.length > 0) &&
            <Button variant="danger" isDisabled={!reason.trim()} isLoading={rebuild.isPending} onPress={() => rebuild.mutate()}>Rebuild balances</Button>}
          <Button variant="primary" onPress={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}

// A stock row's context: where to look (item, warehouse, reservations, movements, ledger, valuation) and what to start from it (transfer,
// adjustment, count, quality hold) for that item and position — offered only as the person may.
function RowActions({ row }: { row: BalanceRow }) {
  const router = useRouter();
  const { permissions, roleSlugs } = useWorkspaceContext();
  const has = (permission: string) => roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator") || permissions.includes(permission);
  const scope = new URLSearchParams(Object.entries({ itemId: row.itemId, warehouseId: row.warehouseId, locationId: row.locationId, batchId: row.batchId })
    .filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  const entries: Array<[string, string, string]> = [
    ["View item", `/inventory/items/${row.itemId}`, "products.view"],
    ...(row.warehouseId ? [["View warehouse", `/inventory/warehouses/${row.warehouseId}`, "warehouses.view"] as [string, string, string]] : []),
    ["View reservations", `/inventory/reservations?${scope}`, "stock.reservations.view"],
    ["View movement history", `/inventory/transactions?tab=movements&${scope}`, "stock.ledger.view"],
    ["View stock ledger", `/inventory/transactions?tab=ledger&${scope}`, "stock.ledger.view"],
    ["View valuation", `/inventory/valuation?itemId=${row.itemId}`, "stock.valuation.view"],
    ["Create transfer", `/inventory/transfers/new?${scope}`, "stock.transfers.create"],
    ["Create adjustment", `/inventory/adjustments/new?${scope}`, "stock.adjustments.create"],
    ["Start stock count", `/inventory/stock-counts/new?${scope}`, "stock.counts.create"],
    ["Place on quality hold", `/inventory/quality-holds/new?${scope}`, "stock.holds.create"],
  ].filter(([, , permission]) => has(permission)) as Array<[string, string, string]>;
  if (!entries.length) return null;
  return (
    <MenuTrigger>
      <Button size="compact" variant="ghost" aria-label={`Actions for ${row.sku}`}><MoreHorizontal className="size-4" aria-hidden="true" /></Button>
      <Menu onAction={(key) => router.push(String(key))}>{entries.map(([label, href]) => <MenuItem key={href} id={href}>{label}</MenuItem>)}</Menu>
    </MenuTrigger>
  );
}
