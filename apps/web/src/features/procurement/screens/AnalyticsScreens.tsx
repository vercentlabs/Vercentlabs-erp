"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, MetricStrip, NumberField, PageHeader, PermissionState, Select, SearchField, StatusBadge, Tab, TabList, TabPanel, Tabs, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { ProcApiError, post, request } from "@/features/procurement/shared/http";
import { getReport, listOperations, listRecords, type ProcRecord } from "@/features/procurement/shared/api";
import { calendarDate, money, quantity, statusLabel } from "@/features/procurement/shared/format";
import { ProcAlert, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { useCan } from "@/features/procurement/shared/use-can";
import { useLookup } from "@/features/procurement/shared/use-lookup";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const num = (value: unknown) => Number(value ?? 0);

// ------------------------------------------------------------------ planning (F094)
type Candidate = { reorderRuleId: string; itemId: string; warehouseId: string; preferredSupplierId: string | null; reorderQuantity: string; minimumQuantity: string; maximumQuantity: string; leadTimeDays: number | null; onHandQuantity: string; availableQuantity: string };

export function PlanningScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useCan();
  const lookup = useLookup();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const candidates = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "planning"), queryFn: () => request<{ candidates: Candidate[] }>("/planning").then((r) => r.candidates), enabled: can("procurement.po.create") });
  const requests = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "operations", "reorder-requests"), queryFn: () => listOperations<Row>("reorder-requests") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
  const onError = (err: unknown) => setError(err instanceof ProcApiError ? err.message : "This could not be completed.");

  const [proposing, setProposing] = useState<Candidate | null>(null);
  const propose = useMutation({
    mutationFn: (input: { candidate: Candidate; supplierId: string; quantity: number; requiredBy: string }) =>
      post("/operations/reorder-requests", {
        reorderRuleId: input.candidate.reorderRuleId,
        itemId: input.candidate.itemId,
        warehouseId: input.candidate.warehouseId,
        supplierId: input.supplierId || undefined,
        quantity: input.quantity,
        requiredBy: input.requiredBy || undefined,
        // one request per rule per day: pressing the button twice cannot double-order
        idempotencyKey: `reorder-${input.candidate.reorderRuleId}-${new Date().toISOString().slice(0, 10)}`,
      }),
    onSuccess: () => {
      setError(null);
      setNotice("Reorder request created.");
      setProposing(null);
      refresh();
    },
    onError,
  });
  const convert = useMutation({
    mutationFn: (id: string) => post<{ result: { purchaseOrder: { id: string }; priced: boolean } }>(`/operations/reorder-requests/${id}/convert`, {}),
    onSuccess: ({ result }) => {
      setError(null);
      refresh();
      router.push(`/procurement/orders/${result.purchaseOrder.id}`);
    },
    onError,
  });

  const candidateColumns: ColumnDef<Candidate, unknown>[] = [
    { id: "item", header: "Item", accessorFn: (c) => lookup.item(c.itemId) },
    { id: "wh", header: "Warehouse", accessorFn: (c) => lookup.warehouse(c.warehouseId) },
    { id: "avail", header: "Available", accessorFn: (c) => quantity(c.availableQuantity) },
    { id: "min", header: "Reorder point", accessorFn: (c) => quantity(c.minimumQuantity) },
    { id: "qty", header: "Reorder quantity", accessorFn: (c) => quantity(c.reorderQuantity) },
    { id: "supplier", header: "Preferred supplier", accessorFn: (c) => (c.preferredSupplierId ? lookup.supplier(c.preferredSupplierId) : "—") },
    { id: "lead", header: "Lead time", accessorFn: (c) => (c.leadTimeDays ? `${c.leadTimeDays} days` : "—") },
  ];
  const requestColumns: ColumnDef<Row, unknown>[] = [
    { id: "item", header: "Item", accessorFn: (r) => lookup.item(r.item_id) },
    { id: "qty", header: "Quantity", accessorFn: (r) => quantity(r.quantity) },
    { id: "supplier", header: "Supplier", accessorFn: (r) => (r.supplier_id ? lookup.supplier(r.supplier_id) : "— choose one —") },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={row.original.status === "converted" ? "success" : "warning"}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "order", header: "Order", cell: ({ row }) => (row.original.purchase_order_id ? <Link className="text-brand hover:underline" href={`/procurement/orders/${row.original.purchase_order_id}`}>{lookup.order(row.original.purchase_order_id)}</Link> : <span>—</span>) },
  ];

  if (candidates.isError && candidates.error instanceof ProcApiError && candidates.error.status === 403) return <PermissionState title="You don't have access to purchase planning" description="Planning needs permission to create purchase orders." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Procurement planning" description="Stock items at or below their reorder point, and the reorder requests raised for them." />
      {error && <ProcAlert>{error}</ProcAlert>}
      {notice && !error && <ProcAlert tone="success">{notice}</ProcAlert>}
      <ProcPanel title="Below reorder point" description="Available quantity (on hand less reserved) is at or below the item's reorder point.">
        <EnterpriseDataGrid<Candidate>
          aria-label="Reorder candidates"
          columns={candidateColumns}
          data={candidates.data ?? []}
          getRowId={(c) => c.reorderRuleId}
          density="compact"
          state={candidates.isLoading ? "loading" : (candidates.data?.length ?? 0) ? "ready" : "empty"}
          loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>}
          emptyContent={<p className="px-4 py-6 text-sm text-text-muted">Nothing is below its reorder point.</p>}
          rowActions={(candidate) => (
            <Button variant="ghost" size="compact" onPress={() => { setError(null); setNotice(null); setProposing(candidate); }}>
              Create reorder request
            </Button>
          )}
        />
      </ProcPanel>
      <ProcPanel title="Reorder requests" description="Turning a request into a purchase order creates a draft priced from the supplier's price list; it still needs approval.">
        <EnterpriseDataGrid<Row>
          aria-label="Reorder requests"
          columns={requestColumns}
          data={requests.data ?? []}
          getRowId={(r) => r.id}
          density="compact"
          state={requests.isLoading ? "loading" : (requests.data?.length ?? 0) ? "ready" : "empty"}
          loadingContent={<p className="px-4 py-6 text-sm text-text-secondary">Loading…</p>}
          emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No reorder requests yet.</p>}
          rowActions={(r) =>
            r.status !== "converted" && r.status !== "cancelled" ? (
              <Button variant="ghost" size="compact" onPress={() => convert.mutate(r.id)} isLoading={convert.isPending && convert.variables === r.id}>
                Create purchase order
              </Button>
            ) : null
          }
        />
      </ProcPanel>
      {proposing && <ProposeDialog candidate={proposing} lookup={lookup} pending={propose.isPending} error={error} onClose={() => setProposing(null)} onSubmit={(values) => propose.mutate({ candidate: proposing, ...values })} />}
    </div>
  );
}

function ProposeDialog({ candidate, lookup, pending, error, onClose, onSubmit }: { candidate: Candidate; lookup: ReturnType<typeof useLookup>; pending: boolean; error: string | null; onClose: () => void; onSubmit: (values: { supplierId: string; quantity: number; requiredBy: string }) => void }) {
  const [supplierId, setSupplierId] = useState(candidate.preferredSupplierId ?? "");
  const [qty, setQty] = useState(num(candidate.reorderQuantity));
  const [requiredBy, setRequiredBy] = useState("");
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Create reorder request">
      <div className="flex flex-col gap-4">
        {error && <ProcAlert>{error}</ProcAlert>}
        <p className="text-sm text-text-secondary">{lookup.item(candidate.itemId)} — {quantity(candidate.availableQuantity)} available, reorder point {quantity(candidate.minimumQuantity)}.</p>
        <Select label="Supplier" options={(lookup.options?.suppliers ?? []).map((sup) => ({ value: sup.id, label: sup.label }))} selectedKey={supplierId || null} onSelectionChange={(key) => setSupplierId(String(key ?? ""))} placeholder="Select a supplier" />
        <NumberField label="Quantity" value={qty} onChange={setQty} minValue={0} step={1} />
        <TextField label="Needed by" type="date" value={requiredBy} onChange={setRequiredBy} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => onSubmit({ supplierId, quantity: qty, requiredBy })} isLoading={pending} isDisabled={qty <= 0}>
            Create request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------- supplier performance (F089-F091)
type Perf = { supplierId: string; orders: number; withReceipts: number; onTime: number; accepted: number; rejected: number; scorecard: number | null; leadDays: number | null };
const band = (score: number | null) => (score === null ? "—" : score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D");

export function SupplierPerformanceScreen() {
  const workspace = useWorkspaceContext();
  const lookup = useLookup();
  const orders = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "perf", "orders"), queryFn: () => listRecords("purchase-orders", { limit: 200 }).then((r) => r.rows) });
  const receipts = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "perf", "receipts"), queryFn: () => listRecords("receipts", { status: "approved", limit: 200 }).then((r) => r.rows) });
  const cards = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "perf", "scorecards"), queryFn: () => listRecords("supplier-scorecards", { limit: 200 }).then((r) => r.rows) });
  const leads = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "operations", "supplier-lead-times"), queryFn: () => listOperations<Row>("supplier-lead-times") });
  const loading = orders.isLoading || receipts.isLoading || cards.isLoading;

  const rows = useMemo<Perf[]>(() => {
    const byOrder = new Map<string, ProcRecord>((orders.data ?? []).map((o) => [o.id, o]));
    const stats = new Map<string, Perf>();
    const stat = (supplierId: string) => {
      let s = stats.get(supplierId);
      if (!s) stats.set(supplierId, (s = { supplierId, orders: 0, withReceipts: 0, onTime: 0, accepted: 0, rejected: 0, scorecard: null, leadDays: null }));
      return s;
    };
    for (const order of orders.data ?? []) if (order.supplierId && !["draft", "cancelled", "rejected"].includes(order.status)) stat(order.supplierId).orders += 1;
    const lastReceipt = new Map<string, string>();
    for (const receipt of receipts.data ?? []) {
      const order = byOrder.get(receipt.purchaseOrderId);
      if (!order?.supplierId) continue;
      const s = stat(order.supplierId);
      for (const line of (receipt.lines ?? []) as Row[]) {
        s.accepted += num(line.acceptedQuantity);
        s.rejected += num(line.rejectedQuantity);
      }
      const date = String(receipt.receiptDate ?? "").slice(0, 10);
      if (date && date > (lastReceipt.get(order.id) ?? "")) lastReceipt.set(order.id, date);
    }
    for (const [orderId, date] of lastReceipt) {
      const order = byOrder.get(orderId)!;
      const s = stat(order.supplierId);
      s.withReceipts += 1;
      if (order.expectedDeliveryDate && date <= String(order.expectedDeliveryDate).slice(0, 10)) s.onTime += 1;
    }
    const latest = new Map<string, { at: string; score: number }>();
    for (const card of cards.data ?? []) {
      if (!card.parent_id || card.overallScore === undefined) continue;
      const at = String(card.updated_at ?? "");
      if (!latest.has(card.parent_id) || at > latest.get(card.parent_id)!.at) latest.set(card.parent_id, { at, score: num(card.overallScore) });
    }
    for (const [supplierId, value] of latest) stat(supplierId).scorecard = value.score;
    for (const lead of leads.data ?? []) if (!lead.item_id && stats.has(lead.supplier_id)) stats.get(lead.supplier_id)!.leadDays = num(lead.lead_time_days);
    return [...stats.values()].sort((a, b) => b.orders - a.orders);
  }, [orders.data, receipts.data, cards.data, leads.data]);

  const derived = (p: Perf) => {
    if (p.scorecard !== null) return p.scorecard;
    if (!p.withReceipts) return null;
    const onTime = p.onTime / p.withReceipts;
    const quality = p.accepted + p.rejected ? 1 - p.rejected / (p.accepted + p.rejected) : 1;
    return Math.round((onTime * 0.6 + quality * 0.4) * 100);
  };
  const columns: ColumnDef<Perf, unknown>[] = [
    { id: "supplier", header: "Supplier", accessorFn: (p) => lookup.supplier(p.supplierId) },
    { id: "orders", header: "Orders", accessorFn: (p) => p.orders },
    { id: "ontime", header: "Delivered on time", accessorFn: (p) => (p.withReceipts ? `${Math.round((p.onTime / p.withReceipts) * 100)}% (${p.onTime}/${p.withReceipts})` : "—") },
    { id: "reject", header: "Rejection rate", accessorFn: (p) => (p.accepted + p.rejected ? `${((p.rejected / (p.accepted + p.rejected)) * 100).toFixed(1)}%` : "—") },
    { id: "lead", header: "Quoted lead time", accessorFn: (p) => (p.leadDays !== null ? `${p.leadDays} days` : "—") },
    { id: "card", header: "Latest scorecard", accessorFn: (p) => (p.scorecard !== null ? p.scorecard.toFixed(1) : "—") },
    { id: "rating", header: "Rating", cell: ({ row }) => { const score = derived(row.original); const b = band(score); return <StatusBadge tone={b === "A" ? "success" : b === "B" ? "info" : b === "C" ? "warning" : b === "D" ? "danger" : "neutral"}>{`${b}${score !== null ? ` · ${Math.round(score)}` : ""}`}</StatusBadge>; } },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Supplier performance" description="Delivery and quality from real receipts, plus scorecards recorded on the supplier. Rating: A ≥ 85, B ≥ 70, C ≥ 50, otherwise D. With no scorecard it is 60% on-time delivery and 40% acceptance rate." />
      <EnterpriseDataGrid<Perf>
        aria-label="Supplier performance"
        columns={columns}
        data={rows}
        getRowId={(p) => p.supplierId}
        state={loading ? "loading" : rows.length ? "ready" : "empty"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
        emptyContent={<p className="px-4 py-8 text-sm text-text-muted">No purchasing activity yet.</p>}
      />
      <p className="px-1 text-xs text-text-muted">Based on the most recent 200 orders and receipts. Record scorecards on a supplier&apos;s Performance tab.</p>
    </div>
  );
}

// ------------------------------------------------------- purchase history (F093)
export function PurchaseHistoryScreen() {
  const workspace = useWorkspaceContext();
  const lookup = useLookup();
  const [supplier, setSupplier] = useState("all");
  const [item, setItem] = useState("all");
  const [search, setSearch] = useState("");
  const orders = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "history", "orders"), queryFn: () => listRecords("purchase-orders", { limit: 200 }).then((r) => r.rows) });

  const lines = useMemo(() => {
    const out: Row[] = [];
    for (const order of orders.data ?? []) {
      if (["draft", "cancelled", "rejected"].includes(order.status)) continue;
      for (const line of (order.lines ?? []) as Row[]) out.push({ id: `${order.id}:${line.id ?? out.length}`, orderId: order.id, order: order.purchaseOrderNumber, date: order.created_at, supplierId: order.supplierId, currency: order.currencyCode, status: order.status, ...line });
    }
    return out;
  }, [orders.data]);
  const filtered = lines.filter((line) => (supplier === "all" || line.supplierId === supplier) && (item === "all" || line.itemId === item) && (!search.trim() || `${line.description} ${line.order}`.toLowerCase().includes(search.trim().toLowerCase())));
  const prices = filtered.map((line) => num(line.unitPrice)).filter((p) => p > 0);
  const totalQty = filtered.reduce((sum, line) => sum + num(line.quantity), 0);
  const columns: ColumnDef<Row, unknown>[] = [
    { id: "order", header: "Order", cell: ({ row }) => <Link className="font-medium text-brand hover:underline" href={`/procurement/orders/${row.original.orderId}`}>{String(row.original.order ?? "—")}</Link> },
    { id: "date", header: "Ordered", accessorFn: (l) => calendarDate(l.date) },
    { id: "supplier", header: "Supplier", accessorFn: (l) => lookup.supplier(l.supplierId) },
    { id: "desc", header: "Item", accessorFn: (l) => String(l.description ?? "—") },
    { id: "qty", header: "Quantity", accessorFn: (l) => quantity(l.quantity) },
    { id: "recv", header: "Received", accessorFn: (l) => quantity(l.receivedQuantity) },
    { id: "price", header: "Unit price", accessorFn: (l) => money(l.currency, l.unitPrice) },
    { id: "status", header: "Order status", accessorFn: (l) => statusLabel(l.status) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Purchase history" description="What was bought, from whom, at what price — filter by supplier or item to see how prices moved." />
      <div className="flex flex-wrap items-center gap-2">
        <SearchField aria-label="Search purchase history" placeholder="Search item or order…" value={search} onChange={setSearch} className="min-w-[260px]" />
        <Select aria-label="Supplier" size="compact" options={[{ value: "all", label: "All suppliers" }, ...(lookup.options?.suppliers ?? []).map((s) => ({ value: s.id, label: s.label }))]} selectedKey={supplier} onSelectionChange={(key) => setSupplier(String(key ?? "all"))} />
        <Select aria-label="Item" size="compact" options={[{ value: "all", label: "All items" }, ...(lookup.options?.items ?? []).map((i) => ({ value: i.id, label: i.name }))]} selectedKey={item} onSelectionChange={(key) => setItem(String(key ?? "all"))} />
      </div>
      <MetricStrip metrics={[{ label: "Order lines", value: String(filtered.length) }, { label: "Total quantity", value: quantity(totalQty) }, { label: "Lowest price", value: prices.length ? Math.min(...prices).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—" }, { label: "Highest price", value: prices.length ? Math.max(...prices).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—" }]} />
      <EnterpriseDataGrid<Row>
        aria-label="Purchase history"
        columns={columns}
        data={filtered}
        getRowId={(l) => l.id}
        state={orders.isLoading ? "loading" : filtered.length ? "ready" : "empty"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
        emptyContent={<p className="px-4 py-8 text-sm text-text-muted">No purchases match.</p>}
      />
    </div>
  );
}

// ------------------------------------------------------------- reports (F092/F096)
export type ReportSpec = { key: string; label: string; description: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ReportTable({ reportKey }: { reportKey: string }) {
  const workspace = useWorkspaceContext();
  const lookup = useLookup();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "report", reportKey), queryFn: () => getReport(reportKey) });
  const rows = useMemo(() => (query.data ?? []).map((row, position) => ({ ...row, _row: position }) as Row), [query.data]);
  const columns: ColumnDef<Row, unknown>[] = useMemo(() => {
    const keys = Object.keys(rows[0] ?? {}).filter((key) => key !== "_row");
    return keys.map((key) => ({
      id: key,
      header: statusLabel(key),
      accessorFn: (row: Row) => {
        const value = row[key];
        if (value === null || value === undefined || value === "") return "—";
        if (typeof value === "string" && UUID.test(value)) return lookup.supplier(value) !== "…" ? lookup.supplier(value) : lookup.order(value) !== "…" ? lookup.order(value) : value.slice(0, 8);
        if (/metric|total|amount|value/.test(key) && Number.isFinite(Number(value))) return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (/status|dimension/.test(key)) return statusLabel(value);
        return String(value);
      },
    }));
  }, [rows, lookup]);
  if (query.isError) {
    if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to this report" description="It needs the Procurement reports permission." />;
    return <ErrorState title="Could not load this report" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  return (
    <EnterpriseDataGrid<Row>
      aria-label={statusLabel(reportKey)}
      columns={columns}
      data={rows}
      getRowId={(row) => String(row._row)}
      density="compact"
      state={query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"}
      loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
      emptyContent={<p className="px-4 py-8 text-sm text-text-muted">No data for this report yet.</p>}
    />
  );
}

export function ProcurementReportScreen({ title, description, reports }: { title: string; description: string; reports: ReportSpec[] }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description} />
      <Tabs>
        <TabList aria-label={`${title} reports`}>
          {reports.map((report) => (
            <Tab key={report.key} id={report.key}>
              {report.label}
            </Tab>
          ))}
        </TabList>
        {reports.map((report) => (
          <TabPanel key={report.key} id={report.key}>
            <ProcPanel title={report.label} description={report.description}>
              <ReportTable reportKey={report.key} />
            </ProcPanel>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

export const SPEND_REPORTS: ReportSpec[] = [
  { key: "spend-analysis", label: "Spend by supplier", description: "Order value per supplier (cancelled and rejected orders excluded)." },
  { key: "contract-compliance", label: "Contract compliance", description: "Spend on contract versus off contract." },
  { key: "maverick-spend", label: "Maverick spend", description: "Spend outside agreed processes, by department." },
  { key: "savings", label: "Savings", description: "Savings recorded against awards." },
  { key: "purchase-price-variance", label: "Price variance", description: "Invoice-to-order price differences by supplier." },
];
export const ALL_PROCUREMENT_REPORTS: ReportSpec[] = [
  ...SPEND_REPORTS,
  { key: "open-commitments", label: "Open commitments", description: "Value of orders still open, by status." },
  { key: "overdue-orders", label: "Overdue orders", description: "Orders past their expected delivery date." },
  { key: "matching-exceptions", label: "Matching exceptions", description: "Invoice match failures by cause." },
  { key: "agreement-consumption", label: "Agreement consumption", description: "Order value called off under each agreement." },
  { key: "supplier-performance", label: "Scorecard averages", description: "Average scorecard result per supplier." },
  { key: "supplier-risk", label: "Supplier risk", description: "Suppliers by standing." },
  { key: "cycle-time", label: "Cycle time", description: "Average days from creation to last update, by document type." },
];
