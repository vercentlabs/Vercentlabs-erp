"use client";

// Procurement → Request → Purchase Indents (Procurement plan Phase 2): a department or the store asks for items by a date; the head approves —
// from the list, without opening it; the buyer turns approved lines into a purchase order or an RFQ. Optional per company (Procurement Setup).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, LinkButton, NoResultsState, PageHeader, PermissionState, RecordDetailsPage, SearchField,
  Select, StatusBadge, TextArea, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Cell, LinesTable } from "@/shared/ui/record";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { DocumentChain } from "@/features/procurement/shared/DocumentChain";
import { ListStateViews } from "@/features/procurement/shared/ListStateViews";
import { useListState } from "@/features/procurement/shared/navigation";
import { gridPaging, pageFilters, usePageIndex } from "@/features/procurement/shared/paging";
import { ProcurementSearchPicker, useKnownRows } from "@/features/procurement/shared/ProcurementSearchPicker";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { getPurchaseOrderOptions } from "@/features/procurement/purchase-orders/api/purchase-orders-api";

import {
  createIndent, errorMessage, getIndent, indentAction, listIndentLinesToOrder, listIndents, orderFromIndents, updateIndent, type IndentDetail, type IndentLine, type IndentRow,
} from "./api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE: Record<string, Tone> = { draft: "neutral", submitted: "warning", approved: "success", rejected: "danger", closed: "neutral", cancelled: "neutral" };
const VIEWS = [{ id: "to_approve", label: "To approve" }, { id: "to_order", label: "Approved, to order" }, { id: "mine", label: "My indents" }, { id: "draft", label: "Drafts" },
  { id: "all", label: "All" }, { id: "closed", label: "Closed" }];
const canOrder = (workspace: { roleSlugs: string[]; permissions: string[] }) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("procurement.po.create");
const canApprove = (workspace: { roleSlugs: string[]; permissions: string[] }) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("procurement.requisition.approve");

export function IndentsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  // Approvers open on what waits for them, buyers on what is approved to buy, everyone else on their own.
  const fallback = canApprove(workspace) ? "to-approve" : canOrder(workspace) ? "to-order" : "mine";
  const list = useListState("indents", { view: fallback, filters: {} });
  const view = list.view.replace(/-/g, "_");
  const filters = useMemo(() => ({ view: view === "all" ? undefined : view, search: list.search.trim() || undefined }), [view, list.search]);
  const [pageIndex, setPageIndex] = usePageIndex(filters);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "indents", filters, pageIndex), queryFn: () => listIndents({ ...filters, ...pageFilters(pageIndex) }),
    placeholderData: (previous) => previous });
  const [rejecting, setRejecting] = useState<IndentRow | null>(null);
  const approve = useMutation({ mutationFn: (row: IndentRow) => indentAction(row.id, "approve"), onSuccess: () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement", "indents") }) });
  const rows = query.data?.rows ?? [];
  const approver = canApprove(workspace);
  const columns = useMemo<ColumnDef<IndentRow, unknown>[]>(() => [
    { id: "number", header: "Indent", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span> },
    { id: "items", header: "Items", cell: ({ row }) => <span className="line-clamp-2">{row.original.items ?? "—"}</span> },
    { id: "requested", header: "Raised by", cell: ({ row }) => <span>{row.original.requestedBy ?? "—"}{row.original.source === "reorder" && <span className="block text-xs text-text-muted">From a reorder</span>}</span> },
    { id: "required", header: "Needed by", cell: ({ row }) => (row.original.requiredBy ? calendarDate(row.original.requiredBy) : "—") },
    { id: "purpose", header: "Purpose", cell: ({ row }) => row.original.purpose ?? "" },
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex flex-wrap gap-1"><StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge>
      {row.original.toOrder && <StatusBadge tone="info">To order</StatusBadge>}</span> },
    ...(approver ? [{ id: "decide", header: "", cell: ({ row }: { row: { original: IndentRow } }) => (row.original.status === "submitted" ? (
      <span className="flex gap-1" onClick={(event) => event.stopPropagation()}>
        <Button size="compact" variant="secondary" isLoading={approve.isPending && approve.variables?.id === row.original.id} onPress={() => approve.mutate(row.original)}>
          <Check className="size-3.5" aria-hidden="true" />Approve</Button>
        <Button size="compact" variant="ghost" onPress={() => setRejecting(row.original)}><X className="size-3.5" aria-hidden="true" />Reject</Button>
      </span>) : null) }] : []),
  ], [approver, approve]);
  const forbidden = query.error instanceof ProcApiError && query.error.status === 403;
  if (forbidden) return <PermissionState title="You don't have access to purchase indents" description="Ask an administrator for a Procurement role." />;
  return (
    <EnterpriseListPage header={{ title: "Purchase Indents", description: "What departments and the store need, by when. The head of department approves; the buyer orders it or asks suppliers for prices.",
      primaryAction: <LinkButton variant="primary" href="/procurement/indents/new"><Plus className="size-4" aria-hidden="true" />New indent</LinkButton> }}
      savedViews={{ views: VIEWS, activeViewId: view, onSelect: (next) => list.setView(next.replace(/_/g, "-")) }}
      actionBar={{ end: <ListStateViews listKey="indents" list={list} />, start: <SearchField aria-label="Search indents" placeholder="Indent, item, purpose or person" className="w-full sm:w-80"
        value={list.search} onChange={list.setSearch} /> }}>
      {approve.error && <Notice>{errorMessage(approve.error)}</Notice>}
      {query.error instanceof ProcApiError && query.error.code === "PURCHASE_INDENTS_OFF" ? (
        <EmptyState title="Purchase indents are off" description="Turn them on in Procurement Setup › Purchasing Rules to raise and approve indents." />
      ) : (
        <EnterpriseDataGrid<IndentRow> aria-label="Purchase indents" columns={columns} data={rows} getRowId={(row) => row.id} {...gridPaging(query.data?.total ?? 0, pageIndex, setPageIndex)}
          state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (list.search || view !== "all" ? "no-results" : "empty") : "ready"}
          loadingContent={<LoadingState label="Loading indents" rows={6} />}
          errorContent={<ErrorState title="Could not load indents" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
          emptyContent={<EmptyState title="No indents yet" description="Raise one for what your department needs; it goes to the head for approval." />}
          noResultsContent={<NoResultsState title="Nothing in this view" description={view === "to_approve" ? "No indent is waiting for approval." : "Try another view or search."} />}
          onRowClick={(row) => router.push(`/procurement/indents/${row.id}`)}
          renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.number} · {row.statusLabel}</span>
            <span className="text-xs text-text-muted">{row.items ?? ""}{row.requiredBy ? ` · by ${calendarDate(row.requiredBy)}` : ""}</span></div>} />
      )}
      {rejecting && <RejectDialog indentId={rejecting.id} number={rejecting.number} onClose={() => setRejecting(null)}
        onDone={() => { setRejecting(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement", "indents") }); }} />}
    </EnterpriseListPage>
  );
}

function RejectDialog({ indentId, number, onClose, onDone }: { indentId: string; number: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const run = useMutation({ mutationFn: () => indentAction(indentId, "reject", { reason }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Reject ${number}`} description="The person who raised it sees the reason and can change and resubmit it.">
      <div className="flex flex-col gap-3">
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        <TextArea label="Reason" value={reason} onChange={setReason} autoFocus />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!reason.trim()} isLoading={run.isPending} onPress={() => run.mutate()}>Reject</Button></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- form

type Line = { key: number; productId: string; quantity: string; uomId: string; requiredBy: string; notes: string };
let lineKey = 0;
const blank = (): Line => ({ key: ++lineKey, productId: "", quantity: "", uomId: "", requiredBy: "", notes: "" });

export function IndentFormScreen({ indentId }: { indentId?: string }) {
  const workspace = useWorkspaceContext();
  const existing = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "indent", indentId), queryFn: () => getIndent(indentId!), enabled: Boolean(indentId) });
  const include = { productIds: (existing.data?.lines ?? []).map((line) => line.productId) };
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options", "", include.productIds.join(",")), queryFn: () => getPurchaseOrderOptions(include), staleTime: 60_000,
    enabled: !indentId || Boolean(existing.data) });
  if ((indentId && existing.isLoading) || options.isLoading) return <LoadingState label="Loading indent" />;
  if (!options.data || (indentId && !existing.data)) return <ErrorState title="Could not load the form" description={errorMessage(options.error ?? existing.error)} />;
  if (existing.data && !existing.data.actions.edit) return <ErrorState title="This indent cannot be changed" description="Only a draft or a rejected indent is changed." />;
  return <IndentForm options={options.data} existing={existing.data ?? null} />;
}

function IndentForm({ options, existing }: { options: NonNullable<Awaited<ReturnType<typeof getPurchaseOrderOptions>>>; existing: IndentDetail | null }) {
  const router = useRouter();
  const current = existing?.indent;
  const [values, setValues] = useState({ requiredBy: current?.requiredBy ?? "", warehouseId: current?.warehouseId ?? options.settings.defaultWarehouseId ?? "", purpose: current?.purpose ?? "",
    notes: current?.notes ?? "" });
  const [lines, setLines] = useState<Line[]>(() => existing?.lines.length ? existing.lines.map((line) => ({ key: ++lineKey, productId: line.productId, quantity: String(Number(line.quantity)),
    uomId: line.uomId ?? "", requiredBy: line.requiredBy && line.requiredBy !== current?.requiredBy ? line.requiredBy : "", notes: line.notes ?? "" })) : [blank()]);
  const [knownProducts, keepProduct] = useKnownRows(options.products);
  const set = (key: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [key]: value }));
  const setLine = (key: number, change: Partial<Line>) => setLines((state) => state.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: (submit: boolean) => submitKey.run(async () => {
      const body = { requiredBy: values.requiredBy || null, warehouseId: values.warehouseId || null, purpose: values.purpose || null, notes: values.notes || null,
        lines: lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: line.quantity, uomId: line.uomId || undefined, requiredBy: line.requiredBy || null,
          notes: line.notes || null })) };
      if (existing) {
        await updateIndent(existing.indent.id, body);
        if (submit) await indentAction(existing.indent.id, "submit");
        return existing.indent.id;
      }
      return (await createIndent({ ...body, submit })).id;
    }),
    onSuccess: (id) => router.replace(`/procurement/indents/${id}`),
  });
  const ready = lines.some((line) => line.productId && Number(line.quantity) > 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={existing ? `Edit ${existing.indent.number}` : "New purchase indent"} description="What you need and by when. Submitting sends it for approval."
        secondaryActions={<div className="flex gap-2"><Button variant="secondary" onPress={() => router.replace(existing ? `/procurement/indents/${existing.indent.id}` : "/procurement/indents")}>Cancel</Button>
          <Button variant="secondary" isDisabled={!ready || save.isPending} onPress={() => save.mutate(false)}>Save draft</Button></div>}
        primaryAction={<Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending || save.isSuccess} onPress={() => save.mutate(true)}>Submit for approval</Button>} />
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      <Panel title="Indent">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Needed by" type="date" value={values.requiredBy} onChange={set("requiredBy")} />
          <Select label="Deliver to" selectedKey={values.warehouseId || "none"} onSelectionChange={(value) => set("warehouseId")(value === "none" ? "" : String(value))}
            options={[{ value: "none", label: "Not a stock item / not decided" }, ...options.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))]} />
          <TextField label="Purpose" placeholder="Line 2 maintenance, new packing run…" value={values.purpose} onChange={set("purpose")} />
        </div>
      </Panel>
      <Panel title="Items" actions={<Button size="compact" variant="secondary" onPress={() => setLines((state) => [...state, blank()])}><Plus className="size-3.5" aria-hidden="true" />Add item</Button>}>
        <div className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <ProcurementSearchPicker kind="products" label={`Item ${index + 1}`} value={line.productId || null} known={knownProducts}
                onPick={(id, row) => {
                  const product = (row ?? knownProducts.find((entry) => entry.id === id)) as (typeof knownProducts)[number] | undefined;
                  keepProduct(product ?? null);
                  setLine(line.key, { productId: id, uomId: product?.purchase_uom_id ?? product?.uom_id ?? "" });
                }} />
              <TextField label="Quantity" inputMode="decimal" value={line.quantity} onChange={(value) => setLine(line.key, { quantity: value })} />
              <Select label="Unit" selectedKey={line.uomId || null} onSelectionChange={(value) => setLine(line.key, { uomId: String(value) })}
                options={options.uoms.map((uom) => ({ value: uom.id, label: uom.code }))} />
              <TextField label="Needed by" type="date" value={line.requiredBy} onChange={(value) => setLine(line.key, { requiredBy: value })} description={values.requiredBy ? "The indent's date if empty" : undefined} />
              <IconButton aria-label={`Remove item ${index + 1}`} variant="ghost" isDisabled={lines.length <= 1} onPress={() => setLines((state) => state.filter((entry) => entry.key !== line.key))}>
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Notes"><TextArea label="Notes for the approver and the buyer" value={values.notes} onChange={set("notes")} /></Panel>
    </div>
  );
}

// ---------------------------------------------------------------- detail

export function IndentDetailScreen({ indentId }: { indentId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "indent", indentId), queryFn: () => getIndent(indentId) });
  const [dialog, setDialog] = useState<"reject" | "order" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("procurement") });
  const act = useMutation({ mutationFn: (action: "submit" | "approve" | "close" | "cancel") => indentAction(indentId, action), onSuccess: refresh });
  if (query.isLoading) return <LoadingState label="Loading indent" />;
  if (query.isError || !query.data) return <ErrorState title={query.error instanceof ProcApiError && query.error.status === 404 ? "Indent not found" : "Could not load this indent"}
    description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { indent, lines, orders, rfqs, actions } = query.data;
  const toOrder = lines.filter((line) => Number(line.remaining) > 0);
  return (
    <div className="flex flex-col gap-4">
      <DocumentChain type="purchase_indent" id={indent.id} />
      {act.error && <Notice>{errorMessage(act.error)}</Notice>}
      {indent.status === "rejected" && <Notice tone="warning">Rejected{indent.decidedBy ? ` by ${indent.decidedBy}` : ""}: {indent.decisionNote}. Change it and submit it again.</Notice>}
      <RecordDetailsPage
        header={{
          title: indent.number,
          status: <StatusBadge tone={TONE[indent.status] ?? "neutral"}>{indent.statusLabel}</StatusBadge>,
          fields: [
            { label: "Raised by", value: indent.requestedBy ?? "—" },
            { label: "Needed by", value: indent.requiredBy ? calendarDate(indent.requiredBy) : "—" },
            { label: "Purpose", value: indent.purpose ?? "—" },
            ...(indent.decidedBy && indent.status !== "rejected" ? [{ label: "Approved by", value: indent.decidedBy }] : []),
          ],
          primaryAction: actions.approve ? <Button variant="primary" isLoading={act.isPending} onPress={() => act.mutate("approve")}><Check className="size-4" aria-hidden="true" />Approve</Button>
            : actions.submit ? <Button variant="primary" isLoading={act.isPending} onPress={() => act.mutate("submit")}>Submit for approval</Button>
              : actions.order ? <Button variant="primary" onPress={() => setDialog("order")}>Create purchase order</Button> : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.reject && <Button variant="secondary" onPress={() => setDialog("reject")}>Reject</Button>}
              {actions.edit && <LinkButton variant="secondary" href={`/procurement/indents/${indent.id}/edit`}>Edit</LinkButton>}
              {actions.rfq && <LinkButton variant="secondary" href={`/procurement/rfqs/new?indentLineIds=${toOrder.map((line) => line.id).join(",")}`}>Ask suppliers for prices</LinkButton>}
              {actions.close && <Button variant="ghost" onPress={() => act.mutate("close")}>Close</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => act.mutate("cancel")}>Cancel indent</Button>}
            </div>
          ),
        }}
      >
        <Panel title="Items">
          <LinesTable columns={["Item", "Needed by", { label: "Asked", numeric: true }, { label: "Ordered", numeric: true }, { label: "Still to order", numeric: true }]}>
            {lines.map((line) => (
              <tr key={line.id} className={line.status === "cancelled" ? "text-text-muted line-through" : undefined}>
                <Cell><span className="font-medium">{line.productName}</span><span className="block text-xs text-text-muted">{line.productCode}{line.warehouseName ? ` · ${line.warehouseName}` : ""}</span>
                  {line.contract && Number(line.remaining) > 0 && <span className="block text-xs text-info">On rate contract {line.contract.contractNumber} with {line.contract.supplierName} at {money("INR", line.contract.rate)} — no RFQ needed</span>}</Cell>
                <Cell>{line.requiredBy ? calendarDate(line.requiredBy) : "—"}</Cell>
                <Cell numeric>{quantity(line.quantity)} {line.uomCode}</Cell>
                <Cell numeric>{Number(line.ordered) ? quantity(line.ordered) : "—"}</Cell>
                <Cell numeric>{Number(line.remaining) ? <span className="font-medium">{quantity(line.remaining)}</span> : "—"}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
        {(orders.length > 0 || rfqs.length > 0) && (
          <Panel title="Bought through">
            <ul className="flex flex-col gap-1 text-sm">
              {rfqs.map((rfq) => <li key={rfq.id}><Link className="text-brand hover:underline" href={rfq.href}>{rfq.number}</Link> · RFQ · {rfq.status}</li>)}
              {orders.map((order) => <li key={order.id}><Link className="text-brand hover:underline" href={order.href}>{order.number}</Link> · purchase order · {order.status}</li>)}
            </ul>
          </Panel>
        )}
        <Panel title="Details"><Facts items={[{ label: "Notes", value: indent.notes ?? "—" }, { label: "Raised on", value: calendarDate(indent.createdAt) }]} /></Panel>
      </RecordDetailsPage>
      {dialog === "reject" && <RejectDialog indentId={indent.id} number={indent.number} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void refresh(); }} />}
      {dialog === "order" && <OrderDialog lines={toOrder} onClose={() => setDialog(null)} onDone={(id) => { setDialog(null); void refresh(); router.push(`/procurement/purchase-orders/${id}`); }} />}
    </div>
  );
}

// A draft purchase order to one supplier for the lines still to order: how much of each and at what price (the last price paid by default).
function OrderDialog({ lines, onClose, onDone }: { lines: IndentLine[]; onClose: () => void; onDone: (orderId: string) => void }) {
  const workspace = useWorkspaceContext();
  const [supplierId, setSupplierId] = useState("");
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: () => getPurchaseOrderOptions(), staleTime: 60_000 });
  const [knownSuppliers, keepSupplier] = useKnownRows(options.data?.suppliers ?? []);
  const toOrder = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "indent-lines-to-order", lines.map((line) => line.id).join(",")),
    queryFn: () => listIndentLinesToOrder({}) });
  const [rows, setRows] = useState<Record<string, { include: boolean; quantity: string; unitPrice: string }>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, { include: true, quantity: String(Number(line.remaining)), unitPrice: "" }])));
  const prices = new Map((toOrder.data ?? []).map((line) => [line.id, line.purchasePrice]));
  const run = useMutation({ mutationFn: () => orderFromIndents({ supplierId, lines: lines.filter((line) => rows[line.id]?.include).map((line) => ({ indentLineId: line.id,
    quantity: rows[line.id].quantity, unitPrice: rows[line.id].unitPrice || undefined })) }), onSuccess: (result) => onDone(result.id) });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Create purchase order" size="lg" description="A draft order to one supplier. Prices start from the last price paid to them; change any before saving.">
      <div className="flex flex-col gap-3">
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        <ProcurementSearchPicker kind="suppliers" label="Supplier" isRequired activeOnly value={supplierId || null} known={knownSuppliers}
          onPick={(id, row) => { keepSupplier(row as (typeof knownSuppliers)[number] | null); setSupplierId(id); }} />
        <div className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
          {lines.map((line) => (
            <div key={line.id} className="grid grid-cols-1 items-end gap-2 p-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <span className="text-sm"><span className="font-medium">{line.productName}</span><span className="block text-xs text-text-muted">{quantity(line.remaining)} {line.uomCode} to order</span></span>
              <TextField label="Quantity" inputMode="decimal" value={rows[line.id]?.quantity ?? ""} onChange={(value) => setRows((state) => ({ ...state, [line.id]: { ...state[line.id], quantity: value } }))} />
              <TextField label="Price" inputMode="decimal" placeholder={prices.get(line.id) ? `Last ${money("INR", prices.get(line.id) ?? "0")}` : "Last price"} value={rows[line.id]?.unitPrice ?? ""}
                onChange={(value) => setRows((state) => ({ ...state, [line.id]: { ...state[line.id], unitPrice: value } }))} />
              <Button size="compact" variant="ghost" onPress={() => setRows((state) => ({ ...state, [line.id]: { ...state[line.id], include: !state[line.id].include } }))}>
                {rows[line.id]?.include ? "Leave out" : "Include"}
              </Button>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!supplierId || !lines.some((line) => rows[line.id]?.include)} isLoading={run.isPending} onPress={() => run.mutate()}>Create draft order</Button></div>
      </div>
    </Dialog>
  );
}
