"use client";

// Procurement → Goods Receipts and Purchase Returns. A receipt is created
// from its purchase order (Create Goods Receipt), or here with New Goods
// Receipt by choosing an order that still has goods to receive; receipts are found,
// finished and posted, held goods released, discrepancies recorded, posted
// receipts reversed while nothing has used them, and goods returned. A
// return is its own document; the receipt it corrects is never changed.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Download, Eye, Pencil, Plus } from "lucide-react";
import {
  Button, Checkbox, CheckboxGroup, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, RecordDetailsPage, SearchField, Select, StatusBadge, Tab, TabList,
  TabPanel, Tabs, TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, dateTime, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";

import {
  errorMessage, getGoodsReceipt, getPurchaseOrderOptions, goodsReceiptPdfUrl, issuesOf, listGoodsReceipts, listReceiptFiles,
  receiptAction, receiptFileUrl, recordDiscrepancy, releaseHeld, removeReceiptFile, uploadReceiptFile, validateGoodsReceipt, type Disposition, type GoodsReceiptDetail, type GoodsReceiptRow,
} from "../api/purchase-orders-api";
import { ReceiptRejectionDialog, ReceivingIssuesGrid, RejectionTable } from "./RejectionScreens";
import { useListState, useTabParam } from "@/features/procurement/shared/navigation";
import { REJECTION_REASON_OPTIONS } from "../api/purchase-orders-api";
import { getReceiptBilling } from "@/features/procurement/supplier-bills/api/supplier-bills-api";

const ANY = "any";
const RECEIPT_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { draft: "neutral", posted: "success", cancelled: "neutral", reversed: "danger" };
const ReceiptStatus = ({ status }: { status: string }) => <StatusBadge tone={RECEIPT_TONE[status] ?? "neutral"}>{statusLabel(status)}</StatusBadge>;

// Goods receipt views, then the Receiving Issues queue (its own cases, including dock refusals that created no goods receipt).
const RECEIPT_LIST_VIEWS = [
  { id: "all", label: "All Goods Receipts" }, { id: "draft", label: "Draft" }, { id: "posted", label: "Posted" }, { id: "cancelled_reversed", label: "Cancelled / Reversed" },
  { id: "partially_billed", label: "Partially Matched to Bills" }, { id: "not_billed", label: "Not Yet Billed" }, { id: "with_rejections", label: "With Rejections / Discrepancies" },
  { id: "mine", label: "My Receipts" }, { id: "receiving-issues", label: "Receiving Issues" }, { id: "issues-before-custody", label: "↳ Before-Custody Refusals" },
  { id: "issues-shortages", label: "↳ Shortages / Wrong Deliveries" }, { id: "issues-pending-quality", label: "↳ Pending Quality" }, { id: "issues-after-custody", label: "↳ Post-Custody Rejections" },
];
const ISSUE_VIEWS: Record<string, string> = { "receiving-issues": "open", "issues-before-custody": "before_custody", "issues-shortages": "shortages_wrong",
  "issues-pending-quality": "awaiting_quality", "issues-after-custody": "after_custody" };

export function GoodsReceiptsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // The view is in the URL (?view=receiving-issues opens the issue queue); the search and filters are remembered for this browser tab.
  const list = useListState("goods-receipts", { view: "all", filters: { supplierId: ANY, warehouseId: ANY, productId: ANY, receivedById: ANY, dateFrom: "", dateTo: "", stage: ANY, reason: ANY } });
  const { view, setView, search, setSearch } = list;
  const { stage, reason, ...filters } = list.filters;
  const setFilters = (update: (current: typeof filters) => typeof filters) => list.setFilters((current) => ({ ...current, ...update(filters) }));
  const issueView = ISSUE_VIEWS[view];
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions, staleTime: 60_000 });
  const searchFilters = useMemo(() => ({ search: search.trim() || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value && value !== ANY)) }), [search, filters]);
  const listFilters = useMemo(() => ({ ...searchFilters, view: view === "all" ? undefined : view }), [searchFilters, view]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "goods-receipts", listFilters), queryFn: () => listGoodsReceipts(listFilters), enabled: !issueView });
  const rows = query.data ?? [];
  const select = (key: keyof typeof filters, label: string, choices: Array<{ value: string; label: string }>) => (
    <Select aria-label={label} size="compact" selectedKey={filters[key]} onSelectionChange={(value) => setFilters((current) => ({ ...current, [key]: String(value) }))}
      options={[{ value: ANY, label }, ...choices]} />
  );
  const columns = useMemo<ColumnDef<GoodsReceiptRow, unknown>[]>(() => [
    { id: "number", header: "GRN", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.receiptNumber}</span> },
    { id: "order", header: "Purchase order", cell: ({ row }) => <span className="tabular-nums">{row.original.purchaseOrderNumber}</span> },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.warehouseName ?? "" },
    { id: "date", header: "Receipt date", cell: ({ row }) => calendarDate(row.original.receiptDate) },
    { id: "arrived", header: "Arrived", cell: ({ row }) => (row.original.physicalReceivedAt ? dateTime(row.original.physicalReceivedAt) : "") },
    { id: "lines", header: "Lines", cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount}</span> },
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex items-center gap-1"><ReceiptStatus status={row.original.status} />
      {row.original.openRejections > 0 && <StatusBadge tone="warning">{`${row.original.openRejections} rejected`}</StatusBadge>}</span> },
    { id: "by", header: "Received by", cell: ({ row }) => row.original.receivedBy ?? "" },
  ], []);
  return (
    <EnterpriseListPage header={{ title: issueView ? "Goods Receipts — Receiving Issues" : "Goods Receipts",
      description: issueView ? "Dock refusals (no goods receipt), shortages and wrong deliveries, goods awaiting Quality and rejections after receipt — each its own case until resolved." : "Goods received against confirmed purchase orders.",
      primaryAction: issueView ? <LinkButton variant="primary" href="/procurement/receiving-issues/new"><Plus className="size-4" aria-hidden="true" />Report Issue</LinkButton>
        : options.data?.capabilities.receive ? <LinkButton variant="primary" href="/procurement/goods-receipts/new"><Plus className="size-4" aria-hidden="true" />New Goods Receipt</LinkButton> : undefined }}
      savedViews={{ views: RECEIPT_LIST_VIEWS, activeViewId: view, onSelect: setView }}
      actionBar={{ start: issueView ? (
        <>
          <SearchField aria-label="Search receiving issues" placeholder="Issue, order, GRN, supplier or lot" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="Custody stage" size="compact" selectedKey={stage} onSelectionChange={(value) => list.setFilter("stage", String(value))}
            options={[{ value: ANY, label: "Any stage" }, { value: "before_custody", label: "Before custody (dock)" }, { value: "after_custody", label: "After custody" }]} />
          <Select aria-label="Reason" size="compact" selectedKey={reason} onSelectionChange={(value) => list.setFilter("reason", String(value))} options={[{ value: ANY, label: "Any reason" }, ...REJECTION_REASON_OPTIONS]} />
        </>
      ) : (
        <>
          <SearchField aria-label="Search receipts" placeholder="GRN, purchase order, supplier or challan" className="w-full sm:w-80" value={search} onChange={setSearch} />
          {select("supplierId", "Any supplier", (options.data?.suppliers ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name })))}
          {select("warehouseId", "Any warehouse", (options.data?.warehouses ?? []).map((warehouse) => ({ value: warehouse.id, label: warehouse.name })))}
          {select("productId", "Any product", (options.data?.products ?? []).map((product) => ({ value: product.id, label: `${product.name} (${product.code})` })))}
          {select("receivedById", "Received by anyone", (options.data?.buyers ?? []).map((user) => ({ value: user.id, label: user.name })))}
          <TextField aria-label="Received from" type="date" size="compact" className="w-40" value={filters.dateFrom} onChange={(value) => setFilters((current) => ({ ...current, dateFrom: value }))} />
          <TextField aria-label="Received to" type="date" size="compact" className="w-40" value={filters.dateTo} onChange={(value) => setFilters((current) => ({ ...current, dateTo: value }))} />
        </>
      ) }}>
      {issueView ? <ReceivingIssuesGrid view={issueView} search={search} stage={stage} reason={reason} /> : <EnterpriseDataGrid<GoodsReceiptRow> aria-label="Goods receipts" columns={columns} data={rows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (Object.keys(searchFilters).length || view !== "all" ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading goods receipts" rows={6} />}
        errorContent={<ErrorState title="Could not load goods receipts" action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No goods receipts yet" description="Choose New Goods Receipt, or open a confirmed purchase order and choose Create Goods Receipt." />}
        noResultsContent={<NoResultsState title="Nothing matches" description="Try a different view, search or filter." />}
        onRowClick={(row) => router.push(`/procurement/goods-receipts/${row.id}`)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.receiptNumber}</span><span className="text-xs text-text-muted">{row.supplierName} · {row.purchaseOrderNumber}</span></div>} />}
    </EnterpriseListPage>
  );
}

type DialogName = "reverse" | "return" | "discrepancy" | "post" | "rejection";
export function GoodsReceiptDetailScreen({ receiptId }: { receiptId: string }) {
  const [tab, setTab] = useTabParam(["overview","items","rejections","billing","returns","movements","notes","history"], "overview");
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "goods-receipt", receiptId), queryFn: () => getGoodsReceipt(receiptId) });
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [releasing, setReleasing] = useState<Disposition | null>(null);
  const changed = (message: string) => { setDialog(null); setReleasing(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); };
  const cancel = useMutation({ mutationFn: () => receiptAction(receiptId, "cancel"), onSuccess: () => changed("The draft receipt is cancelled; nothing moved.") });
  if (query.isLoading) return <LoadingState label="Loading goods receipt" />;
  if (!query.data) return <ErrorState title="Could not load this goods receipt" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const detail = query.data;
  const { receipt, lines, actions } = detail;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/goods-receipts" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"><ArrowLeft className="size-3.5" aria-hidden="true" />All goods receipts</Link>
      {notice && <ProcAlert tone="success">{notice}</ProcAlert>}
      {cancel.error && <ProcAlert>{errorMessage(cancel.error)}</ProcAlert>}
      {receipt.status === "reversed" && <ProcAlert tone="warning">Reversed {dateTime(receipt.reversedAt)}{receipt.reversedByName ? ` by ${receipt.reversedByName}` : ""}: {receipt.reversalReason}. Its stock was taken back out; it no longer counts as received.</ProcAlert>}
      <RecordDetailsPage header={{
        title: receipt.receiptNumber,
        status: <ReceiptStatus status={receipt.status} />,
        fields: [
          { label: "Purchase order", value: <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${receipt.purchaseOrderId}`}>{receipt.purchaseOrderNumber}</Link> },
          { label: "Supplier", value: receipt.supplierName },
          { label: "Warehouse", value: receipt.warehouseName ?? "—" },
          { label: "Received on", value: calendarDate(receipt.receiptDate) },
          { label: "Received by", value: receipt.receivedByName ?? (receipt.status === "draft" ? "Whoever posts it" : "—") },
        ],
        primaryAction: actions.post ? <Button variant="primary" onPress={() => setDialog("post")}>Post receipt</Button>
          : actions.returnGoods ? <LinkButton variant="secondary" href={`/procurement/purchase-returns/new?goodsReceiptId=${receipt.id}`}>Create Purchase Return</LinkButton> : undefined,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            {actions.edit && <LinkButton variant="secondary" href={`/procurement/goods-receipts/${receipt.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
            {actions.cancel && <Button variant="ghost" isLoading={cancel.isPending} onPress={() => cancel.mutate()}>Cancel draft</Button>}
            {actions.createBill && <LinkButton variant="secondary" href={`/procurement/supplier-bills/new?source=grn&goodsReceiptIds=${receipt.id}`}>Create Supplier Bill</LinkButton>}
            {(actions.recordRejection || actions.recordQualityRejection) && <Button variant="ghost" onPress={() => setDialog("rejection")}>Record rejection</Button>}
            {actions.recordDiscrepancy && <Button variant="ghost" onPress={() => setDialog("discrepancy")}>Record discrepancy</Button>}
            {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse</Button>}
            <a className={buttonVariants({ variant: "ghost" })} href={goodsReceiptPdfUrl(receipt.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />{actions.preview ? "Preview" : "Print"}</a>
            <a className={buttonVariants({ variant: "ghost" })} href={goodsReceiptPdfUrl(receipt.id)} download><Download className="size-4" aria-hidden="true" />PDF</a>
          </div>
        ),
      }}>
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Goods receipt sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Received Items &amp; Quality</Tab>
            <Tab id="rejections">Rejections &amp; Discrepancies{detail.rejections.some((entry) => entry.status === "open") ? ` (${detail.rejections.filter((entry) => entry.status === "open").length})` : ""}</Tab>
            <Tab id="movements">Inventory Movements</Tab>
            <Tab id="billing">Supplier Bill Matching</Tab>
            <Tab id="returns">Purchase Returns &amp; Related</Tab>
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-4 pt-4">
              <ProcPanel title="Receipt">
                <ProcFacts columns={3} items={[
                  { label: "Supplier challan", value: [receipt.supplierChallanNumber, receipt.supplierChallanDate && calendarDate(receipt.supplierChallanDate)].filter(Boolean).join(" · ") || "—" },
                  { label: "Goods arrived", value: receipt.physicalReceivedAt ? dateTime(receipt.physicalReceivedAt) : "—" },
                  { label: "Transport", value: [receipt.vehicleNumber && `Vehicle ${receipt.vehicleNumber}`, receipt.carrierName, receipt.trackingReference && `Ref ${receipt.trackingReference}`].filter(Boolean).join(" · ") || "—" },
                  { label: "Ships from", value: receipt.shipFrom ? [receipt.shipFrom.label, receipt.shipFrom.city].filter(Boolean).join(" · ") : "—" },
                  { label: "Company", value: receipt.company ? `${receipt.company.legalName ?? receipt.company.name ?? ""}${receipt.company.gstin ? ` · ${receipt.company.gstin}` : ""}` : "—" },
                  { label: "Created", value: `${dateTime(receipt.createdAt)}${receipt.createdByName ? ` by ${receipt.createdByName}` : ""}` },
                  { label: "Posted", value: receipt.postedAt ? `${dateTime(receipt.postedAt)}${receipt.postedByName ? ` by ${receipt.postedByName}` : ""}` : "Not posted" },
                  ...(receipt.accrual ? [{ label: "GRNI accrual", value: `${receipt.accrual.entryNumber} · ${receipt.currencyCode ?? ""} ${receipt.accrual.amount}${receipt.accrual.reversalEntryNumber ? ` (reversed by ${receipt.accrual.reversalEntryNumber})` : ""}` }] : []),
                ]} />
              </ProcPanel>
              <ProcPanel title="Received">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <span>PO line {line.orderLineNumber}: {line.description}</span>
                      <span className="tabular-nums">{quantity(line.receivedQuantity)} {line.uom.code} received{Number(line.refusedQuantity) > 0 ? ` · ${quantity(line.refusedQuantity)} refused` : ""}</span>
                    </li>
                  ))}
                </ul>
              </ProcPanel>
              {detail.discrepancies.length > 0 && (
                <ProcPanel title="Discrepancies">
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.discrepancies.map((entry) => (
                      <li key={entry.id} className="py-2"><span className="font-medium">{entry.label}</span>{entry.lineNumber ? ` · line ${entry.lineNumber}` : ""}{entry.quantity ? ` · ${quantity(entry.quantity)}` : ""} — {entry.notes}
                        {entry.evidence.length > 0 && <span className="block text-xs">Evidence: {entry.evidence.map((file, index) => (
                          <span key={file.id}>{index > 0 ? ", " : ""}<a className="text-brand hover:underline" href={receiptFileUrl(receipt.id, file.id)}>{file.fileName}</a></span>))}</span>}
                        <span className="block text-xs text-text-muted">{dateTime(entry.at)}{entry.by ? ` by ${entry.by}` : ""}</span></li>
                    ))}
                  </ul>
                </ProcPanel>
              )}
            </div>
          </TabPanel>
          <TabPanel id="items">
            <div className="pt-4">
              <ProcPanel title="Items and disposition" description="Accepted goods are usable stock; held (inspection or damaged) goods sit in the quality location until released or returned; refused goods were not taken in.">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {lines.map((line) => (
                    <li key={line.id} className="flex flex-col gap-1 py-3">
                      <span className="flex flex-wrap justify-between gap-2"><span className="font-medium">PO line {line.orderLineNumber}: {line.product.code ? `${line.product.code} · ` : ""}{line.description}</span>
                        <span className="tabular-nums">{quantity(line.receivedQuantity)} {line.uom.code}{Number(line.conversionFactor) !== 1 ? ` = ${quantity(line.baseQuantity)} in stock units` : ""}</span></span>
                      <span className="text-xs text-text-muted">{[line.warehouseName, line.locationCode, line.batchNumber && `lot ${line.batchNumber}`, line.manufacturedDate && `mfd ${calendarDate(line.manufacturedDate)}`,
                        line.expiryDate && `expires ${calendarDate(line.expiryDate)}`, line.serialNumbers.length ? `S/N ${line.serialNumbers.join(", ")}` : null,
                        line.unitCost !== null && detail.showCost ? `unit price ${line.unitCost}` : null, line.discrepancyNotes].filter(Boolean).join(" · ")}</span>
                      <span className="tabular-nums text-text-secondary">Accepted {quantity(line.acceptedQuantity)} · On hold {quantity(line.inspectionQuantity)} · Damaged {quantity(line.damagedQuantity)}
                        {" "}· Refused at dock {quantity(line.refusedQuantity)}{line.refusalReason ? ` (${line.refusalReason})` : ""} · Returned {quantity(line.returned)} · Net retained {quantity(line.netRetained)}</span>
                      {line.dispositions.map((entry) => (
                        <span key={entry.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusBadge tone={entry.disposition === "damaged" ? "danger" : "warning"}>{entry.disposition === "damaged" ? "Damaged" : "Inspection hold"}</StatusBadge>
                          {quantity(entry.quantity)} held · {quantity(entry.released)} released · {quantity(entry.returned)} returned · {quantity(entry.open)} still held
                          {entry.inspection && <Link className="text-brand hover:underline" href={`/quality/inspection/${entry.inspection.id}`}>Inspection {entry.inspection.number} ({statusLabel(entry.inspection.status)})</Link>}
                          {actions.release && Number(entry.open) > 0 && <Button size="compact" variant="ghost" onPress={() => setReleasing(entry)}>Release to stock</Button>}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="rejections">
            <div className="flex flex-col gap-4 pt-4">
              <ProcPanel title="Rejections" description="Refused at the dock: never received, still owed on the order. Rejected after receipt: received here, then blocked until returned, disposed of or accepted back."
                actions={actions.recordRejection || actions.recordQualityRejection ? <Button size="compact" variant="secondary" onPress={() => setDialog("rejection")}>Record rejection</Button> : undefined}>
                <RejectionTable rows={detail.rejections} empty="Nothing was refused or rejected on this receipt." />
              </ProcPanel>
              <ProcPanel title="Discrepancies" description="What the supplier is told about that is not rejected goods: a shortage that never arrived, a wrong item described, an excess."
                actions={actions.recordDiscrepancy ? <Button size="compact" variant="ghost" onPress={() => setDialog("discrepancy")}>Record discrepancy</Button> : undefined}>
                {!detail.discrepancies.length ? <p className="text-sm text-text-muted">No discrepancies.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.discrepancies.map((entry) => (
                      <li key={entry.id} className="py-2"><span className="font-medium">{entry.label}</span>{entry.lineNumber ? ` · line ${entry.lineNumber}` : ""}{entry.quantity ? ` · ${quantity(entry.quantity)}` : ""} — {entry.notes}
                        <span className="block text-xs text-text-muted">{dateTime(entry.at)}{entry.by ? ` by ${entry.by}` : ""}</span></li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="movements">
            <div className="pt-4">
              <ProcPanel title="Inventory movements" description="Posted by Inventory for this receipt: the receipt itself, releases from hold, returns and any reversal.">
                {detail.reconciliation && (
                  <ProcAlert tone={detail.reconciliation.matched ? "success" : "warning"}>
                    {detail.reconciliation.matched ? "Inventory reconciles with this receipt: every line's stock movements match what it received."
                      : `Inventory does not match: ${detail.reconciliation.lines.filter((line) => !line.matched).map((line) => `line ${line.lineNumber} expected ${quantity(line.expectedBaseQuantity)}, posted ${quantity(line.postedBaseQuantity)}`).join("; ")}.`}
                  </ProcAlert>
                )}
                {!detail.movements.length ? <p className="text-sm text-text-muted">{receipt.status === "draft" ? "A draft moves no stock." : "No stock movements (non-stock goods)."}</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.movements.map((movement) => (
                      <li key={movement.id} className="flex flex-wrap justify-between gap-2 py-2">
                        <span><span className="font-medium tabular-nums">{movement.number}</span> · {statusLabel(movement.type)} · {movement.warehouseName}{movement.locationCode ? ` / ${movement.locationCode}` : ""}
                          <span className="block text-xs text-text-muted">{movement.reason}</span></span>
                        <span className="tabular-nums">{quantity(movement.quantity)}{movement.unitCost !== null ? ` @ ${movement.unitCost}` : ""} · {dateTime(movement.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="billing"><div className="pt-4"><ReceiptBillMatching receiptId={receipt.id} /></div></TabPanel>
          <TabPanel id="returns">
            <div className="pt-4">
              <ProcPanel title="Related documents">
                <ul className="flex flex-col gap-2 text-sm">
                  <li>Purchase order <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${receipt.purchaseOrderId}`}>{receipt.purchaseOrderNumber}</Link> ({statusLabel(receipt.orderStatus)})</li>
                  {detail.returns.map((entry) => (
                    <li key={entry.id}>Return <Link className="text-brand hover:underline" href={`/procurement/purchase-returns/${entry.id}`}>{entry.number}</Link> · {calendarDate(entry.date)} · {entry.reason}
                      {entry.replacementPurchaseOrderId && <> · replacement <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${entry.replacementPurchaseOrderId}`}>{entry.replacementNumber}</Link></>}</li>
                  ))}
                  {[...new Map(detail.billMatching.map((entry) => [entry.billId, entry])).values()].map((entry) => <li key={entry.billId}>Supplier bill {entry.billNumber} ({statusLabel(entry.status)})</li>)}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="notes"><div className="flex flex-col gap-4 pt-4"><ReceiptNotes detail={detail} /></div></TabPanel>
          <TabPanel id="history">
            <div className="pt-4">
              <ProcPanel title="History">
                <ol className="flex flex-col divide-y divide-border text-sm">
                  {detail.history.map((entry) => (
                    <li key={entry.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                      <span className="whitespace-nowrap tabular-nums text-text-muted">{dateTime(entry.at)}</span><span>{entry.summary}{entry.actor ? <span className="text-text-muted"> · {entry.actor}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              </ProcPanel>
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "post" && <PostDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "reverse" && <ReverseDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "discrepancy" && <DiscrepancyDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "rejection" && <ReceiptRejectionDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {releasing && <ReleaseDialog disposition={releasing} onClose={() => setReleasing(null)} onDone={changed} />}
    </div>
  );
}

function ReceiptNotes({ detail }: { detail: GoodsReceiptDetail }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "goods-receipt", detail.receipt.id, "files");
  const files = useQuery({ queryKey: key, queryFn: () => listReceiptFiles(detail.receipt.id) });
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const upload = useMutation({ mutationFn: (file: File) => uploadReceiptFile(detail.receipt.id, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (fileId: string) => removeReceiptFile(detail.receipt.id, fileId), onSuccess: refresh });
  return (
    <>
      <ProcPanel title="Receiving notes"><p className="whitespace-pre-line text-sm">{detail.receipt.notes ?? <span className="text-text-muted">None</span>}</p></ProcPanel>
      <ProcPanel title="Attachments" description="The supplier's challan, packing slips, photos of damaged goods."
        actions={detail.actions.attach ? (
          <>
            <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button>
          </>
        ) : undefined}>
        {(upload.error || remove.error) && <ProcAlert>{errorMessage(upload.error ?? remove.error)}</ProcAlert>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a className="font-medium text-brand hover:underline" href={receiptFileUrl(detail.receipt.id, file.id)}>{file.fileName}</a>
                <span className="flex items-center gap-3 text-text-muted">{dateTime(file.uploadedAt)}
                  {detail.actions.attach && <Button size="compact" variant="ghost" onPress={() => remove.mutate(file.id)}>Remove</Button>}</span>
              </li>
            ))}
          </ul>
        )}
      </ProcPanel>
    </>
  );
}

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

// The preview before posting: what the server will check, and the quantities.
function PostDialog({ detail, onClose, onDone }: { detail: GoodsReceiptDetail; onClose: () => void; onDone: (message: string) => void }) {
  const validation = useQuery({ queryKey: ["procurement", "receipt-validation", detail.receipt.id], queryFn: () => validateGoodsReceipt(detail.receipt.id) });
  const run = useMutation({ mutationFn: () => receiptAction(detail.receipt.id, "post"), onSuccess: () => onDone("Posted: the stock is in.") });
  return (
    <Shell title={`Post ${detail.receipt.receiptNumber}`} error={run.error} onClose={onClose} label="Post receipt" isLoading={run.isPending} isDisabled={!validation.data?.ready} onPress={() => run.mutate()}
      description={`${detail.receipt.supplierName} · ${detail.receipt.purchaseOrderNumber} · ${detail.receipt.warehouseName ?? "no warehouse"}`}>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {detail.lines.map((line) => (
          <li key={line.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{line.description}</span>
            <span className="tabular-nums">{quantity(line.receivedQuantity)} {line.uom.code}{Number(line.heldQuantity) > 0 ? ` (${quantity(line.heldQuantity)} held)` : ""}{Number(line.refusedQuantity) > 0 ? ` · ${quantity(line.refusedQuantity)} refused` : ""}</span></li>
        ))}
      </ul>
      {validation.data && !validation.data.ready && <ProcAlert tone="warning"><ul className="list-disc pl-5">{validation.data.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></ProcAlert>}
    </Shell>
  );
}

function ReverseDialog({ detail, onClose, onDone }: { detail: GoodsReceiptDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const run = useMutation({ mutationFn: () => receiptAction(detail.receipt.id, "reverse", { reason }), onSuccess: () => onDone("Reversed: the stock was taken back out.") });
  return (
    <Shell title={`Reverse ${detail.receipt.receiptNumber}`} error={run.error} onClose={onClose} label="Reverse receipt" isLoading={run.isPending} isDisabled={reason.trim().length < 3} onPress={() => run.mutate()}
      description="Only while nothing has used it: no return, no bill drawing on it, no held goods released, and the stock still where it was received. The receipt and its history stay.">
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

function DiscrepancyDialog({ detail, onClose, onDone }: { detail: GoodsReceiptDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [type, setType] = useState<string | null>(null);
  const [lineId, setLineId] = useState("none");
  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState<string[]>([]);
  const workspace = useWorkspaceContext();
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "goods-receipt", detail.receipt.id, "files"), queryFn: () => listReceiptFiles(detail.receipt.id) });
  const run = useMutation({ mutationFn: () => recordDiscrepancy(detail.receipt.id, { type, goodsReceiptLineId: lineId === "none" ? undefined : lineId, quantity: qty || undefined, notes, evidenceFileIds: evidence }),
    onSuccess: () => onDone("The discrepancy is recorded.") });
  return (
    <Shell title="Record discrepancy" error={run.error} onClose={onClose} label="Record" isLoading={run.isPending} isDisabled={!type || !notes.trim()} onPress={() => run.mutate()}>
      <Select label="Kind" isRequired selectedKey={type} onSelectionChange={(value) => setType(String(value))} options={detail.discrepancyTypes.map((entry) => ({ value: entry.code, label: entry.label }))} />
      <Select label="Line" selectedKey={lineId} onSelectionChange={(value) => setLineId(String(value))}
        options={[{ value: "none", label: "The whole delivery" }, ...detail.lines.map((line) => ({ value: line.id, label: `PO line ${line.orderLineNumber}: ${line.description}` }))]} />
      <TextField label="Quantity" inputMode="decimal" value={qty} onChange={setQty} />
      <TextArea label="Details" isRequired value={notes} onChange={setNotes} />
      {files.data && files.data.length > 0 ? (
        <CheckboxGroup label="Evidence" description="Files attached to this receipt (photos, challan)." value={evidence} onChange={setEvidence}>
          {files.data.map((file) => <Checkbox key={file.id} value={file.id}>{file.fileName}</Checkbox>)}
        </CheckboxGroup>
      ) : <p className="text-xs text-text-muted">Attach photos or the challan under Notes &amp; Attachments to cite them as evidence.</p>}
    </Shell>
  );
}

function ReleaseDialog({ disposition, onClose, onDone }: { disposition: Disposition; onClose: () => void; onDone: (message: string) => void }) {
  const [qty, setQty] = useState(String(Number(disposition.open)));
  const [note, setNote] = useState("");
  const run = useMutation({ mutationFn: () => releaseHeld(disposition.id, { quantity: qty, note }), onSuccess: (result) => onDone(`${quantity(result.released)} released into usable stock.`) });
  return (
    <Shell title={disposition.disposition === "damaged" ? "Release damaged goods" : "Release from inspection"} error={run.error} onClose={onClose} label="Release" isLoading={run.isPending} onPress={() => run.mutate()}
      description="Inventory moves the goods out of the quality location into usable stock. The receipt keeps its quantities.">
      <TextField label={`Quantity (up to ${quantity(disposition.open)})`} inputMode="decimal" value={qty} onChange={setQty} />
      <TextArea label="Inspection note" value={note} onChange={setNote} />
    </Shell>
  );
}

// Supplier Bill Matching of a goods receipt: what each line may be billed for (accepted, released, net of returns and open rejections), what posted
// bills allocated, what drafts hold (not billed until posted) and what is left. One receipt may be billed by several bills, one bill may cover
// several receipts.
function ReceiptBillMatching({ receiptId }: { receiptId: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "receipt-billing", receiptId), queryFn: () => getReceiptBilling(receiptId) });
  if (query.isLoading) return <LoadingState label="Loading bill matching" />;
  if (!query.data) return <ProcAlert>{query.error instanceof Error ? query.error.message : "Could not load bill matching."}</ProcAlert>;
  const billing = query.data;
  return (
    <ProcPanel title="Supplier bill matching" description={billing.note ?? `${billing.matchingPolicy.label}: each bill draws on the receipt lines it bills, so received goods are never billed twice. Eligible follows the order's policy.`}
      actions={billing.canBill ? <Link className="text-sm font-medium text-brand hover:underline" href={`/procurement/supplier-bills/new?source=grn&goodsReceiptIds=${billing.receipt.id}`}>Create Supplier Bill</Link> : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-text-muted">
            {["PO line", "Received", "Held", "Eligible", "Matched to bills", "Drafts", "Remaining"].map((name, index) => <th key={name} className={`py-1 pr-3 font-normal${index ? " text-right" : ""}`}>{name}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {billing.lines.map((line) => (
              <tr key={line.receiptLineId}>
                <td className="py-2 pr-3">{line.lineNumber}. {line.description}</td>
                {[String(Number(line.accepted) + Number(line.held)), line.held, line.billable, line.billed, line.draftBilled, line.remaining].map((value, index) => (
                  <td key={index} className="py-2 pr-3 text-right tabular-nums">{quantity(value)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {billing.bills && billing.bills.length > 0 && (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {billing.bills.map((bill) => (
            <li key={bill.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Link className="font-medium tabular-nums text-brand hover:underline" href={bill.href}>{bill.billNumber}</Link>
              {bill.supplierInvoiceNumber && <span>Invoice {bill.supplierInvoiceNumber}</span>}
              <StatusBadge tone={statusTone(bill.documentStatus)}>{statusLabel(bill.documentStatus)}</StatusBadge>
              {bill.documentStatus === "posted" && <StatusBadge tone={bill.paymentStatus === "paid" ? "success" : "warning"}>{statusLabel(bill.paymentStatus)}</StatusBadge>}
              <span className="tabular-nums text-text-secondary">{quantity(bill.quantity)} from this receipt · {calendarDate(bill.billDate)}</span>
            </li>
          ))}
        </ul>
      )}
    </ProcPanel>
  );
}
