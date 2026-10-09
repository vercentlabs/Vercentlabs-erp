"use client";

// Quality Holds: stock kept on hand but restricted — on quality hold awaiting a decision, or in quarantine — until it is released, moved to
// damaged, returned or disposed of. Views of the holds by status, and Held stock: the restricted stock itself (and anything held that no hold
// explains). Hold reasons are configured in Inventory Configuration › Reason Codes.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import {
  Badge, Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, PermissionState, SearchField, Select, StatusBadge,
  TextArea, TextField,
} from "@vercentlabs/design-system";

import { quantity } from "@/features/items/item-format";
import { formatDate, formatDateTime } from "@/shared/format/human";
import { filterBarOf, optionLabel, useDebouncedValue, usePagedRows } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  QUALITY_HOLDS_BASE, STATUS_TONE, createReason, errorCode, errorMessage, getHoldOptions, listHeldStock, listHolds, listReasons, registerHeld, updateReason, type HeldStockRow,
  type HoldHeader, type HoldType,
} from "../api/quality-holds-api";

const ANY = "any";
const VIEWS = [{ id: "active", label: "Active" }, { id: "quality_hold", label: "Quality hold" }, { id: "quarantine", label: "Quarantined" }, { id: "overdue", label: "Overdue" },
  { id: "partially_resolved", label: "Partially resolved" }, { id: "resolved", label: "Resolved" }, { id: "draft", label: "Draft" }, { id: "all", label: "All" },
  { id: "held", label: "Held stock" }];
const DISPOSITIONS: Record<string, string> = { quality_hold: "Quality hold", quarantined: "Quarantined", damaged: "Damaged" };

export function QualityHoldsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState(params.get("itemId") ?? undefined);
  const [view, setView] = useState(params.get("view") ?? "active");
  const [search, setSearch] = useState("");
  const submitted = useDebouncedValue(search);
  const [warehouseId, setWarehouseId] = useState(ANY);
  const [disposition, setDisposition] = useState(ANY);
  const [registering, setRegistering] = useState<HeldStockRow | null>(null);
  const isHeld = view === "held";
  const filters = { view, itemId, search: submitted || undefined, warehouseId: warehouseId === ANY ? undefined : warehouseId };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "options"), queryFn: getHoldOptions, staleTime: 60_000 });
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "list", filters), queryFn: () => listHolds(filters), enabled: !isHeld, placeholderData: (previous) => previous });
  const held = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "held", disposition), queryFn: () => listHeldStock({ disposition: disposition === ANY ? undefined : disposition }), enabled: isHeld });
  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const heldRows = useMemo(() => held.data?.rows ?? [], [held.data]);
  const paged = usePagedRows(rows, { initialSorting: [{ id: "activatedAt", desc: true }] });
  const pagedHeld = usePagedRows(heldRows, { initialSorting: [{ id: "sku", desc: false }] });

  const holdColumns = useMemo<ColumnDef<HoldHeader, unknown>[]>(() => [
    { id: "number", accessorKey: "number", header: "Hold", cell: ({ row }) => <span className="font-medium text-text">{row.original.number}</span> },
    { id: "holdTypeLabel", accessorKey: "holdTypeLabel", header: "Type", cell: ({ row }) => <Badge tone={row.original.holdType === "quarantine" ? "danger" : "warning"}>{row.original.holdTypeLabel}</Badge> },
    { id: "skus", accessorKey: "skus", header: "Items", cell: ({ row }) => row.original.skus ?? "" },
    { id: "warehouse", accessorFn: (row) => row.currentWarehouses ?? row.originWarehouse, header: "Warehouse", cell: ({ row }) => row.original.currentWarehouses ?? row.original.originWarehouse },
    { id: "heldQuantity", accessorKey: "heldQuantity", header: "Held", cell: ({ row }) => (
      <span className="tabular-nums">{quantity(row.original.heldQuantity)}{row.original.heldQuantity !== row.original.originalQuantity ? <span className="text-xs text-text-muted"> of {quantity(row.original.originalQuantity)}</span> : null}</span>
    ) },
    { id: "reason", accessorKey: "reason", header: "Reason", cell: ({ row }) => row.original.reason },
    { id: "source", header: "Source", enableSorting: false, cell: ({ row }) => row.original.source.number ?? (row.original.source.type === "manual" ? "Manual" : "Existing stock") },
    { id: "activatedAt", accessorKey: "activatedAt", header: "Held since", cell: ({ row }) => (row.original.activatedAt ? formatDateTime(row.original.activatedAt) : "") },
    { id: "reviewDueOn", accessorKey: "reviewDueOn", header: "Review due", cell: ({ row }) => (row.original.reviewDueOn
      ? <span className={row.original.overdue ? "font-medium text-danger" : ""}>{formatDate(row.original.reviewDueOn)}{row.original.overdue ? " · overdue" : ""}</span> : "") },
    { id: "assignedUserName", accessorKey: "assignedUserName", header: "Reviewer", cell: ({ row }) => row.original.assignedUserName ?? "" },
    { id: "status", accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={STATUS_TONE[row.original.status]}>{row.original.statusLabel}</StatusBadge> },
  ], []);
  const heldColumns = useMemo<ColumnDef<HeldStockRow, unknown>[]>(() => [
    { id: "sku", accessorKey: "sku", header: "SKU", cell: ({ row }) => <Link className="font-medium text-brand hover:underline" href={`/inventory/stock/items/${row.original.itemId}`}>{row.original.sku}</Link> },
    { id: "itemName", accessorKey: "itemName", header: "Item", cell: ({ row }) => row.original.itemName },
    { id: "warehouse", accessorKey: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouse },
    { id: "location", accessorKey: "location", header: "Location", cell: ({ row }) => row.original.location },
    { id: "batch", accessorKey: "batch", header: "Batch", cell: ({ row }) => row.original.batch ?? "" },
    { id: "dispositionLabel", accessorKey: "dispositionLabel", header: "Disposition", cell: ({ row }) => row.original.dispositionLabel },
    { id: "onHand", accessorKey: "onHand", header: "On hand", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.onHand)}</span> },
    { id: "holds", accessorKey: "holds", header: "Hold cases", cell: ({ row }) => (
      <span className="flex flex-col">{row.original.holds ?? "—"}{row.original.unexplained > 0 ? <span className="text-xs text-danger">{quantity(row.original.unexplained)} with no hold case</span> : null}</span>
    ) },
    { id: "explain", header: "", enableSorting: false, cell: ({ row }) => (row.original.unexplained > 0
      ? <Button size="compact" variant="secondary" onPress={() => setRegistering(row.original)}>Explain with a hold…</Button> : null) },
  ], []);

  if (list.isError && errorCode(list.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to quality holds" description="Ask an administrator for the View quality-held stock permission." />;
  const filterBar = isHeld
    ? filterBarOf([{ id: "disposition", active: disposition !== ANY, label: `Disposition: ${DISPOSITIONS[disposition] ?? disposition}`, clear: () => setDisposition(ANY) }], pagedHeld.resetPage)
    : filterBarOf([
      { id: "warehouse", active: warehouseId !== ANY, label: `Warehouse: ${optionLabel(options.data?.warehouses, warehouseId, "code")}`, clear: () => setWarehouseId(ANY) },
      { id: "item", active: Boolean(itemId), label: "One item", clear: () => setItemId(undefined) },
    ], paged.resetPage);
  const filtered = Boolean(submitted) || Boolean(filterBar) || view !== "active";

  return (
    <>
      <EnterpriseListPage
        header={{
          title: "Quality Holds",
          description: "Stock that stays on hand but cannot be sold, reserved or issued until a quality decision: on quality hold or in quarantine. Placing and releasing move stock between dispositions; on hand never changes.",
          primaryAction: list.data?.canCreate ? <LinkButton href={`${QUALITY_HOLDS_BASE}/new`} variant="primary"><Plus className="size-4" aria-hidden="true" />New quality hold</LinkButton> : undefined,
        }}
        savedViews={{ views: VIEWS, activeViewId: view, onSelect: (id) => { setView(id); paged.resetPage(); } }}
        actionBar={isHeld ? {
          start: <Select aria-label="Disposition" size="compact" selectedKey={disposition} onSelectionChange={(key) => setDisposition(String(key))}
            options={[{ value: ANY, label: "Every restricted disposition" }, ...Object.entries(DISPOSITIONS).map(([value, label]) => ({ value, label }))]} />,
        } : {
          start: (
            <>
              <SearchField aria-label="Search holds" placeholder="Hold, SKU, item or source" className="w-full sm:w-80" value={search} onChange={setSearch} />
              <Select aria-label="Warehouse" size="compact" selectedKey={warehouseId} onSelectionChange={(key) => setWarehouseId(String(key))}
                options={[{ value: ANY, label: "Any warehouse" }, ...(options.data?.warehouses ?? []).map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.name}` }))]} />
            </>
          ),
        }}
        filterBar={filterBar}
      >
        {isHeld ? (
          <>
            {(held.data?.unexplained ?? 0) > 0 && <Notice>{held.data!.unexplained} position{held.data!.unexplained === 1 ? " is" : "s are"} held with no hold case. Explain each with a hold.</Notice>}
            <EnterpriseDataGrid<HeldStockRow>
              aria-label="Held stock"
              columns={heldColumns}
              data={pagedHeld.pageRows}
              getRowId={(row) => `${row.itemId}:${row.locationId}:${row.batchId ?? "-"}`}
              state={held.isLoading ? "loading" : held.isError ? "error" : heldRows.length === 0 ? "empty" : "ready"}
              loadingContent={<LoadingState label="Loading held stock" rows={6} />}
              errorContent={<ErrorState title="Could not load held stock" description={errorMessage(held.error)} action={{ label: "Try again", onPress: () => void held.refetch() }} />}
              emptyContent={<EmptyState title="Nothing is held" description="No stock is on quality hold, in quarantine or damaged." />}
              {...pagedHeld.grid}
            />
          </>
        ) : (
          <EnterpriseDataGrid<HoldHeader>
            aria-label="Quality holds"
            columns={holdColumns}
            data={paged.pageRows}
            getRowId={(row) => row.id}
            state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
            loadingContent={<LoadingState label="Loading quality holds" rows={8} />}
            errorContent={<ErrorState title="Could not load quality holds" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
            emptyContent={<EmptyState title="Nothing on hold" description="Stock put on quality hold or in quarantine — by hand, by a goods receipt or by a customer return — appears here." />}
            noResultsContent={<NoResultsState title="No holds match" description="Try another view, warehouse or search." />}
            {...paged.grid}
            onRowClick={(row) => router.push(`${QUALITY_HOLDS_BASE}/${row.id}`)}
            renderMobileCard={(row) => (
              <div className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2"><span className="font-medium">{row.number}</span><StatusBadge tone={STATUS_TONE[row.status]}>{row.statusLabel}</StatusBadge></span>
                <span className="text-xs text-text-muted">{row.holdTypeLabel} · {row.skus ?? ""} · {quantity(row.heldQuantity)} held</span>
                {row.reviewDueOn && <span className={`text-xs ${row.overdue ? "text-danger" : "text-text-secondary"}`}>Review {formatDate(row.reviewDueOn)}</span>}
              </div>
            )}
          />
        )}
      </EnterpriseListPage>
      {registering && <RegisterDialog row={registering} onClose={() => setRegistering(null)} onDone={() => { setRegistering(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality-holds") }); }} />}
    </>
  );
}

function RegisterDialog({ row, onClose, onDone }: { row: HeldStockRow; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const reasons = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "reasons", false), queryFn: () => listReasons() });
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(row.unexplained));
  const [notes, setNotes] = useState("");
  const register = useMutation({ mutationFn: () => registerHeld({ warehouseId: row.warehouseId, reasonId: reasonId ?? "", notes, positions: [{ itemId: row.itemId, locationId: row.locationId, batchId: row.batchId, quantity: amount }] }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Explain held stock · ${row.sku}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-text-muted">{row.warehouse} / {row.location}: {quantity(row.unexplained)} {row.dispositionLabel.toLowerCase()} with no hold case. This opens an active hold for it; no stock moves.</p>
        <Select label="Reason" isRequired selectedKey={reasonId} onSelectionChange={(key) => setReasonId(key ? String(key) : null)} options={(reasons.data ?? []).map((reason) => ({ value: reason.id, label: reason.name }))} />
        <TextField label="Quantity" inputMode="decimal" value={amount} onChange={setAmount} />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        {register.isError && <p role="alert" className="text-danger">{errorMessage(register.error)}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isDisabled={!reasonId} isLoading={register.isPending} onPress={() => register.mutate()}>Open hold</Button></div>
      </div>
    </Dialog>
  );
}

// Hold reasons (Inventory Settings → Quality Hold Reasons): managed with Manage hold reasons.
export function HoldReasons() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "options"), queryFn: getHoldOptions, staleTime: 60_000 });
  return <Reasons canManage={Boolean(options.data?.capabilities.manageReasons)} />;
}

function Reasons({ canManage }: { canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const reasons = useQuery({ queryKey: scopedQueryKey(workspace, "quality-holds", "reasons", true), queryFn: () => listReasons(true) });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<HoldType>("quality_hold");
  const [requiresNotes, setRequiresNotes] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "quality-holds") });
  const add = useMutation({ mutationFn: () => createReason({ code, name, defaultHoldType: type, requiresNotes }), onSuccess: () => { setCode(""); setName(""); refresh(); } });
  const toggle = useMutation({ mutationFn: (reason: { id: string; status: string; version: number }) => updateReason(reason.id, { status: reason.status === "active" ? "inactive" : "active", expectedVersion: reason.version }), onSuccess: refresh });
  if (reasons.isLoading) return <LoadingState label="Loading reasons" rows={3} />;
  return (
    <Panel title="Quality hold reasons" description="Why stock is put on quality hold or in quarantine, and the hold type each reason starts with. Reasons in use are deactivated, never deleted.">
      <LinesTable columns={["Code", "Name", "Default type", "Notes", "Status", ...(canManage ? [""] : [])]} empty={(reasons.data ?? []).length ? undefined : "No reasons yet."}>
        {(reasons.data ?? []).map((reason) => (
          <tr key={reason.id}>
            <Cell><span className="font-mono text-xs">{reason.code}</span></Cell>
            <Cell>{reason.name}</Cell>
            <Cell>{reason.defaultHoldType === "quarantine" ? "Quarantine" : "Quality hold"}</Cell>
            <Cell>{reason.requiresNotes ? "Required" : null}</Cell>
            <Cell><StatusBadge tone={reason.status === "active" ? "success" : "neutral"}>{reason.status === "active" ? "Active" : "Inactive"}</StatusBadge></Cell>
            {canManage && <Cell><Button size="compact" variant="ghost" onPress={() => toggle.mutate(reason)}>{reason.status === "active" ? "Deactivate" : "Activate"}</Button></Cell>}
          </tr>
        ))}
      </LinesTable>
      {canManage && <div className="flex flex-wrap items-end gap-2">
        <TextField label="Code" value={code} onChange={setCode} className="w-40" /><TextField label="Name" value={name} onChange={setName} className="w-64" />
        <Select label="Default type" selectedKey={type} onSelectionChange={(key) => setType(String(key) as HoldType)} options={[{ value: "quality_hold", label: "Quality hold" }, { value: "quarantine", label: "Quarantine" }]} />
        <Checkbox isSelected={requiresNotes} onChange={setRequiresNotes}>Notes required</Checkbox>
        <Button variant="primary" isDisabled={!code.trim() || !name.trim()} isLoading={add.isPending} onPress={() => add.mutate()}>Add reason</Button>
      </div>}
      {(add.isError || toggle.isError) && <Notice>{errorMessage(add.error ?? toggle.error)}</Notice>}
    </Panel>
  );
}
