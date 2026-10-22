"use client";

// Procurement → Buy → RFQs & Quotations (Procurement plan Phase 2): one request for prices sent to several suppliers — blank or from
// approved indent lines; each supplier's answer recorded against it; the side-by-side comparison (rate, GST, freight, landed rate, lead
// time, terms, last price, MSME) with the lowest landed rate marked; and the award, per line or whole, opening one draft purchase order
// per supplier. The Quotations view lists every supplier quotation (with or without an RFQ).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormRouter as useRouter } from "@/shell/form-modal/FormModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Plus, Send, Trash2 } from "lucide-react";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, IconButton, LinkButton, NoResultsState, PageHeader, PermissionState, RecordDetailsPage, SearchField,
  Select, StatusBadge, TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { useSubmitKey } from "@/shared/http/submit-once";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { DocumentChain } from "@/features/procurement/shared/DocumentChain";
import { useListState } from "@/features/procurement/shared/navigation";
import { gridPaging, pageFilters, usePageIndex } from "@/features/procurement/shared/paging";
import { ProcurementSearchPicker, useKnownRows } from "@/features/procurement/shared/ProcurementSearchPicker";
import { ProcApiError } from "@/features/procurement/shared/http";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";
import { getPurchaseOrderOptions } from "@/features/procurement/purchase-orders/api/purchase-orders-api";
import { SupplierQuotationsScreen } from "@/features/procurement/purchase-orders/screens/QuotationScreens";
import { listIndentLinesToOrder } from "@/features/procurement/indents/api";

import { createRfq, errorMessage, getComparison, getRfq, listRfqs, rfqAction, rfqPdfUrl, type Comparison, type RfqDetail, type RfqRow } from "./api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE: Record<string, Tone> = { draft: "neutral", sent: "info", awarded: "success", closed: "neutral", cancelled: "neutral" };
const VIEWS = [{ id: "open", label: "Open" }, { id: "to_award", label: "To award" }, { id: "awarded", label: "Awarded" }, { id: "all", label: "All RFQs" },
  { id: "quotations", label: "Supplier quotations" }];

export function RfqsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const list = useListState("rfqs", { view: "open", filters: {} });
  const view = list.view.replace(/-/g, "_");
  const setView = (next: string) => list.setView(next.replace(/_/g, "-"));
  const filters = useMemo(() => ({ view: view === "all" ? undefined : view, search: list.search.trim() || undefined }), [view, list.search]);
  const [pageIndex, setPageIndex] = usePageIndex(filters);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rfqs", filters, pageIndex), queryFn: () => listRfqs({ ...filters, ...pageFilters(pageIndex) }),
    placeholderData: (previous) => previous, enabled: view !== "quotations" });
  const rows = query.data?.rows ?? [];
  const columns = useMemo<ColumnDef<RfqRow, unknown>[]>(() => [
    { id: "number", header: "RFQ", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.number}</span> },
    { id: "title", header: "For", cell: ({ row }) => row.original.title ?? `${row.original.lineCount} item${row.original.lineCount === 1 ? "" : "s"}` },
    { id: "replies", header: "Replies", cell: ({ row }) => <span className="tabular-nums">{row.original.responded} of {row.original.supplierCount}</span> },
    { id: "due", header: "Reply by", cell: ({ row }) => (row.original.responseDueDate ? calendarDate(row.original.responseDueDate) : "—") },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
  ], []);
  const savedViews = { views: VIEWS, activeViewId: view, onSelect: setView };
  if (view === "quotations") return <SupplierQuotationsScreen savedViews={savedViews} />;
  if (query.error instanceof ProcApiError && query.error.status === 403) return <PermissionState title="You don't have access to RFQs" description="Ask an administrator for a buyer role." />;
  return (
    <EnterpriseListPage header={{ title: "RFQs & Quotations", description: "Ask several suppliers for prices, compare their answers side by side and award the order.",
      primaryAction: <LinkButton variant="primary" href="/procurement/rfqs/new"><Plus className="size-4" aria-hidden="true" />New RFQ</LinkButton> }}
      savedViews={savedViews}
      actionBar={{ start: <SearchField aria-label="Search RFQs" placeholder="RFQ, item or supplier" className="w-full sm:w-80" value={list.search} onChange={list.setSearch} /> }}>
      <EnterpriseDataGrid<RfqRow> aria-label="RFQs" columns={columns} data={rows} getRowId={(row) => row.id} {...gridPaging(query.data?.total ?? 0, pageIndex, setPageIndex)}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (list.search || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading RFQs" rows={6} />}
        errorContent={<ErrorState title="Could not load RFQs" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No RFQs yet" description="Ask two to five suppliers for prices on what you need; their answers are compared side by side." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view or search." />}
        onRowClick={(row) => router.push(`/procurement/rfqs/${row.id}`)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.number} · {row.statusLabel}</span>
          <span className="text-xs text-text-muted">{row.title ?? ""} · {row.responded} of {row.supplierCount} replied</span></div>} />
    </EnterpriseListPage>
  );
}

// ---------------------------------------------------------------- form

type Line = { key: number; productId: string; quantity: string; uomId: string; requiredBy: string };
let lineKey = 0;
const blank = (): Line => ({ key: ++lineKey, productId: "", quantity: "", uomId: "", requiredBy: "" });

export function RfqFormScreen({ indentLineIds }: { indentLineIds?: string[] }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: () => getPurchaseOrderOptions(), staleTime: 60_000 });
  const fromIndent = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "indent-lines-to-order", "all"), queryFn: () => listIndentLinesToOrder({}), enabled: Boolean(indentLineIds?.length) });
  if (options.isLoading || fromIndent.isLoading) return <LoadingState label="Loading" />;
  if (!options.data) return <ErrorState title="Could not load the form" description={errorMessage(options.error)} />;
  const indentLines = (fromIndent.data ?? []).filter((line) => indentLineIds?.includes(line.id));
  return <RfqForm options={options.data} indentLines={indentLines} />;
}

function RfqForm({ options, indentLines }: { options: NonNullable<Awaited<ReturnType<typeof getPurchaseOrderOptions>>>; indentLines: Awaited<ReturnType<typeof listIndentLinesToOrder>> }) {
  const router = useRouter();
  const [values, setValues] = useState({ title: "", responseDueDate: "", notes: "" });
  const [lines, setLines] = useState<Line[]>(() => (indentLines.length ? [] : [blank()]));
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [knownSuppliers, keepSupplier] = useKnownRows(options.suppliers);
  const [knownProducts, keepProduct] = useKnownRows(options.products);
  const set = (key: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [key]: value }));
  const setLine = (key: number, change: Partial<Line>) => setLines((state) => state.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const submitKey = useSubmitKey();
  const save = useMutation({
    mutationFn: (send: boolean) => submitKey.run(async () => {
      const made = await createRfq({ title: values.title || null, responseDueDate: values.responseDueDate || null, notes: values.notes || null, supplierIds: suppliers,
        ...(indentLines.length ? { indentLineIds: indentLines.map((line) => line.id) }
          : { lines: lines.filter((line) => line.productId).map((line) => ({ productId: line.productId, quantity: line.quantity, uomId: line.uomId || undefined, requiredBy: line.requiredBy || null })) }) });
      if (send) await rfqAction(made.id, "send");
      return made.id;
    }),
    onSuccess: (id) => router.replace(`/procurement/rfqs/${id}`),
  });
  const ready = suppliers.length > 0 && (indentLines.length > 0 || lines.some((line) => line.productId && Number(line.quantity) > 0));
  const nameOf = (id: string) => knownSuppliers.find((row) => row.id === id)?.label ?? "Supplier";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New RFQ" description="Ask two to five suppliers for prices. Each gets the RFQ as a PDF; record their answers as they come."
        secondaryActions={<div className="flex gap-2"><Button variant="secondary" onPress={() => router.replace("/procurement/rfqs")}>Cancel</Button>
          <Button variant="secondary" isDisabled={!ready || save.isPending} onPress={() => save.mutate(false)}>Save draft</Button></div>}
        primaryAction={<Button variant="primary" isLoading={save.isPending} isDisabled={!ready || save.isPending || save.isSuccess} onPress={() => save.mutate(true)}>
          <Send className="size-4" aria-hidden="true" />Save and mark sent</Button>} />
      {save.error && <Notice>{errorMessage(save.error)}</Notice>}
      <Panel title="Request">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Subject" placeholder="Steel for line 2" value={values.title} onChange={set("title")} />
          <TextField label="Reply by" type="date" value={values.responseDueDate} onChange={set("responseDueDate")} />
        </div>
      </Panel>
      <Panel title="Suppliers to ask" description="Two to five suppliers usually give a fair comparison.">
        <div className="flex flex-col gap-2">
          <ProcurementSearchPicker kind="suppliers" label="Add a supplier" activeOnly value={null} known={knownSuppliers}
            onPick={(id, row) => { keepSupplier(row as (typeof knownSuppliers)[number] | null); if (id) setSuppliers((state) => (state.includes(id) ? state : [...state, id])); }} />
          {suppliers.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {suppliers.map((id) => (
                <li key={id} className="flex items-center gap-1 rounded-[var(--radius-control)] border border-border px-2 py-1 text-sm">{nameOf(id)}
                  <IconButton aria-label={`Remove ${nameOf(id)}`} variant="ghost" size="compact" onPress={() => setSuppliers((state) => state.filter((entry) => entry !== id))}>
                    <Trash2 className="size-3.5" aria-hidden="true" /></IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
      {indentLines.length > 0 ? (
        <Panel title="Items (from indents)">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {indentLines.map((line) => <li key={line.id} className="flex justify-between gap-2 py-2"><span><span className="font-medium">{line.productName}</span>
              <span className="block text-xs text-text-muted">{line.indentNumber}{line.requiredBy ? ` · needed by ${calendarDate(line.requiredBy)}` : ""}</span></span>
              <span className="tabular-nums">{quantity(line.remaining)} {line.uomCode}</span></li>)}
          </ul>
        </Panel>
      ) : (
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
                <TextField label="Needed by" type="date" value={line.requiredBy} onChange={(value) => setLine(line.key, { requiredBy: value })} />
                <IconButton aria-label={`Remove item ${index + 1}`} variant="ghost" isDisabled={lines.length <= 1} onPress={() => setLines((state) => state.filter((entry) => entry.key !== line.key))}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Notes"><TextArea label="Notes for the suppliers" value={values.notes} onChange={set("notes")} /></Panel>
    </div>
  );
}

// ---------------------------------------------------------------- detail and comparison

export function RfqDetailScreen({ rfqId }: { rfqId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rfq", rfqId), queryFn: () => getRfq(rfqId) });
  const comparison = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rfq-comparison", rfqId), queryFn: () => getComparison(rfqId),
    enabled: Boolean(query.data?.suppliers.some((entry) => entry.quotation)) });
  const [quoting, setQuoting] = useState<RfqDetail["suppliers"][number] | null>(null);
  const refresh = () => queryClient.invalidateQueries({ predicate: (entry) => entry.queryKey.includes("procurement") });
  const act = useMutation({ mutationFn: (action: "send" | "cancel" | "close") => rfqAction(rfqId, action), onSuccess: refresh });
  if (query.isLoading) return <LoadingState label="Loading RFQ" />;
  if (query.isError || !query.data) return <ErrorState title={query.error instanceof ProcApiError && query.error.status === 404 ? "RFQ not found" : "Could not load this RFQ"}
    description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  const { rfq, lines, suppliers, orders, actions } = query.data;
  return (
    <div className="flex flex-col gap-4">
      <DocumentChain type="purchase_rfq" id={rfq.id} />
      {act.error && <Notice>{errorMessage(act.error)}</Notice>}
      {rfq.status === "awarded" && orders.length > 0 && <Notice tone="success">Awarded: {orders.map((order, index) => <span key={order.id}>{index ? ", " : ""}
        <Link className="font-medium underline" href={order.href}>{order.number}</Link></span>)}.</Notice>}
      <RecordDetailsPage
        header={{
          title: rfq.number,
          status: <StatusBadge tone={TONE[rfq.status] ?? "neutral"}>{rfq.statusLabel}</StatusBadge>,
          fields: [
            { label: "For", value: rfq.title ?? "—" },
            { label: "Reply by", value: rfq.responseDueDate ? calendarDate(rfq.responseDueDate) : "—" },
            { label: "Replies", value: `${suppliers.filter((entry) => entry.quotation).length} of ${suppliers.length}` },
          ],
          primaryAction: rfq.status === "draft" && actions.send ? <Button variant="primary" isLoading={act.isPending} onPress={() => act.mutate("send")}><Send className="size-4" aria-hidden="true" />Mark sent</Button> : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              <a className={buttonVariants({ variant: "secondary" })} href={rfqPdfUrl(rfq.id, undefined, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />RFQ PDF</a>
              {actions.close && <Button variant="ghost" onPress={() => act.mutate("close")}>Close without buying</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => act.mutate("cancel")}>Cancel RFQ</Button>}
            </div>
          ),
        }}
      >
        <Panel title="Suppliers asked">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {suppliers.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col"><span className="flex items-center gap-1 font-medium">{entry.supplierName}{entry.msme && <StatusBadge tone="info">MSME</StatusBadge>}</span>
                  <span className="text-xs text-text-muted">{entry.quotation ? <>Answered: <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/quotations/${entry.quotation.id}`}>{entry.quotation.number}</Link></>
                    : entry.status === "declined" ? `Declined${entry.declinedReason ? `: ${entry.declinedReason}` : ""}` : entry.sentAt ? `Sent ${calendarDate(entry.sentAt)}` : "Not sent yet"}
                    {entry.email ? ` · ${entry.email}` : ""}</span></span>
                <span className="flex gap-2">
                  <a className={buttonVariants({ variant: "ghost", size: "compact" })} href={rfqPdfUrl(rfq.id, entry.supplierId)} download>PDF</a>
                  {entry.phone && <a className={buttonVariants({ variant: "ghost", size: "compact" })} target="_blank" rel="noreferrer"
                    href={`https://wa.me/${entry.phone.replace(/\D/g, "").replace(/^0/, "91")}?text=${encodeURIComponent(`Request for quotation ${rfq.number}${rfq.title ? ` — ${rfq.title}` : ""}. Please send your rates${rfq.responseDueDate ? ` by ${calendarDate(rfq.responseDueDate)}` : ""}.`)}`}>WhatsApp</a>}
                  {actions.recordQuote && !entry.quotation && entry.status !== "declined" && <Button size="compact" variant="secondary" onPress={() => setQuoting(entry)}>Record prices</Button>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        {comparison.data ? <ComparisonPanel comparison={comparison.data} onAwarded={() => void refresh()} /> : (
          <Panel title="Items">
            <ul className="flex flex-col divide-y divide-border text-sm">
              {lines.map((line) => <li key={line.id} className="flex justify-between gap-2 py-2"><span><span className="font-medium">{line.productName}</span>
                <span className="block text-xs text-text-muted">{line.productCode}{line.indentNumber ? ` · ${line.indentNumber}` : ""}{line.requiredBy ? ` · needed by ${calendarDate(line.requiredBy)}` : ""}</span></span>
                <span className="tabular-nums">{quantity(line.quantity)} {line.uomCode}</span></li>)}
            </ul>
          </Panel>
        )}
      </RecordDetailsPage>
      {quoting && <QuoteDialog rfq={query.data} supplier={quoting} onClose={() => setQuoting(null)} onDone={() => { setQuoting(null); void refresh(); }} />}
    </div>
  );
}

// A supplier's answer: their rate for each line (blank for a line they did not quote), freight, lead time and validity.
function QuoteDialog({ rfq, supplier, onClose, onDone }: { rfq: RfqDetail; supplier: RfqDetail["suppliers"][number]; onClose: () => void; onDone: () => void }) {
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [values, setValues] = useState({ supplierReference: "", validUntil: "", deliveryLeadDays: "", freightAmount: "" });
  const set = (key: keyof typeof values) => (value: string) => setValues((state) => ({ ...state, [key]: value }));
  const run = useMutation({ mutationFn: () => rfqAction(rfq.rfq.id, "quotation", { supplierId: supplier.supplierId, supplierReference: values.supplierReference || null,
    validUntil: values.validUntil || null, deliveryLeadDays: values.deliveryLeadDays || null, freightAmount: values.freightAmount || "0",
    lines: rfq.lines.filter((line) => prices[line.id]).map((line) => ({ rfqLineId: line.id, unitPrice: prices[line.id] })) }), onSuccess: onDone });
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={`Prices from ${supplier.supplierName}`} size="lg" description="Their rate per unit before GST. Leave a line empty if they did not quote it.">
      <div className="flex flex-col gap-3">
        {run.error && <Notice>{errorMessage(run.error)}</Notice>}
        <div className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border">
          {rfq.lines.map((line) => (
            <div key={line.id} className="grid grid-cols-1 items-end gap-2 p-2 sm:grid-cols-[2fr_1fr]">
              <span className="text-sm"><span className="font-medium">{line.productName}</span><span className="block text-xs text-text-muted">{quantity(line.quantity)} {line.uomCode}</span></span>
              <TextField label="Rate" inputMode="decimal" value={prices[line.id] ?? ""} onChange={(value) => setPrices((state) => ({ ...state, [line.id]: value }))} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <TextField label="Freight and other charges" inputMode="decimal" value={values.freightAmount} onChange={set("freightAmount")} description="For the whole quotation; shared over the lines." />
          <TextField label="Delivery lead time (days)" inputMode="numeric" value={values.deliveryLeadDays} onChange={set("deliveryLeadDays")} />
          <TextField label="Valid until" type="date" value={values.validUntil} onChange={set("validUntil")} />
          <TextField label="Their reference" value={values.supplierReference} onChange={set("supplierReference")} />
        </div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!Object.values(prices).some(Boolean)} isLoading={run.isPending} onPress={() => run.mutate()}>Save prices</Button></div>
      </div>
    </Dialog>
  );
}

// Suppliers as columns, items as rows; the lowest landed rate is marked; the buyer picks a winner per line (or one supplier for everything).
function ComparisonPanel({ comparison, onAwarded }: { comparison: Comparison; onAwarded: () => void }) {
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(comparison.lines.map((line) => [line.id,
    line.offers.find((offer) => offer.awarded)?.quotationLineId ?? line.offers.find((offer) => offer.lowest)?.quotationLineId ?? ""])));
  const [reason, setReason] = useState("");
  const currency = comparison.rfq.currencyCode;
  const awardable = comparison.actions.award;
  const notLowest = comparison.lines.filter((line) => picked[line.id] && !line.offers.find((offer) => offer.quotationLineId === picked[line.id])?.lowest);
  const award = useMutation({ mutationFn: () => rfqAction(comparison.rfq.id, "award", { reason: reason || undefined,
    awards: comparison.lines.filter((line) => picked[line.id]).map((line) => ({ rfqLineId: line.id, quotationLineId: picked[line.id] })) }), onSuccess: onAwarded });
  const pickSupplier = (quotationId: string) => setPicked(Object.fromEntries(comparison.lines.map((line) => [line.id,
    line.offers.find((offer) => offer.quotationId === quotationId)?.quotationLineId ?? ""])));
  return (
    <Panel title="Comparison" description="Landed rate = rate after discount + its share of freight + GST, per unit. The lowest landed rate on each line is marked.">
      {award.error && <Notice>{errorMessage(award.error)}</Notice>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="py-2 pr-3 font-normal">Item</th>
              {comparison.suppliers.map((supplier) => (
                <th key={supplier.quotationId} className="py-2 pr-3 align-bottom font-normal">
                  <span className="flex items-center gap-1 font-medium text-text">{supplier.supplierName}{supplier.msme && <StatusBadge tone="info">MSME</StatusBadge>}</span>
                  <span className="block text-xs">{supplier.leadDays != null ? `${supplier.leadDays} days` : "Lead time —"} · {supplier.paymentTerms ?? "Terms —"}</span>
                  <span className="block text-xs">Freight {money(currency, supplier.freight)} · Total {money(currency, supplier.landedTotal)}</span>
                  {awardable && <Button size="compact" variant="ghost" onPress={() => pickSupplier(supplier.quotationId)}>Choose for all</Button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {comparison.lines.map((line) => (
              <tr key={line.id}>
                <td className="py-2 pr-3 align-top"><span className="font-medium">{line.productName}</span>
                  <span className="block text-xs text-text-muted">{quantity(line.quantity)} {line.uomCode}</span>
                  {line.lastPrice && <span className="block text-xs text-text-muted">Last paid {money(currency, line.lastPrice.unitPrice)} ({line.lastPrice.supplierName}, {calendarDate(line.lastPrice.date)})</span>}</td>
                {comparison.suppliers.map((supplier) => {
                  const offer = line.offers.find((entry) => entry.quotationId === supplier.quotationId);
                  if (!offer) return <td key={supplier.quotationId} className="py-2 pr-3 align-top text-text-muted">Not quoted</td>;
                  const chosen = picked[line.id] === offer.quotationLineId;
                  return (
                    <td key={supplier.quotationId} className={`py-2 pr-3 align-top ${offer.lowest ? "bg-success-soft" : ""}`}>
                      <label className="flex cursor-pointer items-start gap-2">
                        {awardable && <input type="radio" name={`award-${line.id}`} className="mt-1" checked={chosen} onChange={() => setPicked((state) => ({ ...state, [line.id]: offer.quotationLineId }))} />}
                        <span className="flex flex-col">
                          <span className="font-medium tabular-nums">{money(currency, offer.landedRate)} landed{offer.lowest && <span className="ml-1 text-xs text-success">Lowest</span>}</span>
                          <span className="text-xs text-text-muted tabular-nums">Rate {money(currency, offer.netRate)} · GST {Number(offer.gstRate)}%{Number(offer.freightPerUnit) ? ` · freight ${money(currency, offer.freightPerUnit)}` : ""}</span>
                          {offer.expired && <span className="text-xs text-warning">Quotation expired</span>}
                          {offer.awarded && <span className="text-xs text-success">Awarded</span>}
                        </span>
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {awardable && (
        <div className="mt-3 flex flex-col gap-2">
          {notLowest.length > 0 && <TextField label="Why not the lowest landed rate?" value={reason} onChange={setReason}
            description={`Needed for ${notLowest.map((line) => line.productName).join(", ")}.`} />}
          <div className="flex justify-end">
            <Button variant="primary" isLoading={award.isPending} isDisabled={!Object.values(picked).some(Boolean) || (notLowest.length > 0 && !reason.trim())} onPress={() => award.mutate()}>
              Award and create purchase orders</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
