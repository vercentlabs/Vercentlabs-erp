"use client";

// Inventory Valuation: what stock is worth — per warehouse and item, by warehouse, by item, and the company total — now or as of a date; the
// FIFO layers left; every value movement with its running value and its drill-down (cost source, layers, exchange rate, journals, reversal,
// restatements); reconciliation with the stock quantities and the Inventory Asset accounts; the history of reconciliations, rebuilds and
// restatements. There is no editing a cost or a value: they come only from stock movements.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, SearchField, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { useInvOptions } from "@/features/inventory/shared/client";
import { money, quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  VALUATION_BASE, checkValuation, errorCode, errorMessage, getEntry, getLayers, getValuation, getValuationEvents, getValueMovements, rebuildValuation, runValuationReconciliation,
  valuationExportUrl, type ReconcileReport, type ValuationRow,
} from "../api/valuation-api";

const ANY = "any";
const Th = ({ children }: { children: React.ReactNode }) => <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th>;
const Table = ({ headers, children }: { headers: string[]; children: React.ReactNode }) => (
  <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
    <table className="w-full text-sm"><thead className="bg-surface-muted text-left text-text-secondary"><tr>{headers.map((header) => <Th key={header}>{header}</Th>)}</tr></thead>
      <tbody className="divide-y divide-border">{children}</tbody></table>
  </div>
);

export function ValuationScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const entryId = params.get("entry");
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? ANY);
  const [itemId] = useState(params.get("itemId") ?? undefined);
  const [method, setMethod] = useState(ANY);
  const [search, setSearch] = useState("");
  const [asOf, setAsOf] = useState("");
  const pick = (value: string) => (value === ANY || !value ? undefined : value);
  const base = { warehouseId: pick(warehouseId), itemId, method: pick(method), search: search.trim() || undefined, asOf: pick(asOf) };
  const options = useInvOptions();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "summary", base), queryFn: () => getValuation({ ...base, view: "summary" }), placeholderData: (previous) => previous });
  if (summary.isError && errorCode(summary.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to inventory value" description="Ask an administrator for the View inventory valuation permission." />;
  const can = summary.data?.capabilities;
  const openEntry = (id: string) => router.push(`${VALUATION_BASE}?entry=${id}`);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Inventory Valuation"
        description="What stock is worth in the company's base currency, from the value of every stock movement: Moving Average or FIFO per item. Costs and values are never edited here."
        primaryAction={can?.export ? <div className="flex gap-2">
          <Button variant="secondary" onPress={() => window.open(valuationExportUrl({ ...base, view: "summary" }, "csv"), "_blank")}><Download className="size-4" aria-hidden="true" />CSV</Button>
          <Button variant="secondary" onPress={() => window.open(valuationExportUrl({ ...base, view: "summary" }, "xlsx"), "_blank")}><Download className="size-4" aria-hidden="true" />Excel</Button>
        </div> : undefined} />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField aria-label="Search" placeholder="SKU or item" className="w-full sm:w-64" value={search} onChange={setSearch} />
        <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
          options={[{ value: ANY, label: "Every warehouse" }, ...(options.data?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
        <Select aria-label="Valuation method" size="compact" selectedKey={method} onSelectionChange={(key) => setMethod(String(key))}
          options={[{ value: ANY, label: "Any method" }, { value: "moving_average", label: "Moving Average" }, { value: "fifo", label: "FIFO" }]} />
        <TextField aria-label="As of" type="date" value={asOf} onChange={setAsOf} className="w-44" description={asOf ? undefined : "Now"} />
        {asOf && <Button size="compact" variant="secondary" onPress={() => setAsOf("")}>Now</Button>}
      </div>
      <div className="flex flex-wrap gap-6 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
        <div><p className="text-xs text-text-muted">Company inventory value{asOf ? ` as of ${formatDate(asOf)}` : ""}</p><p className="text-xl font-semibold tabular-nums">{money(summary.data?.totals.value ?? 0)}</p></div>
        <div><p className="text-xs text-text-muted">Positions</p><p className="text-xl font-semibold tabular-nums">{summary.data?.total ?? "…"}</p></div>
      </div>
      <Tabs defaultSelectedKey="summary">
        <TabList aria-label="Valuation views">
          <Tab id="summary">Summary</Tab><Tab id="warehouse">By warehouse</Tab><Tab id="item">By item</Tab>
          {can?.layers && <Tab id="layers">FIFO layers</Tab>}{can?.movements && <Tab id="movements">Valuation movements</Tab>}
          {can?.reconcileView && <Tab id="reconcile">Reconciliation</Tab>}{can?.reconcileView && <Tab id="history">History</Tab>}
        </TabList>
        <TabPanel id="summary"><div className="pt-4">
          {summary.isLoading ? <LoadingState label="Loading valuation" rows={4} /> : summary.isError ? <ErrorState title="Could not load valuation" description={errorMessage(summary.error)} />
            : !summary.data?.rows.length ? <EmptyState title="No stock to value" description="Inventory value appears once stock has been received." />
            : <ValueTable rows={summary.data.rows} showRate={Boolean(can?.rate)} total={summary.data.totals.value} />}
        </div></TabPanel>
        <TabPanel id="warehouse"><div className="pt-4"><GroupedView filters={{ ...base, view: "warehouse" }} /></div></TabPanel>
        <TabPanel id="item"><div className="pt-4"><GroupedView filters={{ ...base, view: "item" }} showRate={Boolean(can?.rate)} /></div></TabPanel>
        {can?.layers && <TabPanel id="layers"><div className="pt-4"><LayersView filters={{ warehouseId: base.warehouseId, itemId }} /></div></TabPanel>}
        {can?.movements && <TabPanel id="movements"><div className="pt-4"><MovementsView filters={{ warehouseId: base.warehouseId, itemId }} onOpen={openEntry} showRate={Boolean(can?.rate)} showSource={Boolean(can?.costSource)} /></div></TabPanel>}
        {can?.reconcileView && <TabPanel id="reconcile"><div className="pt-4"><ReconcileView canRun={Boolean(can?.reconcileRun)} canRebuild={Boolean(can?.rebuild)} /></div></TabPanel>}
        {can?.reconcileView && <TabPanel id="history"><div className="pt-4"><HistoryView /></div></TabPanel>}
      </Tabs>
      {entryId && <EntryDialog id={entryId} onClose={() => router.push(VALUATION_BASE)} />}
    </div>
  );
}

function ValueTable({ rows, showRate, total }: { rows: ValuationRow[]; showRate: boolean; total: number }) {
  return (
    <Table headers={["SKU", "Item", "Warehouse", "Base UOM", "On hand", "Method", ...(showRate ? ["Valuation rate"] : []), "Inventory value"]}>
      {rows.map((row) => (
        <tr key={row.key}>
          <Cell><Link className="font-medium text-brand hover:underline" href={`/inventory/stock/items/${row.itemId}`}>{row.sku}</Link></Cell><Cell>{row.itemName}</Cell><Cell>{row.warehouse}</Cell><Cell>{row.baseUom}</Cell>
          <Cell className={`tabular-nums ${row.negative ? "font-semibold text-danger" : ""}`}>{quantity(row.onHand ?? 0)}{row.negative ? <> <Badge tone="danger">Provisional</Badge></> : null}</Cell>
          <Cell>{row.methodLabel}</Cell>
          {showRate && <Cell className="tabular-nums">{row.rate === null || row.rate === undefined ? "—" : <>{money(row.rate)}{row.rateKind === "carrying" ? <span className="block text-xs text-text-muted">carrying rate</span> : null}</>}</Cell>}
          <Cell className="tabular-nums font-medium">{money(row.value)}</Cell>
        </tr>
      ))}
      <tr className="bg-surface-muted font-semibold"><Cell>Total</Cell><Cell /><Cell /><Cell /><Cell /><Cell />{showRate && <Cell />}<Cell className="tabular-nums">{money(total)}</Cell></tr>
    </Table>
  );
}

function GroupedView({ filters, showRate = false }: { filters: Record<string, string | undefined>; showRate?: boolean }) {
  const workspace = useWorkspaceContext();
  const report = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "grouped", filters), queryFn: () => getValuation(filters) });
  if (report.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (report.isError) return <ErrorState title="Could not load valuation" description={errorMessage(report.error)} />;
  const rows = report.data?.rows ?? [];
  if (!rows.length) return <p className="text-sm text-text-muted">No stock to value.</p>;
  if (filters.view === "warehouse")
    return (
      <Table headers={["Warehouse", "Items", "Inventory value"]}>
        {rows.map((row) => <tr key={row.key}><Cell><Link className="text-brand hover:underline" href={`/inventory/warehouses/${row.warehouseId}`}>{row.warehouse} · {row.warehouseName}</Link></Cell>
          <Cell className="tabular-nums">{row.items}</Cell><Cell className="tabular-nums font-medium">{money(row.value)}</Cell></tr>)}
        <tr className="bg-surface-muted font-semibold"><Cell>Company</Cell><Cell /><Cell className="tabular-nums">{money(report.data!.totals.value)}</Cell></tr>
      </Table>
    );
  return (
    <Table headers={["SKU", "Item", "Method", "On hand", ...(showRate ? ["Average carrying rate"] : []), "Inventory value"]}>
      {rows.map((row) => <tr key={row.key}><Cell>{row.sku}</Cell><Cell>{row.itemName}</Cell><Cell>{row.methodLabel}</Cell><Cell className="tabular-nums">{quantity(row.onHand ?? 0, row.baseUom)}</Cell>
        {showRate && <Cell className="tabular-nums">{row.rate === null || row.rate === undefined ? "—" : money(row.rate)}</Cell>}<Cell className="tabular-nums font-medium">{money(row.value)}</Cell></tr>)}
      <tr className="bg-surface-muted font-semibold"><Cell>Company</Cell><Cell /><Cell /><Cell />{showRate && <Cell />}<Cell className="tabular-nums">{money(report.data!.totals.value)}</Cell></tr>
    </Table>
  );
}

function LayersView({ filters }: { filters: Record<string, string | undefined> }) {
  const workspace = useWorkspaceContext();
  const [all, setAll] = useState(false);
  const layers = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "layers", filters, all), queryFn: () => getLayers({ ...filters, includeExhausted: all ? "true" : undefined }) });
  if (layers.isLoading) return <LoadingState label="Loading layers" rows={3} />;
  if (layers.isError) return <ErrorState title="Could not load FIFO layers" description={errorMessage(layers.error)} />;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(event) => setAll(event.target.checked)} />Include used-up layers</label>
      {!(layers.data ?? []).length ? <p className="text-sm text-text-muted">No FIFO layers. Moving-average items have none.</p> : (
        <Table headers={["Layer", "Item", "Warehouse", "Source", "Date", "Original qty", "Remaining qty", "Unit cost", "Remaining value"]}>
          {layers.data!.map((layer) => (
            <tr key={layer.id} className={layer.status === "exhausted" ? "text-text-muted" : ""}>
              <Cell>{layer.label}</Cell><Cell>{layer.sku}</Cell><Cell>{layer.warehouse}</Cell>
              <Cell>{layer.source ? (layer.source.href ? <Link className="text-brand hover:underline" href={layer.source.href}>{layer.source.number}</Link> : layer.source.number) : layer.movement}
                {layer.transferredFrom ? <span className="block text-xs text-text-muted">transferred from {layer.transferredFrom}</span> : null}</Cell>
              <Cell>{formatDate(layer.date)}</Cell><Cell className="tabular-nums">{quantity(layer.originalQuantity)}</Cell><Cell className="tabular-nums">{quantity(layer.remainingQuantity)}</Cell>
              <Cell className="tabular-nums">{money(layer.unitCost)}</Cell><Cell className="tabular-nums font-medium">{money(layer.remainingValue)}</Cell>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function MovementsView({ filters, onOpen, showRate, showSource }: { filters: Record<string, string | undefined>; onOpen: (id: string) => void; showRate: boolean; showSource: boolean }) {
  const workspace = useWorkspaceContext();
  const movements = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "movements", filters), queryFn: () => getValueMovements({ ...filters, order: "desc", limit: "300" }) });
  if (movements.isLoading) return <LoadingState label="Loading value movements" rows={4} />;
  if (movements.isError) return <ErrorState title="Could not load value movements" description={errorMessage(movements.error)} />;
  if (!(movements.data ?? []).length) return <p className="text-sm text-text-muted">No value movements yet.</p>;
  return (
    <Table headers={["Date", "Source", "Type", "Item", "Warehouse", "Qty", ...(showRate ? ["Rate"] : []), "Value change", "Balance value", ...(showSource ? ["Cost source"] : [])]}>
      {movements.data!.map((row) => (
        <tr key={row.id} className="cursor-pointer hover:bg-surface-muted" onClick={() => onOpen(row.id)}>
          <Cell>{formatDate(row.date)}</Cell>
          <Cell>{row.source ? (row.source.href ? <Link className="text-brand hover:underline" href={row.source.href} onClick={(event) => event.stopPropagation()}>{row.source.number}</Link> : row.source.number) : row.movement}</Cell>
          <Cell>{row.type}{row.kind !== "movement" ? <> <Badge tone="warning">{row.kind === "settlement" ? "Settlement" : "Restated"}</Badge></> : null}</Cell>
          <Cell>{row.sku}</Cell><Cell>{row.warehouse}</Cell><Cell className="tabular-nums">{row.quantity > 0 ? "+" : ""}{quantity(row.quantity)}</Cell>
          {showRate && <Cell className="tabular-nums">{row.rate === undefined ? "—" : money(row.rate)}</Cell>}
          <Cell className={`tabular-nums ${row.value < 0 ? "text-danger" : ""}`}>{row.value > 0 ? "+" : ""}{money(row.value)}</Cell>
          <Cell className="tabular-nums">{row.balanceValue === null ? "—" : money(row.balanceValue)}</Cell>
          {showSource && <Cell>{row.costSourceLabel}</Cell>}
        </tr>
      ))}
    </Table>
  );
}

function EntryDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const detail = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "entry", id), queryFn: () => getEntry(id) });
  const data = detail.data;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={data ? `${data.entry.type} · ${data.entry.sku}` : "Valuation"} size="lg">
      {detail.isLoading ? <LoadingState label="Loading" rows={3} /> : detail.isError ? <p className="text-sm text-danger">{errorMessage(detail.error)}</p> : data && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="Effective">{formatDateTime(data.entry.date)}</Fact><Fact label="Posted">{formatDateTime(data.entry.postedAt)}</Fact><Fact label="Method">{data.entry.methodLabel}</Fact>
            <Fact label="Warehouse">{data.entry.warehouse}</Fact><Fact label="Base quantity">{quantity(data.entry.quantity)}</Fact>
            {data.entry.rate !== undefined && <Fact label="Base unit cost">{money(data.entry.rate)}</Fact>}
            <Fact label="Inventory value effect"><span className={data.entry.value < 0 ? "text-danger" : ""}>{money(data.entry.value)}</span></Fact>
            {data.entry.costSourceLabel && <Fact label="Cost source">{data.entry.costSourceLabel}</Fact>}
            {data.movement && <Fact label="Stock movement"><Link className="text-brand hover:underline" href={data.movement.href}>{data.movement.number}</Link></Fact>}
            {data.entry.source && <Fact label="Source document">{data.entry.source.href ? <Link className="text-brand hover:underline" href={data.entry.source.href}>{data.entry.source.number}</Link> : data.entry.source.number}</Fact>}
          </div>
          {data.exchange && <p>Foreign currency: {data.exchange.sourceCurrency} {data.exchange.sourceUnitCost} per unit at {data.exchange.rate} → {data.exchange.baseCurrency} (rate kept as posted).</p>}
          {data.allocations.length > 0 && <div><p className="font-medium">FIFO layers {data.entry.quantity < 0 ? "consumed" : "restored"}</p>
            <ul className="list-disc pl-5">{data.allocations.map((row) => <li key={row.layerId}>{quantity(Math.abs(row.quantity))} at {money(row.unitCost)} = {money(Math.abs(row.value))} from {row.layerSource?.number ?? "a layer"} ({formatDate(row.layerDate)}){row.restored ? " · restored" : ""}</li>)}</ul></div>}
          {data.layersOpened.length > 0 && <div><p className="font-medium">FIFO layers opened</p>
            <ul className="list-disc pl-5">{data.layersOpened.map((layer) => <li key={layer.id}>{quantity(layer.quantity)} at {money(layer.unitCost)} = {money(layer.value)}</li>)}</ul></div>}
          {data.reversalOf && <p>Reverses the valuation of {data.reversalOf.movement ?? "an earlier movement"} exactly.</p>}
          {data.reversedBy.map((row) => <p key={row.id}>Reversed by {row.movement} ({money(row.value)}).</p>)}
          {data.restatements.length > 0 && <div><p className="font-medium">Restated by backdated movements</p>
            <ul className="list-disc pl-5">{data.restatements.map((row) => <li key={row.id}>{money(row.value)} ({formatDate(row.date)})</li>)}</ul></div>}
          <div><p className="font-medium">Finance</p>{data.journals.length ? <ul className="list-disc pl-5">{data.journals.map((journal) => <li key={journal.id}><Link className="text-brand hover:underline" href={journal.href}>{journal.number}</Link> · {journal.date} · {journal.status}</li>)}</ul>
            : <p className="text-text-muted">No journal for this movement&apos;s document (transfers and moves within the company post none).</p>}</div>
        </div>
      )}
    </Dialog>
  );
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs text-text-muted">{label}</p><p>{children}</p></div>;

function ReconcileView({ canRun, canRebuild }: { canRun: boolean; canRebuild: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [reason, setReason] = useState("");
  const check = useMutation({ mutationFn: canRun ? runValuationReconciliation : checkValuation, onSuccess: setReport });
  const rebuild = useMutation({ mutationFn: () => rebuildValuation(reason), onSuccess: () => { setRebuilding(false); setReason(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "valuation") }); check.mutate(); } });
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-text-muted">Stock quantity against valuation quantity, FIFO layers against balances, balances against their entries, movements without valuation, missing or
        unauthorised zero cost, negative values, value left with no stock — and inventory value against the Inventory Asset accounts in the General Ledger. Differences are shown, never adjusted.</p>
      <div className="flex gap-2">
        <Button variant="primary" isLoading={check.isPending} onPress={() => check.mutate()}>{canRun ? "Run reconciliation" : "Check now"}</Button>
        {canRebuild && <Button variant="secondary" onPress={() => setRebuilding(true)}>Rebuild valuation projection…</Button>}
      </div>
      {check.isError && <p role="alert" className="text-danger">{errorMessage(check.error)}</p>}
      {report && <>
        <div className="flex flex-wrap items-center gap-3">
          {report.consistent ? <StatusBadge tone="success">Reconciled</StatusBadge> : <StatusBadge tone="danger">{`${report.exceptions.length} exception${report.exceptions.length === 1 ? "" : "s"}`}</StatusBadge>}
          <span>Company value {money(report.companyValue)} over {report.positions} positions · checked {formatDateTime(report.checkedAt)}</span>
        </div>
        {report.warehouses.length > 0 && <Table headers={["Warehouse", "Value"]}>{report.warehouses.map((row) => <tr key={row.warehouseId}><Cell>{row.warehouse}</Cell><Cell className="tabular-nums">{money(row.value)}</Cell></tr>)}
          <tr className="bg-surface-muted font-semibold"><Cell>Company (sum of warehouses)</Cell><Cell className="tabular-nums">{money(report.warehouses.reduce((sum, row) => sum + row.value, 0))}</Cell></tr></Table>}
        {report.finance && <div className="flex flex-col gap-1"><p className="font-medium">Inventory Asset accounts (General Ledger)</p>
          <Table headers={["Account", "Inventory valuation", "GL balance", "Difference", "Status"]}>
            {report.finance.accounts.map((account) => <tr key={account.accountId ?? account.account}><Cell>{account.account}</Cell><Cell className="tabular-nums">{money(account.valuation)}</Cell>
              <Cell className="tabular-nums">{account.ledger === null ? "—" : money(account.ledger)}</Cell><Cell className="tabular-nums">{account.difference === null ? "—" : money(account.difference)}</Cell>
              <Cell><StatusBadge tone={account.status === "reconciled" ? "success" : account.status === "rounding" ? "info" : "danger"}>{account.status === "not_reconciled" ? "Not reconciled" : account.status === "rounding" ? "Rounding" : account.status === "unmapped" ? "No account" : "Reconciled"}</StatusBadge></Cell></tr>)}
          </Table></div>}
        {report.exceptions.length > 0 && <Table headers={["Exception", "Item", "Warehouse", "Detail"]}>
          {report.exceptions.map((entry, index) => <tr key={index}><Cell><span className="font-medium">{entry.label}</span><span className="block text-xs text-text-muted">{entry.code}</span></Cell><Cell>{entry.sku}</Cell><Cell>{entry.warehouse}</Cell>
            <Cell className="text-xs">{Object.entries(entry).filter(([key]) => !["code", "label", "sku", "warehouse", "itemId", "warehouseId", "accountId"].includes(key)).map(([key, value]) => `${key}: ${value}`).join(" · ")}</Cell></tr>)}
        </Table>}
      </>}
      {rebuilding && (
        <Dialog isOpen onOpenChange={(open) => !open && setRebuilding(false)} title="Rebuild the valuation projection">
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-text-muted">Recalculates every warehouse&apos;s quantity and value from the valuation entries, and every FIFO layer&apos;s remainder from its allocations. No entry is changed.</p>
            <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
            {rebuild.isError && <p role="alert" className="text-danger">{errorMessage(rebuild.error)}</p>}
            <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setRebuilding(false)}>Cancel</Button>
              <Button variant="primary" isDisabled={!reason.trim()} isLoading={rebuild.isPending} onPress={() => rebuild.mutate()}>Rebuild</Button></div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function HistoryView() {
  const workspace = useWorkspaceContext();
  const events = useQuery({ queryKey: scopedQueryKey(workspace, "valuation", "events"), queryFn: getValuationEvents });
  if (events.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (events.isError) return <ErrorState title="Could not load the history" description={errorMessage(events.error)} />;
  if (!(events.data ?? []).length) return <p className="text-sm text-text-muted">No reconciliations, rebuilds or restatements yet.</p>;
  return <ul className="flex flex-col divide-y divide-border text-sm">{events.data!.map((event) => <li key={event.id} className="py-2"><span className="font-medium">{event.summary}</span>
    <span className="block text-xs text-text-muted">{formatDateTime(event.at)}{event.by ? ` · ${event.by}` : ""}</span></li>)}</ul>;
}
