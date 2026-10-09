"use client";

// Replenishment: which items need replenishing at which warehouse, how much, and why — eligible on hand, firm demand, firm incoming, the
// positions before and after incoming, the reorder level and target. Views: Requirements (the default), Covered by Incoming, Alerts
// (low-stock alerts derived from the same rules) and Rules. Planning only: drafts are opened from a requirement or alert; nothing here moves stock.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, Plus, Upload } from "lucide-react";
import {
  Badge, Button, Checkbox, ComboBox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, MetricCard, NoResultsState, PermissionState, SearchField, Select,
  StatusBadge, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { listItems } from "@/features/items/api/items-api";
import { quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  REPLENISHMENT_BASE, STATUS_TONE, createRule, errorCode, errorMessage, exportUrl, getOptions, importRules, listRules, reconcile, type ImportResult, type ReorderRule,
} from "../api/replenishment-api";
import { AlertsPanel } from "./AlertsPanel";

const ANY = "any";
const TABS = [
  { id: "required", label: "Requirements" }, { id: "covered", label: "Covered by Incoming" }, { id: "alerts", label: "Alerts" }, { id: "rules", label: "Rules" },
] as const;

export function ItemPicker({ value, onChange, label = "Item" }: { value: string | null; onChange: (id: string | null) => void; label?: string }) {
  const workspace = useWorkspaceContext();
  const [text, setText] = useState("");
  const items = useQuery({
    queryKey: scopedQueryKey(workspace, "replenishment", "item-picker", text),
    queryFn: () => listItems({ search: text || undefined, inventoryTracked: "true", limit: 20 }),
    staleTime: 15_000,
  });
  return (
    <ComboBox aria-label={label} label={label === "Item" ? undefined : label} placeholder="Item (SKU or name)" className="w-full sm:w-64"
      options={(items.data?.products ?? []).map((row) => ({ value: row.id, label: `${row.code} · ${row.name}` }))}
      selectedKey={value} onSelectionChange={(key) => onChange(key ? String(key) : null)} onInputChange={setText} isLoading={items.isFetching}
      emptyMessage={items.isError ? "Search failed. Try again." : "No matching stock items"} allowsEmptyCollection />
  );
}

export function ReorderStatusBadge({ rule }: { rule: Pick<ReorderRule, "status" | "statusLabel" | "overdueIncoming"> }) {
  return <span className="flex flex-wrap gap-1"><StatusBadge tone={STATUS_TONE[rule.status]}>{rule.statusLabel}</StatusBadge>
    {rule.overdueIncoming && <Badge tone="warning">Overdue incoming</Badge>}</span>;
}

const qtyCell = (value: number, uom?: string | null) => <span className="tabular-nums">{quantity(value, uom)}</span>;

export function ReplenishmentScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const initialTab = params.get("tab") ?? ({ all: "rules" } as Record<string, string>)[params.get("view") ?? ""] ?? params.get("view") ?? "required";
  const [view, setViewState] = useState<string>(TABS.some((tab) => tab.id === initialTab) ? initialTab : "required");
  // The view is in the address (a link can open it).
  const setView = (tab: string) => { setViewState(tab); router.replace(`${REPLENISHMENT_BASE}?tab=${tab}`, { scroll: false }); };
  const [warehouseId, setWarehouseId] = useState(params.get("warehouseId") ?? ANY);
  const [categoryId, setCategoryId] = useState(ANY);
  const [itemId, setItemId] = useState<string | null>(params.get("itemId"));
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [overdue, setOverdue] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const pick = (value: string) => (value === ANY ? undefined : value);
  const filters = useMemo(() => ({ view: view === "rules" ? "all" : view, warehouseId: pick(warehouseId), categoryId: pick(categoryId), itemId: itemId ?? undefined, search: submitted || undefined,
    overdue: overdue ? "true" : undefined }), [view, warehouseId, categoryId, itemId, submitted, overdue]);
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "options"), queryFn: getOptions, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "replenishment", "list", filters), queryFn: () => listRules(filters), placeholderData: (previous) => previous,
    enabled: view !== "alerts" });
  const client = useQueryClient();
  const recheck = useMutation({ mutationFn: reconcile, onSuccess: () => void client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "replenishment") }) });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "sku", desc: false }] });

  const columns = useMemo<ColumnDef<ReorderRule, unknown>[]>(() => [
    { id: "sku", accessorKey: "sku", header: "SKU", cell: ({ row }) => <span className="font-medium text-text">{row.original.sku}</span> },
    { id: "itemName", accessorKey: "itemName", header: "Item", cell: ({ row }) => row.original.itemName },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "eligibleOnHand", accessorKey: "eligibleOnHand", header: "Eligible on hand", cell: ({ row }) => qtyCell(row.original.eligibleOnHand, row.original.baseUom) },
    { id: "firmDemand", accessorKey: "firmDemand", header: "Firm demand", cell: ({ row }) => qtyCell(row.original.firmDemand) },
    { id: "currentPosition", accessorKey: "currentPosition", header: "Current position", cell: ({ row }) => (
      <span className={`tabular-nums ${row.original.currentPosition <= row.original.reorderLevel && row.original.enabled ? "text-warning" : ""}`}>{quantity(row.original.currentPosition)}</span>
    ) },
    { id: "firmIncoming", accessorKey: "firmIncoming", header: "Firm incoming", cell: ({ row }) => qtyCell(row.original.firmIncoming) },
    { id: "projectedPosition", accessorKey: "projectedPosition", header: "Projected", cell: ({ row }) => qtyCell(row.original.projectedPosition) },
    { id: "reorderLevel", accessorKey: "reorderLevel", header: "Reorder level", cell: ({ row }) => qtyCell(row.original.reorderLevel) },
    { id: "targetLevel", accessorKey: "targetLevel", header: "Target", cell: ({ row }) => qtyCell(row.original.targetLevel) },
    { id: "suggested", accessorKey: "suggested", header: "Suggested", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.suggested > 0 ? quantity(row.original.suggested, row.original.baseUom) : "—"}</span> },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => (
      <span className="flex flex-col gap-0.5"><ReorderStatusBadge rule={row.original} />
        {row.original.recommendation?.status === "actioned" && <span className="text-xs text-text-muted">Draft {row.original.recommendation.actionNumber} opened</span>}
        {row.original.recommendation?.status === "dismissed" && <span className="text-xs text-text-muted">Recommendation dismissed</span>}</span>
    ) },
    { id: "nextIncoming", accessorKey: "nextIncoming", header: "Next incoming", cell: ({ row }) => <span className="whitespace-nowrap">{row.original.nextIncoming ? formatDate(row.original.nextIncoming) : ""}</span> },
  ], []);

  if (options.isError && errorCode(options.error) === "PERMISSION_DENIED")
    return <PermissionState title="You don't have access to replenishment" description="Ask an administrator for the View Reorder Levels permission." />;
  const can = options.data?.capabilities;
  const counts = list.data?.counts;
  const o = options.data;
  const filterBar = view === "alerts" ? undefined : filterBarOf([
    { id: "item", active: Boolean(itemId), label: "One item", clear: () => setItemId(null) },
    { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(o?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
    { id: "category", active: categoryId !== ANY, label: `Category: ${optionLabel(o?.categories, categoryId)}`, clear: () => setCategoryId(ANY) },
    { id: "overdue", active: overdue, label: "Overdue incoming only", clear: () => setOverdue(false) },
  ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar);

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Replenishment",
          description: "Static Min/Max reorder rules per warehouse. A requirement counts eligible stock, firm demand and confirmed incoming, so it never asks twice for stock already on its way. Planning only: nothing here moves stock or confirms a purchase.",
          primaryAction: can?.create ? <Button variant="primary" onPress={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" />New reorder rule</Button> : undefined,
          secondaryActions: (
            <>
              {can?.export && view !== "alerts" && <>
                <a className={buttonVariants({ variant: "outline" })} href={exportUrl({ ...filters }, "csv")} download><Download className="size-4" aria-hidden="true" />CSV</a>
                <a className={buttonVariants({ variant: "outline" })} href={exportUrl({ ...filters }, "xlsx")} download><Download className="size-4" aria-hidden="true" />Excel</a>
              </>}
              {can?.import && <Button variant="outline" onPress={() => setImporting(true)}><Upload className="size-4" aria-hidden="true" />Import rules</Button>}
              {can?.edit && <Button variant="outline" isLoading={recheck.isPending} onPress={() => recheck.mutate()}>Recalculate</Button>}
            </>
          ),
        }}
        savedViews={{
          views: TABS.map((tab) => ({ id: tab.id, label: tab.label, count: counts && tab.id === "required" ? counts.required : counts && tab.id === "covered" ? counts.covered : undefined })),
          activeViewId: view, onSelect: setView,
        }}
        actionBar={view === "alerts" ? undefined : {
          start: (
            <>
              <SearchField aria-label="Search" placeholder="SKU, item, barcode or warehouse" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <ItemPicker value={itemId} onChange={setItemId} />
              <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
                options={[{ value: ANY, label: "All warehouses" }, ...(o?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
              <Select aria-label="Category" size="compact" selectedKey={categoryId} onSelectionChange={(key) => setCategoryId(String(key))}
                options={[{ value: ANY, label: "All categories" }, ...(o?.categories ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
              <Checkbox isSelected={overdue} onChange={setOverdue}>Overdue incoming only</Checkbox>
            </>
          ),
        }}
        filterBar={filterBar}
      >
        {recheck.data && <Notice tone="success">{recheck.data.rules} rule{recheck.data.rules === 1 ? "" : "s"} recalculated from their sources{recheck.data.consistent ? "; nothing had drifted." : `; ${recheck.data.differences.length} corrected.`}</Notice>}
        {view === "alerts" ? <AlertsPanel options={o} /> : (
          <>
            {counts && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <button type="button" className="text-left" onClick={() => setView("required")}><MetricCard label="Require replenishment" value={counts.required} /></button>
                <MetricCard label="Out of stock" value={counts.outOfStock} />
                <button type="button" className="text-left" onClick={() => setView("covered")}><MetricCard label="Covered by incoming" value={counts.covered} /></button>
                <button type="button" className="text-left" onClick={() => setView("rules")}><MetricCard label="Rules" value={counts.rules} /></button>
              </div>
            )}
            <EnterpriseDataGrid<ReorderRule>
              aria-label="Reorder rules"
              columns={columns}
              data={paged.pageRows}
              getRowId={(row) => row.id}
              state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
              loadingContent={<LoadingState label="Loading replenishment" rows={8} />}
              errorContent={<ErrorState title="Could not load replenishment" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
              emptyContent={<EmptyState title={view === "required" ? "Nothing needs replenishing" : view === "covered" ? "Nothing is waiting on incoming stock" : "No reorder rules yet"}
                description={view === "rules" ? "Add a reorder level and target for an item at a warehouse, or import them from a file." : "Every enabled rule is above its reorder level after firm demand and confirmed incoming."} />}
              noResultsContent={<NoResultsState title="No rules match" description="Try another search or filter." />}
              {...paged.grid}
              onRowClick={(row) => router.push(`${REPLENISHMENT_BASE}/${row.id}`)}
              renderMobileCard={(row) => (
                <div className="flex flex-col gap-1">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.sku} · {row.warehouse}</span><ReorderStatusBadge rule={row} /></span>
                  <span className="text-xs text-text-muted">Projected {quantity(row.projectedPosition)} · reorder at {quantity(row.reorderLevel)}{row.suggested > 0 ? ` · suggest ${quantity(row.suggested, row.baseUom)}` : ""}</span>
                </div>
              )}
            />
            {rows[0]?.calculatedAt && <p className="text-xs text-text-muted">Recalculated whenever stock, orders, purchase orders or transfers change; last change {formatDateTime(rows[0].calculatedAt)}. All quantities in base units.</p>}
          </>
        )}
      </EnterpriseListPage>
      {creating && <NewRuleDialog warehouses={o?.warehouses ?? []} onClose={() => setCreating(false)} onCreated={(id) => router.push(`${REPLENISHMENT_BASE}/${id}`)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function NewRuleDialog({ warehouses, onClose, onCreated }: { warehouses: Array<{ id: string; code: string; name: string }>; onClose: () => void; onCreated: (id: string) => void }) {
  const [itemId, setItemId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [reorderLevel, setReorderLevel] = useState("");
  const [targetLevel, setTargetLevel] = useState("");
  const [orderMultiple, setOrderMultiple] = useState("");
  const [notes, setNotes] = useState("");
  const save = useMutation({
    mutationFn: () => createRule({ itemId: itemId ?? "", warehouseId, reorderLevel, targetLevel, orderMultiple: orderMultiple || null, notes: notes || null }),
    onSuccess: (detail) => onCreated(detail.rule.id),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="New reorder rule">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">Quantities are in the item&apos;s base unit. Replenishment is required when the projected position (eligible stock − firm demand + confirmed incoming) is at or below the reorder level; it suggests enough to reach the target.</p>
        <ItemPicker value={itemId} onChange={setItemId} label="Stock item" />
        <Select label="Warehouse" selectedKey={warehouseId || null} onSelectionChange={(key) => setWarehouseId(String(key))} options={warehouses.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))} />
        <div className="grid grid-cols-3 gap-2">
          <TextField label="Reorder level" inputMode="decimal" value={reorderLevel} onChange={setReorderLevel} />
          <TextField label="Target stock level" inputMode="decimal" value={targetLevel} onChange={setTargetLevel} />
          <TextField label="Order multiple" inputMode="decimal" value={orderMultiple} onChange={setOrderMultiple} description="Optional" />
        </div>
        <TextField label="Notes" value={notes} onChange={setNotes} />
        {save.isError && <p role="alert" className="text-danger">{errorMessage(save.error)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!itemId || !warehouseId} onPress={() => save.mutate()}>Create rule</Button>
        </div>
      </div>
    </Dialog>
  );
}

// Upload → validate → preview → apply. Nothing is applied while any row has an error.
function ImportDialog({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const check = useMutation({ mutationFn: () => importRules(file!, false), onSuccess: setPreview });
  const apply = useMutation({ mutationFn: () => importRules(file!, true), onSuccess: (result) => { setPreview(result); void client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "replenishment") }); } });
  const error = check.error ?? apply.error;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Import reorder rules">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">CSV or XLSX with the columns SKU, Warehouse Code, Enabled, Reorder Level, Target Stock Level, Order Multiple (base units). An export of this page imports back. Existing rules are updated; nothing is applied while any row has an error.</p>
        <input type="file" accept=".csv,.xlsx" aria-label="Rules file" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); }} />
        {error && <p role="alert" className="text-danger">{errorMessage(error)}</p>}
        {preview && <>
          <p className={preview.summary.errors ? "text-danger" : preview.applied ? "text-success" : ""} role="status">
            {preview.applied ? `Applied: ${preview.summary.create} created, ${preview.summary.update} updated.` : `${preview.summary.rows} rows: ${preview.summary.create} to create, ${preview.summary.update} to update, ${preview.summary.errors} with errors.`}</p>
          <div className="max-h-72 overflow-y-auto rounded-[var(--radius-control)] border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface-muted text-left text-text-secondary"><tr>{["Row", "SKU", "Warehouse", "Reorder", "Target", "Multiple", "Result"].map((label) => <th key={label} className="px-2 py-1 font-medium">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">{preview.rows.map((row) => (
                <tr key={row.line}><td className="px-2 py-1">{row.line}</td><td className="px-2 py-1">{row.sku}</td><td className="px-2 py-1">{row.warehouse}</td>
                  <td className="px-2 py-1">{row.reorderLevel}</td><td className="px-2 py-1">{row.targetLevel}</td><td className="px-2 py-1">{row.orderMultiple ?? ""}</td>
                  <td className={`px-2 py-1 ${row.errors.length ? "text-danger" : ""}`}>{row.errors.length ? row.errors.join(" ") : row.action === "create" ? "Create" : "Update"}{row.errors.length === 0 && !row.enabled ? " (disabled)" : ""}</td></tr>))}</tbody>
            </table>
          </div>
        </>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="secondary" isDisabled={!file} isLoading={check.isPending} onPress={() => check.mutate()}>Validate</Button>
          <Button variant="primary" isDisabled={!file || !preview || preview.summary.errors > 0 || preview.applied} isLoading={apply.isPending} onPress={() => apply.mutate()}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}
