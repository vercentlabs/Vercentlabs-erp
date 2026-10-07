"use client";

// Purchase returns: the list (views, filters) and a return's detail — its items, Inventory's movements, the supplier's resolution, the
// financial adjustments, related documents, files and history. Physical return, supplier resolution, financial adjustment and replacement are
// separate statuses, each derived by the server.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Download, Eye, Pencil, Plus } from "lucide-react";
import {
  Button, Checkbox, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, RecordDetailsPage, SearchField, Select, StatusBadge, Tab,
  TabList, TabPanel, Tabs, TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useListState, useTabParam } from "@/features/procurement/shared/navigation";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, dateTime, money, quantity, statusLabel } from "@/features/procurement/shared/format";

import {
  errorMessage, getReturn, getReturnOptions, issuesOf, listReturnFiles, listReturns, removeReturnFile, returnAction, returnFileUrl, returnNoteUrl, uploadReturnFile,
  type ReturnDetail, type ReturnRow,
} from "../api/purchase-returns-api";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const DOC_TONE: Record<string, Tone> = { draft: "neutral", posted: "success", cancelled: "neutral", reversed: "danger" };
const STATE_TONE: Record<string, Tone> = { pending: "warning", partially_resolved: "info", resolved: "success", not_required: "neutral", partially_reconciled: "info", reconciled: "success",
  awaiting: "warning", partially_received: "info", completed: "success", not_applicable: "neutral" };
const State = ({ value, label }: { value: string; label: string }) => (value === "not_applicable" ? <span className="text-xs text-text-muted">—</span> : <StatusBadge tone={STATE_TONE[value] ?? "neutral"}>{label}</StatusBadge>);

// ---------------------------------------------------------------- list

export function PurchaseReturnsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // The view is in the URL; the search and filters are remembered for this browser tab.
  const listState = useListState("purchase-returns", { view: "all", filters: { reason: "any", financialStatus: "any", replacementStatus: "any" } });
  const { view, setView, search, setSearch, filters, setFilters } = listState;
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "return-options"), queryFn: getReturnOptions, staleTime: 60_000 });
  const query = useMemo(() => ({ view: view === "all" ? undefined : view, search: search.trim() || undefined,
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "any")) }), [view, search, filters]);
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-returns", query), queryFn: () => listReturns(query) });
  const rows = list.data ?? [];
  const set = (key: keyof typeof filters) => (value: React.Key | null) => setFilters((current) => ({ ...current, [key]: String(value) }));
  const columns = useMemo<ColumnDef<ReturnRow, unknown>[]>(() => [
    { id: "number", header: "Return", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.returnNumber}</span> },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "order", header: "Purchase order", cell: ({ row }) => row.original.purchaseOrderNumber },
    { id: "receipts", header: "Goods receipts", cell: ({ row }) => row.original.receipts.join(", ") || "—" },
    { id: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouseName ?? "—" },
    { id: "date", header: "Return date", cell: ({ row }) => calendarDate(row.original.returnDate) },
    { id: "items", header: "Items", cell: ({ row }) => <span className="tabular-nums">{row.original.items} · {quantity(row.original.quantity)}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge tone={DOC_TONE[row.original.status] ?? "neutral"}>{row.original.statusLabel}</StatusBadge> },
    { id: "expected", header: "Expected resolution", cell: ({ row }) => row.original.expectedResolutionLabel ?? "—" },
    { id: "financial", header: "Financial", cell: ({ row }) => <State value={row.original.financialStatus} label={row.original.financialLabel} /> },
    { id: "created", header: "Created by", cell: ({ row }) => row.original.createdByName ?? "—" },
  ], []);
  const filtered = search || view !== "all" || Object.values(filters).some((value) => value !== "any");
  return (
    <EnterpriseListPage header={{ title: "Purchase Returns", description: "Goods sent back to suppliers after they were received. Each return is its own document: the receipt it draws on is never changed.",
      primaryAction: options.data?.capabilities.manage ? <LinkButton variant="primary" href="/procurement/purchase-returns/new"><Plus className="size-4" aria-hidden="true" />New Purchase Return</LinkButton> : undefined }}
      savedViews={{ views: (options.data?.views ?? [{ key: "all", label: "All Returns" }]).map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search returns" placeholder="Return, supplier, PO, GRN or product" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="Reason" size="compact" selectedKey={filters.reason} onSelectionChange={set("reason")}
            options={[{ value: "any", label: "Any reason" }, ...(options.data?.reasons ?? []).map((reason) => ({ value: reason.code, label: reason.label }))]} />
          <Select aria-label="Financial status" size="compact" selectedKey={filters.financialStatus} onSelectionChange={set("financialStatus")}
            options={[{ value: "any", label: "Any financial status" }, { value: "pending", label: "Pending" }, { value: "partially_reconciled", label: "Partially reconciled" },
              { value: "reconciled", label: "Reconciled" }, { value: "not_required", label: "Not required" }]} />
          <Select aria-label="Replacement status" size="compact" selectedKey={filters.replacementStatus} onSelectionChange={set("replacementStatus")}
            options={[{ value: "any", label: "Any replacement" }, { value: "awaiting", label: "Awaiting" }, { value: "partially_received", label: "Partially received" },
              { value: "completed", label: "Completed" }, { value: "not_required", label: "Not required" }]} />
        </>
      ) }}>
      <EnterpriseDataGrid<ReturnRow> aria-label="Purchase returns" columns={columns} data={rows} getRowId={(row) => row.id}
        state={list.isLoading ? "loading" : list.isError ? "error" : rows.length === 0 ? (filtered ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading purchase returns" rows={6} />}
        errorContent={<ErrorState title="Could not load purchase returns" description={errorMessage(list.error)} action={{ label: "Try again", onPress: () => void list.refetch() }} />}
        emptyContent={<EmptyState title="No purchase returns yet" description="Return goods from a posted goods receipt or purchase order." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view, filter or search." />}
        onRowClick={(row) => router.push(`/procurement/purchase-returns/${row.id}`)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.returnNumber} · {row.supplierName}</span>
          <span className="text-xs text-text-muted">{row.purchaseOrderNumber} · {row.statusLabel} · {row.financialLabel}</span></div>} />
    </EnterpriseListPage>
  );
}

// ---------------------------------------------------------------- detail

function Shell({ title, description, error, onClose, label, isLoading, isDisabled, onPress, children }: {
  title: string; description?: string; error: unknown; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean; onPress: () => void; children?: React.ReactNode;
}) {
  const issues = issuesOf(error);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description} size="lg">
      <div className="flex flex-col gap-3">
        {Boolean(error) && <ProcAlert>{errorMessage(error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</ProcAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

type DialogName = "post" | "cancel" | "reverse" | "acknowledge" | "refund" | "resolve" | "replacement";

export function PurchaseReturnDetailScreen({ returnId }: { returnId: string }) {
  const [tab, setTab] = useTabParam(["overview","items","movements","quality","financial","resolution","related","notes","history"], "overview");
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "purchase-return", returnId), queryFn: () => getReturn(returnId) });
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const validate = useMutation({ mutationFn: () => returnAction(returnId, "validate") });
  function changed(message: string) { setDialog(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); }
  if (query.isLoading) return <LoadingState label="Loading purchase return" />;
  if (!query.data) return <ErrorState title="Could not load this return" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const detail = query.data;
  const { purchaseReturn: ret, actions } = detail;
  const validation = validate.data as { ready?: boolean; issues?: string[]; warnings?: string[] } | undefined;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/purchase-returns" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-3.5" aria-hidden="true" />All purchase returns</Link>
      {notice && <ProcAlert tone="success">{notice}</ProcAlert>}
      {validation && (validation.ready ? <ProcAlert tone="success">Ready to post: every quantity and the stock check out.{validation.warnings?.length ? ` ${validation.warnings.join(" ")}` : ""}</ProcAlert>
        : <ProcAlert>{(validation.issues ?? []).map((issue) => <p key={issue}>{issue}</p>)}</ProcAlert>)}
      {ret.status === "reversed" && <ProcAlert tone="warning">Reversed {dateTime(ret.reversedAt)}{ret.reversedByName ? ` by ${ret.reversedByName}` : ""}: {ret.reversalReason}. The goods came back; the return no longer counts.</ProcAlert>}
      {ret.status === "cancelled" && <ProcAlert tone="info">Cancelled {dateTime(ret.cancelledAt)}{ret.cancelReason ? `: ${ret.cancelReason}` : ""}.</ProcAlert>}
      <RecordDetailsPage header={{
        title: ret.returnNumber,
        status: <span className="flex flex-wrap gap-2"><StatusBadge tone={DOC_TONE[ret.status] ?? "neutral"}>{ret.statusLabel}</StatusBadge>
          <State value={ret.resolutionStatus} label={`Supplier: ${ret.resolutionLabel}`} /><State value={ret.financialStatus} label={`Financial: ${ret.financialLabel}`} />
          {ret.replacementStatus !== "not_required" && <State value={ret.replacementStatus} label={`Replacement: ${ret.replacementLabel}`} />}</span>,
        fields: [
          { label: "Supplier", value: ret.supplierName ?? "—" },
          { label: "Purchase order", value: <Link className="text-brand hover:underline" href={detail.related.purchaseOrder.href}>{ret.purchaseOrderNumber}</Link> },
          { label: "Return date", value: calendarDate(ret.returnDate) },
          { label: "Warehouse", value: ret.warehouseName ?? "—" },
        ],
        primaryAction: actions.post ? <Button variant="primary" onPress={() => setDialog("post")}>Post Dispatch</Button>
          : actions.createCredit ? <LinkButton variant="primary" href={`/procurement/debit-notes-credits/vendor-credits/new?purchaseReturnId=${ret.id}&supplierId=${ret.supplierId}`}>Record Vendor Credit</LinkButton> : undefined,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            {actions.edit && <LinkButton variant="secondary" href={`/procurement/purchase-returns/${ret.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
            {actions.validate && <Button variant="secondary" isLoading={validate.isPending} onPress={() => validate.mutate()}>Validate Return</Button>}
            {actions.acknowledge && <Button variant="ghost" onPress={() => setDialog("acknowledge")}>Record Acknowledgement</Button>}
            {actions.replacement && <Button variant="ghost" onPress={() => setDialog("replacement")}>Track Replacement</Button>}
            {actions.refund && <Button variant="ghost" onPress={() => setDialog("refund")}>Record Refund</Button>}
            {actions.resolve && <Button variant="ghost" onPress={() => setDialog("resolve")}>Record Resolution</Button>}
            {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Draft</Button>}
            {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse (goods came back)</Button>}
            <a className={buttonVariants({ variant: "ghost" })} href={returnNoteUrl(ret.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Return note</a>
            <a className={buttonVariants({ variant: "ghost" })} href={returnNoteUrl(ret.id)} download><Download className="size-4" aria-hidden="true" />PDF</a>
          </div>
        ),
      }}>
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Purchase return sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Returned Items</Tab>
            <Tab id="movements">Inventory Movements</Tab>
            <Tab id="quality">Quality &amp; Rejection</Tab>
            <Tab id="financial">Financial Adjustments</Tab>
            <Tab id="resolution">Supplier Resolution</Tab>
            <Tab id="related">Related Documents</Tab>
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="pt-4">
              <ProcPanel title="Return">
                <ProcFacts columns={3} items={[
                  { label: "Supplier (as returned to)", value: `${ret.supplier?.legalName ?? ret.supplierName ?? "—"}${ret.supplier?.gstin ? ` · ${ret.supplier.gstin}` : ""}` },
                  { label: "Return to", value: ret.returnTo ? [ret.returnTo.line1, ret.returnTo.city, ret.returnTo.state, ret.returnTo.postalCode].filter(Boolean).join(", ") : "—" },
                  { label: "Expected resolution", value: ret.expectedResolutionLabel ?? "—" },
                  { label: "Supplier RMA", value: ret.supplierRmaReference ?? "—" },
                  { label: "Supplier acknowledgement", value: ret.supplierAcknowledgedAt ? `${calendarDate(ret.supplierAcknowledgedAt)}${ret.supplierAcknowledgementReference ? ` · ${ret.supplierAcknowledgementReference}` : ""}` : "Not yet" },
                  { label: "Carrier / tracking", value: [ret.carrierReference, ret.trackingReference].filter(Boolean).join(" · ") || "—" },
                  { label: "Challan / dispatch ref", value: ret.dispatchReference ?? "—" },
                  { label: "Dispatched", value: ret.dispatchedAt ? dateTime(ret.dispatchedAt) : "Not yet" },
                  { label: "Created", value: `${dateTime(ret.createdAt)}${ret.createdByName ? ` by ${ret.createdByName}` : ""}` },
                  { label: "Posted", value: ret.postedAt ? `${dateTime(ret.postedAt)}${ret.postedByName ? ` by ${ret.postedByName}` : ""}` : "Not posted" },
                  { label: "Summary", value: ret.reason },
                ]} />
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="items">
            <div className="pt-4">
              <ProcPanel title="Returned items" description="Each line against the receipt line it draws on. What was received stays received.">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-text-muted">{["Item", "Source", "Received", "Returned elsewhere", "Returned now", "Reason", "From"].map((name, index) =>
                      <th key={name} className={index >= 2 && index <= 4 ? "py-1 pr-3 text-right font-normal" : "py-1 pr-3 font-normal"}>{name}</th>)}</tr></thead>
                    <tbody className="divide-y divide-border">
                      {detail.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 pr-3">{line.description}<span className="block text-xs text-text-muted">{[line.product?.code, line.batchNumber && `Lot ${line.batchNumber}`,
                            line.expiryDate && `Exp ${calendarDate(line.expiryDate)}`, line.serialNumbers.length ? `S/N ${line.serialNumbers.join(", ")}` : null].filter(Boolean).join(" · ")}</span></td>
                          <td className="py-2 pr-3">{line.receiptNumber} / line {line.receiptLineNumber}<span className="block text-xs text-text-muted">PO line {line.orderLineNumber}</span></td>
                          <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.received)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.returnedElsewhere)}</td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">{quantity(line.quantity)} {line.uom?.code ?? ""}</td>
                          <td className="py-2 pr-3">{line.reasonLabel}{line.reasonNotes && <span className="block text-xs text-text-muted">{line.reasonNotes}</span>}</td>
                          <td className="py-2 pr-3">{line.rejectionNumber ? `Rejection ${line.rejectionNumber}` : statusLabel(line.stockDisposition ?? "usable_stock")}{line.locationCode ? ` · ${line.locationCode}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="movements">
            <div className="pt-4">
              <ProcPanel title="Inventory movements" description="Out when the return posted; back in only if it was reversed because the goods came back. Physical non-stock goods move no stock.">
                {!detail.movements.length ? <p className="text-sm text-text-muted">{ret.status === "draft" ? "A draft moves no stock." : "No stock movements (non-stock goods)."}</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.movements.map((movement) => (
                      <li key={movement.id} className="flex flex-wrap justify-between gap-2 py-2">
                        <span><span className="font-medium tabular-nums">{movement.number ?? movement.type}</span> · {movement.direction === "out" ? "Out" : "Back in"} · {movement.item} · {movement.warehouseName}{movement.locationCode ? ` / ${movement.locationCode}` : ""}
                          <span className="block text-xs text-text-muted">{movement.reason}</span></span>
                        <span className="tabular-nums">{quantity(String(Math.abs(Number(movement.quantity))))} · {dateTime(movement.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="quality">
            <div className="pt-4">
              <ProcPanel title="Quality and rejection" description="The rejection cases and inspections the returned goods came from.">
                {!detail.related.rejections.length ? <p className="text-sm text-text-muted">The goods were returned from usable stock: no rejection case.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.related.rejections.map((entry) => <li key={entry.id} className="py-2">Receiving issue <Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link></li>)}
                  </ul>
                )}
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {detail.lines.map((line) => <li key={line.id}>{line.description}: {line.reasonLabel}{line.reasonNotes ? ` — ${line.reasonNotes}` : ""}{line.rejectionNumber ? ` (from ${line.rejectionNumber})` : ` (${statusLabel(line.stockDisposition ?? "usable_stock")})`}</li>)}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="resolution">
            <div className="flex flex-col gap-4 pt-4">
              <ProcPanel title="Supplier resolution" description="What the supplier actually did. A promise is not a resolution.">
                <ProcFacts columns={3} items={[
                  { label: "Expected", value: ret.expectedResolutionLabel ?? "—" }, { label: "Status", value: detail.resolution.resolutionLabel },
                  { label: "Returned / resolved", value: `${quantity(detail.resolution.figures.returned ?? "0")} / ${quantity(detail.resolution.figures.resolvedQuantity ?? "0")}` },
                ]} />
                {!detail.resolution.entries.length ? <p className="text-sm text-text-muted">Nothing recorded yet.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.resolution.entries.map((entry) => (
                      <li key={entry.id} className="py-2"><span className="font-medium">{entry.typeLabel}</span>{entry.quantity ? ` · ${quantity(entry.quantity)}` : ""}{entry.amount ? ` · ${entry.amount}` : ""}
                        {entry.reference ? ` · ${entry.reference}` : ""}<span className="block text-xs text-text-muted">{entry.notes} — {entry.recordedBy ?? "—"}, {dateTime(entry.recordedAt)}</span></li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
              <ProcPanel title="Replacement" description="A replacement is its own purchase order, received on its own goods receipt; the original order is never reopened.">
                {detail.resolution.replacementOrder ? (
                  <p className="text-sm"><Link className="font-medium text-brand hover:underline" href={`/procurement/purchase-orders/${detail.resolution.replacementOrder.purchaseOrderId}`}>{detail.resolution.replacementOrder.purchaseOrderNumber}</Link>
                    {" "}({statusLabel(detail.resolution.replacementOrder.orderStatus)}{ret.replacementNoCharge ? ", no charge" : ""}) · ordered {quantity(detail.resolution.replacementOrder.ordered)}, received {quantity(detail.resolution.replacementOrder.received)}</p>
                ) : <p className="text-sm text-text-muted">{ret.replacementStatus === "awaiting" ? "A replacement is expected; no replacement order yet." : "None."}</p>}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="financial">
            <div className="flex flex-col gap-4 pt-4">
              <ProcPanel title="Financial adjustment" description="Returned goods that were not billed need no credit (they are simply not billed). Billed goods are corrected by a vendor credit, or a refund Finance received — never twice.">
                <ProcFacts columns={3} items={[
                  { label: "Status", value: detail.financial.label }, { label: "Unbilled returned", value: quantity(detail.financial.figures.unbilledQuantity ?? "0") },
                  { label: "Billed returned", value: `${quantity(detail.financial.figures.billedQuantity ?? "0")} (${detail.financial.figures.billedValue ?? "0"})` },
                  { label: "Credited (posted vendor credits)", value: `${quantity(detail.financial.figures.creditedQuantity ?? "0")} (${detail.financial.figures.creditedValue ?? "0"})` },
                  { label: "Refunded", value: detail.financial.figures.refunded ?? "0" }, { label: "Still uncorrected", value: detail.financial.figures.outstandingValue ?? "0" },
                ]} />
                {detail.financial.allocations.length > 0 && (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.financial.allocations.map((entry) => (
                      <li key={entry.id} className="py-2">Line {entry.lineNumber} · {entry.type === "unbilled" ? "Not billed yet" : entry.type === "billed" ? `Billed on ${entry.billNumber}` : `Credited by ${entry.creditNumber} (${statusLabel(entry.creditStatus ?? "")})`}
                        {" "}· {quantity(entry.quantity)}{entry.value ? ` · ${entry.value}` : ""}</li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
              <ProcPanel title="Bills and vendor credits">
                <ul className="flex flex-col gap-1 text-sm">
                  {detail.financial.bills.map((bill) => <li key={bill.id}>Bill <Link className="text-brand hover:underline" href={bill.href}>{bill.billNumber}</Link>{bill.supplierInvoiceNumber ? ` (${bill.supplierInvoiceNumber})` : ""} · {statusLabel(bill.status)} · outstanding {bill.outstanding}</li>)}
                  {detail.financial.vendorCredits.map((note) => <li key={note.id}>Vendor credit <Link className="text-brand hover:underline" href={note.href}>{note.number}</Link> · {statusLabel(note.status)} · {note.total}</li>)}
                  {!detail.financial.bills.length && !detail.financial.vendorCredits.length && <li className="text-text-muted">No bills yet for these goods.</li>}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="related">
            <div className="pt-4">
              <ProcPanel title="Related documents">
                <ul className="flex flex-col gap-2 text-sm">
                  <li>Purchase order <Link className="text-brand hover:underline" href={detail.related.purchaseOrder.href}>{detail.related.purchaseOrder.number}</Link></li>
                  {detail.related.receipts.map((entry) => <li key={entry.id}>Goods receipt <Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link></li>)}
                  {detail.related.rejections.map((entry) => <li key={entry.id}>Rejection <Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link></li>)}
                  {detail.related.replacement && <li>Replacement order <Link className="text-brand hover:underline" href={detail.related.replacement.href}>{detail.related.replacement.number}</Link></li>}
                  {detail.financial.vendorCredits.map((note) => <li key={note.id}>Vendor credit <Link className="text-brand hover:underline" href={note.href}>{note.number}</Link></li>)}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="notes"><div className="flex flex-col gap-4 pt-4"><ReturnFiles detail={detail} /></div></TabPanel>
          <TabPanel id="history">
            <div className="pt-4">
              <ProcPanel title="History">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {detail.history.map((entry) => <li key={entry.id} className="py-2">{entry.summary}<span className="block text-xs text-text-muted">{dateTime(entry.at)}{entry.actor ? ` · ${entry.actor}` : ""}</span></li>)}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "post" && <PostDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "cancel" && <ReasonDialog title="Cancel the draft return" label="Cancel draft" action="cancel" returnId={ret.id} required={false} onClose={() => setDialog(null)} onDone={() => changed("Draft cancelled.")} />}
      {dialog === "reverse" && <ReverseDialog returnId={ret.id} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "acknowledge" && <AcknowledgeDialog returnId={ret.id} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "refund" && <RefundDialog returnId={ret.id} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "resolve" && <ResolutionDialog returnId={ret.id} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "replacement" && <ReplacementDialog returnId={ret.id} onClose={() => setDialog(null)} onDone={changed} />}
    </div>
  );
}

function PostDialog({ detail, onClose, onDone }: { detail: ReturnDetail; onClose: () => void; onDone: (message: string) => void }) {
  const ret = detail.purchaseReturn;
  const [confirmed, setConfirmed] = useState(false);
  const [values, setValues] = useState({ carrierReference: ret.carrierReference ?? "", trackingReference: ret.trackingReference ?? "", dispatchReference: ret.dispatchReference ?? "" });
  const mutation = useMutation({ mutationFn: () => returnAction(ret.id, "post", { dispatchConfirmed: confirmed, ...values }), onSuccess: () => onDone("Posted: the goods left and the stock was issued.") });
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <Shell title="Post the dispatch" description={`The eligible stock leaves ${ret.warehouseName ?? "the warehouse"} now. Supplier credit, refund and replacement are tracked separately.`}
      error={mutation.error} onClose={onClose} label="Post Dispatch" isLoading={mutation.isPending} isDisabled={!confirmed} onPress={() => mutation.mutate()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Carrier" value={values.carrierReference} onChange={set("carrierReference")} />
        <TextField label="Tracking reference" value={values.trackingReference} onChange={set("trackingReference")} />
        <TextField label="Challan / dispatch reference" value={values.dispatchReference} onChange={set("dispatchReference")} />
      </div>
      <Checkbox isSelected={confirmed} onChange={setConfirmed}>The goods have physically left our custody (handed to the supplier or the carrier).</Checkbox>
    </Shell>
  );
}

function ReasonDialog({ title, label, action, returnId, required, onClose, onDone }: { title: string; label: string; action: "cancel"; returnId: string; required: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => returnAction(returnId, action, { reason }), onSuccess: onDone });
  return (
    <Shell title={title} error={mutation.error} onClose={onClose} label={label} isLoading={mutation.isPending} isDisabled={required && reason.trim().length < 3} onPress={() => mutation.mutate()}>
      <TextArea label="Reason" value={reason} onChange={setReason} />
    </Shell>
  );
}

function ReverseDialog({ returnId, onClose, onDone }: { returnId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [back, setBack] = useState(false);
  const mutation = useMutation({ mutationFn: () => returnAction(returnId, "reverse", { reason, goodsReceivedBack: back }), onSuccess: () => onDone("Reversed: the goods are back in stock.") });
  return (
    <Shell title="Reverse the return" description="Only when the goods physically came back. They are received back where they left from; the return no longer counts."
      error={mutation.error} onClose={onClose} label="Reverse" isLoading={mutation.isPending} isDisabled={!back || reason.trim().length < 5} onPress={() => mutation.mutate()}>
      <TextArea label="Reason" value={reason} onChange={setReason} />
      <Checkbox isSelected={back} onChange={setBack}>The goods have physically come back into our custody.</Checkbox>
    </Shell>
  );
}

function AcknowledgeDialog({ returnId, onClose, onDone }: { returnId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [values, setValues] = useState({ reference: "", rmaReference: "", acknowledgedAt: "", notes: "" });
  const mutation = useMutation({ mutationFn: () => returnAction(returnId, "acknowledge", values), onSuccess: () => onDone("Supplier acknowledgement recorded.") });
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <Shell title="Record the supplier's acknowledgement" description="It records that the supplier accepted the return; only posting says the goods left." error={mutation.error}
      onClose={onClose} label="Record" isLoading={mutation.isPending} onPress={() => mutation.mutate()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <TextField label="Acknowledgement reference" value={values.reference} onChange={set("reference")} />
        <TextField label="Supplier RMA" value={values.rmaReference} onChange={set("rmaReference")} />
        <TextField label="Acknowledged on" type="date" value={values.acknowledgedAt} onChange={set("acknowledgedAt")} />
      </div>
      <TextArea label="Notes" value={values.notes} onChange={set("notes")} />
    </Shell>
  );
}

function RefundDialog({ returnId, onClose, onDone }: { returnId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [values, setValues] = useState({ amount: "", reference: "", quantity: "", receivedOn: "", notes: "" });
  const mutation = useMutation({ mutationFn: () => returnAction(returnId, "refunds", values), onSuccess: () => onDone("Refund recorded.") });
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <Shell title="Record a supplier refund" description="Money the supplier paid back, as Finance received it. Never more than the return is still worth." error={mutation.error}
      onClose={onClose} label="Record refund" isLoading={mutation.isPending} isDisabled={!values.amount || !values.reference} onPress={() => mutation.mutate()}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Amount" inputMode="decimal" value={values.amount} onChange={set("amount")} />
        <TextField label="Finance receipt reference" value={values.reference} onChange={set("reference")} />
        <TextField label="Quantity it settles" inputMode="decimal" value={values.quantity} onChange={set("quantity")} />
        <TextField label="Received on" type="date" value={values.receivedOn} onChange={set("receivedOn")} />
      </div>
      <TextArea label="Notes" value={values.notes} onChange={set("notes")} />
    </Shell>
  );
}

function ResolutionDialog({ returnId, onClose, onDone }: { returnId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [values, setValues] = useState({ type: "other_authorized_resolution", quantity: "", reference: "", notes: "" });
  const mutation = useMutation({ mutationFn: () => returnAction(returnId, "resolutions", values), onSuccess: () => onDone("Resolution recorded.") });
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));
  return (
    <Shell title="Record a resolution" description="A replacement received outside a replacement order, or another authorised resolution. Never more than is still unresolved." error={mutation.error}
      onClose={onClose} label="Record" isLoading={mutation.isPending} isDisabled={!values.quantity || !values.notes.trim()} onPress={() => mutation.mutate()}>
      <Select label="Resolution" selectedKey={values.type} onSelectionChange={(value) => set("type")(String(value))}
        options={[{ value: "other_authorized_resolution", label: "Other authorised resolution" }, { value: "replacement_received", label: "Replacement received" }]} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Quantity" inputMode="decimal" value={values.quantity} onChange={set("quantity")} />
        <TextField label="Reference" value={values.reference} onChange={set("reference")} />
      </div>
      <TextArea label="Description" value={values.notes} onChange={set("notes")} />
    </Shell>
  );
}

function ReplacementDialog({ returnId, onClose, onDone }: { returnId: string; onClose: () => void; onDone: (message: string) => void }) {
  const [noCharge, setNoCharge] = useState(false);
  const mutation = useMutation({ mutationFn: () => returnAction(returnId, "replacement", { create: true, noCharge }),
    onSuccess: (result) => onDone(`Replacement order ${String(result.replacementNumber ?? "")} drafted. Confirm it, then receive the replacement on its own goods receipt.`) });
  return (
    <Shell title="Order the replacement" description="Drafts a purchase order for the returned goods — the commitment the replacement is received against. The original order is never reopened."
      error={mutation.error} onClose={onClose} label="Draft replacement order" isLoading={mutation.isPending} onPress={() => mutation.mutate()}>
      <Checkbox isSelected={noCharge} onChange={setNoCharge}>The supplier replaces at no charge (zero prices — no second payable)</Checkbox>
    </Shell>
  );
}

function ReturnFiles({ detail }: { detail: ReturnDetail }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const key = scopedQueryKey(workspace, "procurement", "return-files", detail.purchaseReturn.id);
  const files = useQuery({ queryKey: key, queryFn: () => listReturnFiles(detail.purchaseReturn.id) });
  const upload = useMutation({ mutationFn: (file: File) => uploadReturnFile(detail.purchaseReturn.id, file), onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeReturnFile(detail.purchaseReturn.id, fileId), onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  return (
    <>
      {detail.purchaseReturn.internalNotes && <ProcPanel title="Internal notes" description="Never printed on the return note."><p className="whitespace-pre-wrap text-sm">{detail.purchaseReturn.internalNotes}</p></ProcPanel>}
      <ProcPanel title="Attachments" description="Inspection reports, photographs, the supplier's correspondence and dispatch documents."
        actions={detail.actions.edit || detail.actions.acknowledge ? <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button> : undefined}>
        <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
        {upload.error && <ProcAlert>{errorMessage(upload.error)}</ProcAlert>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a className="text-brand hover:underline" href={returnFileUrl(detail.purchaseReturn.id, file.id)}>{file.fileName}</a>
                <span className="flex items-center gap-3 text-text-muted">{dateTime(file.uploadedAt)}
                  {detail.actions.edit && <Button size="compact" variant="ghost" onPress={() => remove.mutate(file.id)}>Remove</Button>}</span>
              </li>
            ))}
          </ul>
        )}
      </ProcPanel>
    </>
  );
}

export const formatReturnValue = (currency: string, value: string) => money(currency, value);
