"use client";

// Procurement → Receiving → Rejections: goods that could not be accepted.
// A case is either a refusal at the dock (never received; the order still
// owes it) or a rejection after receipt (the posted receipt stays; the goods
// are blocked until returned, disposed of or accepted back). It is reached
// from the purchase order, the goods receipt and the Quality inspection; it
// resolves through their documents and never changes a bill.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, ErrorState, NoResultsState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs,
  TextArea, TextField,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, dateTime, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";

import {
  REJECTION_REASON_OPTIONS, cancelRejection, errorMessage, getInspectionRejections, getRejection, issuesOf, listRejections, recordDockRejection, recordPostReceiptRejection,
  rejectFromInspection, rejectionFileUrl, resolveRejection, returnRejection, updateRejection, uploadRejectionFile, type GoodsReceiptDetail, type OrderLine, type RejectionDetail,
  type RejectionRow,
} from "../api/purchase-orders-api";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

const ANY = "any";
const EXPECTED_DOCK = [{ value: "replacement_expected", label: "Supplier to send a replacement" }, { value: "cancel_outstanding", label: "Cancel the outstanding quantity" },
  { value: "close_refusal", label: "Close the refusal" }];
const EXPECTED_AFTER = [{ value: "purchase_return", label: "Return to the supplier" }, { value: "disposal", label: "Dispose of the goods" }, { value: "quality_review", label: "Awaiting quality review" }];

function useCan() {
  const workspace = useWorkspaceContext();
  const privileged = workspace.roleSlugs.some((slug) => ["organization_owner", "system_administrator"].includes(slug));
  return (permission: string) => privileged || workspace.permissions.includes(permission);
}

export const RejectionStatus = ({ status }: { status: string }) => <StatusBadge tone={statusTone(status)}>{statusLabel(status)}</StatusBadge>;
const StageBadge = ({ stage }: { stage: string }) => (
  <StatusBadge tone={stage === "before_custody" ? "info" : "warning"}>{stage === "before_custody" ? "Refused at dock" : "After receipt"}</StatusBadge>
);

function Shell({ title, description, error, onClose, label, isLoading, isDisabled, onPress, children }: {
  title: string; description?: string; error: unknown; onClose: () => void; label: string; isLoading: boolean; isDisabled?: boolean; onPress: () => void; children?: React.ReactNode;
}) {
  const issues = issuesOf(error);
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title} description={description} size="lg">
      <div className="flex flex-col gap-3">
        {Boolean(error) && <Notice>{errorMessage(error)}{issues.length > 1 && <ul className="mt-1 list-disc pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</Notice>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Close</Button>
          <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{label}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- list

// Receiving issues — dock refusals (which create no goods receipt), shortages and wrong deliveries, goods awaiting Quality and rejections after
// receipt — as their own cases, shown under Goods Receipts → Receiving Issues. Never rows of goods receipts.
export function ReceivingIssuesGrid({ view, search, stage, reason }: { view: string; search: string; stage: string; reason: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const listFilters = useMemo(() => ({ view, search: search.trim() || undefined, ...(stage !== ANY ? { stage } : {}), ...(reason !== ANY ? { reason } : {}) }), [view, search, stage, reason]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rejections", listFilters), queryFn: () => listRejections(listFilters) });
  const rows = query.data ?? [];
  const columns = useMemo<ColumnDef<RejectionRow, unknown>[]>(() => [
    { id: "number", header: "Issue", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.rejectionNumber}</span> },
    { id: "stage", header: "Custody stage", cell: ({ row }) => <StageBadge stage={row.original.stage} /> },
    { id: "reason", header: "Reason", cell: ({ row }) => row.original.reasonLabel },
    { id: "item", header: "Item", cell: ({ row }) => row.original.description },
    { id: "quantity", header: "Quantity", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.quantity)} {row.original.uom?.code ?? ""}</span> },
    { id: "open", header: "Open", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.open)}</span> },
    { id: "order", header: "Purchase order", cell: ({ row }) => <span className="tabular-nums">{row.original.purchaseOrderNumber}</span> },
    { id: "receipt", header: "GRN", cell: ({ row }) => row.original.receiptNumber ?? "— (refused at the dock)" },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "observed", header: "Found", cell: ({ row }) => dateTime(row.original.observedAt) },
    { id: "status", header: "Status", cell: ({ row }) => <RejectionStatus status={row.original.status} /> },
  ], []);
  return (
    <EnterpriseDataGrid<RejectionRow> aria-label="Receiving issues" columns={columns} data={rows} getRowId={(row) => row.id}
      state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (search || stage !== ANY || reason !== ANY ? "no-results" : "empty") : "ready"}
      loadingContent={<LoadingState label="Loading receiving issues" rows={6} />}
      errorContent={<ErrorState title="Could not load receiving issues" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
      emptyContent={<EmptyState title="No receiving issues" description="Refusals are reported from the purchase order; rejections after receipt from the goods receipt or the Quality inspection." />}
      noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view or filter." />}
      onRowClick={(row) => router.push(`/procurement/receiving-issues/${row.id}`)}
      renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.rejectionNumber} · {row.reasonLabel}</span>
        <span className="text-xs text-text-muted">{row.description} · {quantity(row.quantity)} · {row.purchaseOrderNumber}</span></div>} />
  );
}

// A compact list of cases, for the purchase order and the goods receipt.
export function RejectionTable({ rows, empty }: { rows: RejectionRow[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <Link className="font-medium tabular-nums text-brand hover:underline" href={`/procurement/receiving-issues/${row.id}`}>{row.rejectionNumber}</Link>
            <StageBadge stage={row.stage} /><span>{row.description}</span><span className="text-text-muted">{row.reasonLabel}</span>
            {row.receiptNumber && <span className="text-xs text-text-muted">{row.receiptNumber}</span>}
            {row.billMismatch && <StatusBadge tone="danger">Bill mismatch</StatusBadge>}
          </span>
          <span className="flex items-center gap-2 tabular-nums">{quantity(row.quantity)} {row.uom?.code ?? ""}{row.status === "open" && Number(row.resolved) > 0 ? ` (${quantity(row.open)} open)` : ""}
            <RejectionStatus status={row.status} /></span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- detail

type DetailDialog = "edit" | "cancel" | "resolve" | "return";
export function RejectionDetailScreen({ rejectionId }: { rejectionId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "rejection", rejectionId), queryFn: () => getRejection(rejectionId) });
  const [dialog, setDialog] = useState<DetailDialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const changed = (message: string) => { setDialog(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); };
  if (query.isLoading) return <LoadingState label="Loading rejection" />;
  if (!query.data) return <ErrorState title="Could not load this rejection" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const detail = query.data;
  const { rejection, actions, resolution } = detail;
  const canReturn = resolution.options.some((option) => option.type === "purchase_return_posted" && option.enabled);
  const otherOptions = resolution.options.filter((option) => option.type !== "purchase_return_posted" && option.enabled);
  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="success">{notice}</Notice>}
      {rejection.status === "cancelled" && <Notice tone="warning">Cancelled {dateTime(rejection.cancelledAt)}{rejection.cancelledByName ? ` by ${rejection.cancelledByName}` : ""}: {rejection.cancelReason}</Notice>}
      {detail.financial?.note && <Notice tone="warning">{detail.financial.note}</Notice>}
      <RecordDetailsPage header={{
        title: rejection.rejectionNumber,
        status: <span className="flex gap-2"><RejectionStatus status={rejection.status} /><StageBadge stage={rejection.stage} /></span>,
        fields: [
          { label: "Purchase order", value: <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${rejection.purchaseOrderId}`}>{rejection.purchaseOrderNumber} · line {rejection.orderLineNumber}</Link> },
          { label: "Goods receipt", value: rejection.goodsReceiptId ? <Link className="text-brand hover:underline" href={`/procurement/goods-receipts/${rejection.goodsReceiptId}`}>{rejection.receiptNumber}</Link> : "None (refused before receipt)" },
          { label: "Supplier", value: rejection.supplierName },
          { label: "Quantity", value: `${quantity(rejection.quantity)} ${rejection.uom?.code ?? ""}${rejection.status === "open" ? ` · ${quantity(rejection.open)} open` : ""}` },
          { label: "Reason", value: rejection.reasonLabel },
        ],
        primaryAction: canReturn ? <Button variant="primary" onPress={() => setDialog("return")}>Create Purchase Return</Button>
          : otherOptions.length ? <Button variant="primary" onPress={() => setDialog("resolve")}>Record Resolution</Button> : undefined,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            {canReturn && otherOptions.length > 0 && <Button variant="secondary" onPress={() => setDialog("resolve")}>Record Resolution</Button>}
            {rejection.inspection && <Link className="inline-flex items-center px-3 text-sm text-brand hover:underline" href={`/quality/inspection/${rejection.inspection.id}`}>Open Quality Inspection</Link>}
            {actions.edit && <Button variant="ghost" onPress={() => setDialog("edit")}>Edit</Button>}
            {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel as invalid</Button>}
          </div>
        ),
      }}>
        <Tabs defaultSelectedKey="overview">
          <TabList aria-label="Rejection sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="resolution">Resolution</Tab>
            <Tab id="stock">Stock &amp; Quality</Tab>
            <Tab id="evidence">Evidence</Tab>
            {detail.financial && <Tab id="finance">Supplier Bills</Tab>}
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="What happened">
                <Facts columns={3} items={[
                  { label: "Stage", value: rejection.stageLabel },
                  { label: "Where it came from", value: rejection.sourceLabel },
                  { label: "Product", value: `${rejection.product?.code ? `${rejection.product.code} · ` : ""}${rejection.description}` },
                  { label: "Ordered on the line", value: `${quantity(rejection.orderedQuantity)} ${rejection.uom?.code ?? ""}` },
                  { label: "Presented at the dock", value: rejection.presentedQuantity ? quantity(rejection.presentedQuantity) : "—" },
                  { label: "Received on the GRN line", value: rejection.receiptReceivedQuantity ? quantity(rejection.receiptReceivedQuantity) : "Nothing (not received)" },
                  { label: "Rejected", value: `${quantity(rejection.quantity)} ${rejection.uom?.code ?? ""}${rejection.conversionFactor !== "1.000000" ? ` = ${quantity(rejection.baseQuantity)} in stock units` : ""}` },
                  { label: "Reason", value: [rejection.reasonLabel, ...rejection.reasonTags.map((tag) => tag.label)].join(", ") },
                  { label: "Explanation", value: rejection.explanation ?? "—" },
                  ...(rejection.deliveredProductDescription ? [{ label: "Delivered instead", value: rejection.deliveredProductDescription }] : []),
                  { label: "Expected resolution", value: rejection.expectedResolutionLabel ?? "—" },
                  { label: "Found", value: `${dateTime(rejection.observedAt)}${rejection.reportedBy ? ` by ${rejection.reportedBy}` : ""}` },
                  { label: "Recorded", value: `${dateTime(rejection.createdAt)}${rejection.createdByName ? ` by ${rejection.createdByName}` : ""}` },
                ]} />
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="resolution">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Resolution" description={rejection.stage === "before_custody"
                ? "Refused goods were never received: the order still owes them until a replacement arrives on a normal receipt, or the outstanding quantity is cancelled."
                : "Received goods stay received on the GRN. Blocked goods are returned to the supplier, disposed of with evidence, or exceptionally accepted back."}>
                <Facts columns={4} items={[
                  { label: "Open", value: quantity(rejection.open) }, { label: "Returned", value: quantity(rejection.returned) },
                  { label: "Disposed of", value: quantity(rejection.disposed) }, { label: "Accepted back", value: quantity(rejection.released) },
                ]} />
                {!detail.resolutions.length ? <p className="text-sm text-text-muted">No outcome recorded yet.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.resolutions.map((entry) => (
                      <li key={entry.id} className="py-2"><span className="font-medium">{entry.label}</span> × {quantity(entry.quantity)}
                        {entry.documentNumber && <> · {entry.documentLabel} {entry.documentType === "purchase_return" && entry.documentId
                          ? <Link className="text-brand hover:underline" href={`/procurement/purchase-returns/${entry.documentId}`}>{entry.documentNumber}</Link> : entry.documentNumber}</>} — {entry.notes}
                        <span className="block text-xs text-text-muted">{dateTime(entry.at)}{entry.by ? ` by ${entry.by}` : ""}</span></li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="stock">
            <div className="flex flex-col gap-4 pt-4">
              <Panel title="Where the goods are">
                <Facts columns={3} items={[
                  { label: "Warehouse", value: rejection.warehouseName ?? "—" },
                  { label: "Held in", value: rejection.stage === "before_custody" ? "Not taken in" : rejection.locationCode ?? (Number(rejection.held) > 0 ? "—" : "Not stocked") },
                  { label: "Still blocked", value: quantity(rejection.held) },
                  { label: "Lot", value: rejection.batchNumber ? `${rejection.batchNumber}${rejection.expiryDate ? ` · expires ${calendarDate(rejection.expiryDate)}` : ""}` : "—" },
                  { label: "Serial numbers", value: rejection.serialNumbers.length ? rejection.serialNumbers.join(", ") : "—" },
                  { label: "Quality inspection", value: rejection.inspection
                    ? <Link className="text-brand hover:underline" href={`/quality/inspection/${rejection.inspection.id}`}>{rejection.inspection.number} ({statusLabel(rejection.inspection.status)}, {quantity(rejection.inspection.rejected)} rejected)</Link> : "—" },
                ]} />
              </Panel>
              <Panel title="Inventory movements" description="Posted by Inventory: quarantine, return, disposal or acceptance. A refusal at the dock moves nothing.">
                {!detail.movements.length ? <p className="text-sm text-text-muted">No stock moved for this case.</p> : (
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.movements.map((movement) => (
                      <li key={movement.id} className="flex flex-wrap justify-between gap-2 py-2"><span><span className="font-medium tabular-nums">{movement.number}</span> · {statusLabel(movement.type)} · {movement.warehouseName}{movement.locationCode ? ` / ${movement.locationCode}` : ""}</span>
                        <span className="tabular-nums">{quantity(movement.quantity)} · {dateTime(movement.at)}</span></li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </TabPanel>
          <TabPanel id="evidence"><div className="pt-4"><Evidence detail={detail} /></div></TabPanel>
          {detail.financial && (
            <TabPanel id="finance">
              <div className="pt-4">
                <Panel title="Supplier bills on this line" description="Bills are never changed by a rejection. A posted bill for goods that are not acceptable is corrected by a vendor credit.">
                  <Facts columns={4} items={[
                    { label: "Billing basis", value: statusLabel(detail.financial.billingBasis) }, { label: "Billed (posted)", value: quantity(detail.financial.postedBilled) },
                    { label: "May be billed", value: quantity(detail.financial.billable) }, { label: "Mismatch", value: detail.financial.mismatch ? quantity(detail.financial.mismatch) : "None" },
                  ]} />
                  <ul className="flex flex-col divide-y divide-border text-sm">
                    {detail.financial.bills.map((bill) => (
                      <li key={bill.id} className="flex flex-wrap gap-x-3 py-2"><span className="font-medium">{bill.number}</span>{bill.supplierInvoiceNumber && <span>Invoice {bill.supplierInvoiceNumber}</span>}
                        <StatusBadge tone={statusTone(bill.status)}>{statusLabel(bill.status)}</StatusBadge><span className="tabular-nums">{statusLabel(bill.type)} × {quantity(bill.quantity)}</span></li>
                    ))}
                  </ul>
                </Panel>
              </div>
            </TabPanel>
          )}
          <TabPanel id="history">
            <div className="pt-4">
              <Panel title="History">
                <ol className="flex flex-col divide-y divide-border text-sm">
                  {detail.history.map((entry) => (
                    <li key={entry.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                      <span className="whitespace-nowrap tabular-nums text-text-muted">{dateTime(entry.at)}</span><span>{entry.summary}{entry.actor ? <span className="text-text-muted"> · {entry.actor}</span> : null}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "edit" && <EditDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "cancel" && <CancelDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "resolve" && <ResolveDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "return" && <ReturnDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
    </div>
  );
}

function Evidence({ detail }: { detail: RejectionDetail }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: (file: File) => uploadRejectionFile(detail.rejection.id, file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement", "rejection", detail.rejection.id) }) });
  return (
    <Panel title="Evidence" description="Photos, inspection records and supplier correspondence. Files cited from the goods receipt are listed too; evidence is kept once the case is resolved."
      actions={detail.actions.attach ? (
        <>
          <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
          <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button>
        </>
      ) : undefined}>
      {upload.error && <Notice>{errorMessage(upload.error)}</Notice>}
      {!detail.files.length ? <p className="text-sm text-text-muted">No evidence attached.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {detail.files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <a className="font-medium text-brand hover:underline" href={rejectionFileUrl(detail.rejection.id, file.id)}>{file.fileName}</a>
              <span className="text-text-muted">{file.fromReceipt ? "From the goods receipt · " : ""}{dateTime(file.uploadedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function EditDialog({ detail, onClose, onDone }: { detail: RejectionDetail; onClose: () => void; onDone: (message: string) => void }) {
  const { rejection } = detail;
  const [reason, setReason] = useState(rejection.reason);
  const [description, setDescription] = useState(rejection.explanation ?? "");
  const [expected, setExpected] = useState(rejection.expectedResolution ?? "none");
  const [delivered, setDelivered] = useState(rejection.deliveredProductDescription ?? "");
  const run = useMutation({
    mutationFn: () => updateRejection(rejection.id, { reason, description: description || null, expectedResolution: expected === "none" ? null : expected,
      deliveredProductDescription: delivered || null, expectedUpdatedAt: rejection.updatedAt }),
    onSuccess: () => onDone("Saved."),
  });
  return (
    <Shell title={`Edit ${rejection.rejectionNumber}`} description="Quantities and links are not edited: record, resolve or cancel instead." error={run.error} onClose={onClose} label="Save"
      isLoading={run.isPending} onPress={() => run.mutate()}>
      <Select label="Reason" selectedKey={reason} onSelectionChange={(value) => setReason(String(value))} options={REJECTION_REASON_OPTIONS} />
      <TextArea label="Explanation" isRequired={reason === "other"} value={description} onChange={setDescription} />
      {reason === "wrong_product" && <TextField label="Product delivered instead" value={delivered} onChange={setDelivered} />}
      <Select label="Expected resolution" selectedKey={expected} onSelectionChange={(value) => setExpected(String(value))}
        options={[{ value: "none", label: "Not decided" }, ...(rejection.stage === "before_custody" ? EXPECTED_DOCK : EXPECTED_AFTER)]} />
    </Shell>
  );
}

function CancelDialog({ detail, onClose, onDone }: { detail: RejectionDetail; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const run = useMutation({ mutationFn: () => cancelRejection(detail.rejection.id, reason), onSuccess: () => onDone("Cancelled as invalid. Nothing it pointed at was undone.") });
  return (
    <Shell title={`Cancel ${detail.rejection.rejectionNumber}`} description="Only for a report made in error or twice. Receipts, inspections and stock are not changed." error={run.error}
      onClose={onClose} label="Cancel rejection" isLoading={run.isPending} isDisabled={reason.trim().length < 3} onPress={() => run.mutate()}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

function ResolveDialog({ detail, onClose, onDone }: { detail: RejectionDetail; onClose: () => void; onDone: (message: string) => void }) {
  const options = detail.resolution.options.filter((option) => option.type !== "purchase_return_posted" && option.enabled);
  const [type, setType] = useState(options[0]?.type ?? "");
  const option = options.find((entry) => entry.type === type);
  const [qty, setQty] = useState(String(Number(option?.max ?? detail.resolution.open)));
  const [notes, setNotes] = useState("");
  const [receiptLine, setReceiptLine] = useState(option?.receipts?.[0]?.goodsReceiptLineId ?? "");
  const [serials, setSerials] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const run = useMutation({
    mutationFn: () => resolveRejection(detail.rejection.id, { type, quantity: qty, notes, goodsReceiptLineId: type === "replacement_received" ? receiptLine : undefined,
      serialNumbers: serials || undefined, idempotencyKey: key }),
    onSuccess: () => onDone("Resolution recorded."),
  });
  return (
    <Shell title="Record resolution" description={`${detail.rejection.rejectionNumber}: ${quantity(detail.resolution.open)} still open.`} error={run.error} onClose={onClose} label="Record"
      isLoading={run.isPending} isDisabled={!type || !Number(qty) || notes.trim().length < 3 || (type === "replacement_received" && !receiptLine)} onPress={() => run.mutate()}>
      <Select label="Outcome" selectedKey={type} onSelectionChange={(value) => { const next = options.find((entry) => entry.type === String(value)); setType(String(value));
        setQty(String(Number(next?.max ?? 0))); setReceiptLine(next?.receipts?.[0]?.goodsReceiptLineId ?? ""); }}
        options={options.map((entry) => ({ value: entry.type, label: entry.label }))} />
      {type === "replacement_received" && (
        <Select label="Replacement goods receipt" selectedKey={receiptLine} onSelectionChange={(value) => setReceiptLine(String(value))}
          options={(option?.receipts ?? []).map((entry) => ({ value: entry.goodsReceiptLineId, label: `${entry.receiptNumber} (${quantity(entry.available)} available)` }))} />
      )}
      <TextField label="Quantity" inputMode="decimal" value={qty} onChange={setQty} description={option ? `At most ${quantity(option.max)}.` : undefined} />
      {detail.rejection.serialNumbers.length > 0 && type === "authorized_disposal" && <TextField label="Serial numbers" value={serials} onChange={setSerials} />}
      <TextArea label={type === "quality_accepted" ? "Why the goods are accepted after all" : type === "authorized_disposal" ? "Why they are disposed of rather than returned" : "Notes"} isRequired
        value={notes} onChange={setNotes} />
      {type === "outstanding_qty_cancelled" && <p className="text-xs text-text-muted">The order&apos;s outstanding quantity is cancelled (Supplier cannot supply), linked to this rejection.</p>}
      {type === "authorized_disposal" && <p className="text-xs text-text-muted">Needs evidence attached to the case. Inventory issues the goods out of the quality location.</p>}
    </Shell>
  );
}

function ReturnDialog({ detail, onClose, onDone }: { detail: RejectionDetail; onClose: () => void; onDone: (message: string) => void }) {
  const max = detail.resolution.options.find((option) => option.type === "purchase_return_posted")?.max ?? "0";
  const [qty, setQty] = useState(String(Number(max)));
  const [reason, setReason] = useState(`${detail.rejection.reasonLabel}${detail.rejection.explanation ? `: ${detail.rejection.explanation}` : ""}`);
  const [serials, setSerials] = useState(detail.rejection.serialNumbers.join(", "));
  const [key] = useState(() => crypto.randomUUID());
  const run = useMutation({ mutationFn: () => returnRejection(detail.rejection.id, { quantity: qty, reason, serialNumbers: serials || undefined, idempotencyKey: key }),
    onSuccess: (result) => onDone(`Purchase return ${result.returnNumber} posted: the goods left stock once. A vendor credit corrects anything already billed.`) });
  return (
    <Shell title="Create Purchase Return" description={`From ${detail.rejection.receiptNumber}, for goods rejected on ${detail.rejection.rejectionNumber}.`} error={run.error} onClose={onClose}
      label="Post return" isLoading={run.isPending} isDisabled={!Number(qty) || reason.trim().length < 3} onPress={() => run.mutate()}>
      <TextField label="Quantity" inputMode="decimal" value={qty} onChange={setQty} description={`At most ${quantity(max)}.`} />
      {detail.rejection.serialNumbers.length > 0 && <TextField label="Serial numbers" value={serials} onChange={setSerials} />}
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

// ---------------------------------------------------------------- recording

const BLANK_ROW = { refused: "", presented: "", reason: "damaged_goods", description: "", delivered: "" };

// Goods refused at the dock against a confirmed order, with or without a goods receipt (a whole shipment may be refused).
export function DockRejectionDialog({ orderId, lines, onClose, onDone }: { orderId: string; lines: OrderLine[]; onClose: () => void; onDone: (message: string) => void }) {
  const goods = lines.filter((line) => line.productType !== "service");
  const [rows, setRows] = useState<Record<string, { refused: string; presented: string; reason: string; description: string; delivered: string }>>({});
  const [expected, setExpected] = useState("replacement_expected");
  const [observedAt, setObservedAt] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const set = (id: string, change: Partial<{ refused: string; presented: string; reason: string; description: string; delivered: string }>) =>
    setRows((current) => ({ ...current, [id]: { ...BLANK_ROW, ...current[id], ...change } }));
  const entries = goods.filter((line) => Number(rows[line.id]?.refused) > 0);
  const run = useMutation({
    mutationFn: () => recordDockRejection(orderId, {
      expectedResolution: expected, observedAt: observedAt ? new Date(observedAt).toISOString() : undefined, idempotencyKey: key,
      lines: entries.map((line) => ({ purchaseOrderLineId: line.id, refusedQuantity: rows[line.id].refused, presentedQuantity: rows[line.id].presented || undefined, reason: rows[line.id].reason,
        description: rows[line.id].description || undefined, deliveredProductDescription: rows[line.id].delivered || undefined })),
    }),
    onSuccess: (result) => onDone(`Recorded ${result.cases.map((entry) => entry.rejectionNumber).join(", ")}. Nothing was received; the order still owes the goods.`),
  });
  return (
    <Shell title="Record goods refused at the dock" description="For goods not taken in at all. Goods received and then found unacceptable are rejected from their goods receipt." error={run.error}
      onClose={onClose} label="Record rejection" isLoading={run.isPending} isDisabled={!entries.length} onPress={() => run.mutate()}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select label="Expected resolution" selectedKey={expected} onSelectionChange={(value) => setExpected(String(value))} options={EXPECTED_DOCK} />
        <TextField label="Refused at" type="datetime-local" value={observedAt} onChange={setObservedAt} description="Now if empty." />
      </div>
      {goods.map((line) => {
        const row = rows[line.id] ?? BLANK_ROW;
        return (
          <div key={line.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border p-3">
            <span className="text-sm font-medium">{line.lineNumber}. {line.description} <span className="text-text-muted">· remaining {quantity(line.progress?.remainingToReceive)} {line.uom.code}</span></span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TextField label="Refused" inputMode="decimal" value={row.refused} onChange={(value) => set(line.id, { refused: value })} />
              <TextField label="Presented" inputMode="decimal" value={row.presented} onChange={(value) => set(line.id, { presented: value })} description="If known." />
              <Select label="Reason" selectedKey={row.reason} onSelectionChange={(value) => set(line.id, { reason: String(value) })} options={REJECTION_REASON_OPTIONS} />
            </div>
            {Number(row.refused) > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TextField label="Explanation" isRequired={row.reason === "other"} value={row.description} onChange={(value) => set(line.id, { description: value })} />
                {row.reason === "wrong_product" && <TextField label="Product delivered instead" isRequired value={row.delivered} onChange={(value) => set(line.id, { delivered: value })} />}
              </div>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

// Goods already on a posted receipt and found unacceptable: held goods by Quality's decision, usable goods moved into quarantine.
export function ReceiptRejectionDialog({ detail, onClose, onDone }: { detail: GoodsReceiptDetail; onClose: () => void; onDone: (message: string) => void }) {
  const can = useCan();
  const lines = detail.lines.filter((line) => line.productType !== "service");
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const eligible = detail.rejectable.find((entry) => entry.goodsReceiptLineId === lineId);
  const holds = (eligible?.holds ?? []).filter((hold) => Number(hold.undecided) > 0);
  const canQuality = can("procurement.rejections.quality");
  const [source, setSource] = useState<string>(holds.length && canQuality ? holds[0].dispositionId : "usable");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(source === "usable" ? "defective_product" : "failed_inspection");
  const [description, setDescription] = useState("");
  const [serials, setSerials] = useState("");
  const [expected, setExpected] = useState("purchase_return");
  const [key] = useState(() => crypto.randomUUID());
  const line = lines.find((entry) => entry.id === lineId);
  const hold = holds.find((entry) => entry.dispositionId === source);
  const max = hold ? hold.undecided : eligible?.usable ?? "0";
  const run = useMutation({
    mutationFn: () => recordPostReceiptRejection(lineId, {
      source: hold ? "inspection_hold" : "usable_stock", dispositionId: hold?.dispositionId, quantity: qty, reason, description: description || undefined,
      serialNumbers: serials || undefined, expectedResolution: expected, idempotencyKey: key,
    }),
    onSuccess: (result) => onDone(`${result.rejectionNumber} recorded: the goods are blocked from use. The receipt itself is unchanged.`),
  });
  const inspectionHold = holds.find((entry) => entry.qualityInspectionId);
  const fromInspection = useMutation({ mutationFn: () => rejectFromInspection(inspectionHold!.qualityInspectionId!),
    onSuccess: (result) => onDone(`${result.rejectionNumber} recorded from the inspection's decision.`) });
  return (
    <Shell title="Record rejection after receipt" description="The posted receipt keeps what was received. Rejected goods are blocked until returned, disposed of or accepted back." error={run.error ?? fromInspection.error}
      onClose={onClose} label="Record rejection" isLoading={run.isPending} isDisabled={!Number(qty) || (reason === "other" && description.trim().length < 3)} onPress={() => run.mutate()}>
      <Select label="Receipt line" selectedKey={lineId} onSelectionChange={(value) => { setLineId(String(value)); setSource("usable"); }}
        options={lines.map((entry) => ({ value: entry.id, label: `PO line ${entry.orderLineNumber}: ${entry.description}` }))} />
      <Select label="Which goods" selectedKey={source} onSelectionChange={(value) => { setSource(String(value)); setReason(String(value) === "usable" ? "defective_product" : "failed_inspection"); }}
        options={[{ value: "usable", label: `Usable stock from this receipt (${quantity(eligible?.usable)} eligible)` },
          ...(canQuality ? holds.map((entry) => ({ value: entry.dispositionId, label: `On inspection hold (${quantity(entry.undecided)} undecided)` })) : [])]} />
      {hold?.qualityInspectionId && <p className="text-xs text-text-muted">These goods have a Quality inspection: it must be completed, and no more than it rejected can be recorded.</p>}
      {inspectionHold && canQuality && (
        <Button variant="secondary" size="compact" isLoading={fromInspection.isPending} onPress={() => fromInspection.mutate()}>Record what the inspection rejected</Button>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label={`Quantity (${line?.uom.code ?? ""})`} inputMode="decimal" value={qty} onChange={setQty} description={`At most ${quantity(max)}.`} />
        <Select label="Reason" selectedKey={reason} onSelectionChange={(value) => setReason(String(value))} options={REJECTION_REASON_OPTIONS} />
      </div>
      {source === "usable" && line && line.serialNumbers.length > 0 && <TextField label="Serial numbers rejected" isRequired value={serials} onChange={setSerials} description={`Received: ${line.serialNumbers.join(", ")}`} />}
      <TextArea label="Explanation" isRequired={reason === "other"} value={description} onChange={setDescription} />
      <Select label="Expected resolution" selectedKey={expected} onSelectionChange={(value) => setExpected(String(value))} options={EXPECTED_AFTER} />
    </Shell>
  );
}

// On a Quality inspection of goods held at receipt: its rejection cases, and recording the one its decision calls for. Shown only for such
// inspections, to whoever may see receiving rejections; the Quality page composes it next to the inspection.
export function InspectionRejectionsPanel({ inspectionId }: { inspectionId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const visible = can("procurement.rejections.view") || can("procurement.rejections.view_all");
  const key = scopedQueryKey(workspace, "procurement", "rejections", "inspection", inspectionId);
  const query = useQuery({ queryKey: key, queryFn: () => getInspectionRejections(inspectionId), enabled: visible, retry: false });
  const record = useMutation({ mutationFn: () => rejectFromInspection(inspectionId), onSuccess: () => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }) });
  if (!visible || !query.data?.linked) return null;
  const { rows, decided, canRecord } = query.data;
  return (
    <Panel title="Receiving rejections" description="Goods this inspection rejected stay blocked in the quality location; the case is resolved by a purchase return, a disposal or an exceptional acceptance."
      actions={canRecord ? <Button size="compact" variant="primary" isLoading={record.isPending} onPress={() => record.mutate()}>Record Quality Rejection</Button> : undefined}>
      {record.error && <Notice>{errorMessage(record.error)}</Notice>}
      <RejectionTable rows={rows} empty={decided ? "No rejection recorded for this inspection yet." : "When the inspection fails goods, record the rejection here."} />
    </Panel>
  );
}
