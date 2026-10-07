"use client";

// Procurement → Billing → Supplier Bills. A bill is the supplier's financial claim, recorded as Finance's Accounts Payable
// document; its payment, due and matching states come from Finance's records. From a bill: post it (through Finance's approval policy),
// pay it, apply an advance or credit, correct it with a vendor credit, or reverse it while nothing settled it.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Download, Eye, Pencil, Plus } from "lucide-react";
import {
  Button, Dialog, EmptyState, EnterpriseDataGrid, EnterpriseListPage, ErrorState, LinkButton, NoResultsState, RecordDetailsPage, SearchField, Select, StatusBadge, Tab, TabList, TabPanel, Tabs,
  TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { useListState, useTabParam } from "@/features/procurement/shared/navigation";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { ProcAlert, ProcFacts, ProcPanel } from "@/features/procurement/shared/ProcUi";
import { calendarDate, dateTime, money, quantity, statusLabel } from "@/features/procurement/shared/format";

import {
  billAction, billFileUrl, errorMessage, getBill, getBillOptions, issuesOf, listBillFiles, listBills, removeBillFile, reversePayment, uploadBillFile, validateBill, voucherUrl,
  type BillDetail, type BillRow,
} from "../api/supplier-bills-api";
import { PaymentSchedulePanel } from "./PaymentSchedule";

import { MatchBadge, TwoWayMatching } from "./TwoWayMatching";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const DOC_TONE: Record<string, Tone> = { draft: "neutral", awaiting_approval: "warning", posted: "success", cancelled: "neutral", reversed: "danger" };
const PAY_TONE: Record<string, Tone> = { unpaid: "warning", partially_paid: "info", paid: "success", not_applicable: "neutral" };
const MATCH_TONE: Record<string, Tone> = { matched: "success", mismatch: "danger", accepted_variance: "warning", pending_receipt: "warning", not_applicable: "neutral" };
const LABELS: Record<string, string> = { awaiting_approval: "Awaiting approval", not_applicable: "Not applicable", accepted_variance: "Variance accepted", pending_receipt: "Pending receipt", due_today: "Due today", not_due: "Not due" };
const label = (value: string) => LABELS[value] ?? statusLabel(value);
export const DocStatus = ({ status }: { status: string }) => <StatusBadge tone={DOC_TONE[status] ?? "neutral"}>{label(status)}</StatusBadge>;
const PayStatus = ({ status }: { status: string }) => (status === "not_applicable" ? null : <StatusBadge tone={PAY_TONE[status] ?? "neutral"}>{label(status)}</StatusBadge>);
const MatchStatus = ({ status }: { status: string }) => (status === "not_applicable" ? <span className="text-xs text-text-muted">—</span> : <StatusBadge tone={MATCH_TONE[status] ?? "neutral"}>{label(status)}</StatusBadge>);

// ---------------------------------------------------------------- lists

export function SupplierBillsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  // The view is in the URL (?view=matching-issues, ?source=direct link straight to them); the search and filters are remembered for this browser tab.
  const list = useListState("supplier-bills", { view: "all", filters: { supplierId: "any", source: "any", documentStatus: "any", paymentStatus: "any", due: "any", matchingResult: "any", issue: "any" } });
  const view = list.view.replace(/-/g, "_");
  const setView = (next: string) => list.setView(next.replace(/_/g, "-"));
  const { search, setSearch } = list;
  const { supplierId, ...extra } = list.filters;
  const setSupplierId = (value: string) => list.setFilter("supplierId", value);
  const setFilter = (key: keyof typeof extra) => (value: React.Key | null) => list.setFilter(key, String(value));
  const urlSource = useSearchParams().get("source");
  useEffect(() => { if (urlSource) list.setFilter("source", urlSource === "po" ? "purchase_order" : urlSource); }, [urlSource]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-options"), queryFn: getBillOptions, staleTime: 60_000 });
  const filters = useMemo(() => ({ view: view === "all" ? undefined : view, search: search.trim() || undefined, supplierId: supplierId === "any" ? undefined : supplierId,
    ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== "any")) }), [view, search, supplierId, extra]);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bills", filters), queryFn: () => listBills(filters) });
  const rows = query.data ?? [];
  const columns = useMemo<ColumnDef<BillRow, unknown>[]>(() => [
    { id: "number", header: "Bill", cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.billNumber}</span> },
    { id: "invoice", header: "Supplier invoice", cell: ({ row }) => row.original.supplierInvoiceNumber ?? "—" },
    { id: "supplier", header: "Supplier", cell: ({ row }) => row.original.supplierName },
    { id: "date", header: "Invoice date", cell: ({ row }) => calendarDate(row.original.supplierInvoiceDate) },
    { id: "posting", header: "Posting date", cell: ({ row }) => calendarDate(row.original.postingDate) },
    ...([{ id: "due", header: "Due", cell: ({ row }: { row: { original: BillRow } }) => <span className={row.original.dueStatus === "overdue" ? "text-danger" : ""}>{row.original.dueDate ? calendarDate(row.original.dueDate) : "—"}</span> }]),
    { id: "order", header: "PO", cell: ({ row }) => row.original.purchaseOrderNumber ?? (row.original.sourceType === "direct" ? "Direct" : "—") },
    { id: "total", header: "Total", cell: ({ row }) => <span className="tabular-nums">{money(row.original.currencyCode, row.original.invoiceTotal)}</span> },
    ...([
      { id: "paid", header: "Paid", cell: ({ row }: { row: { original: BillRow } }) => <span className="tabular-nums">{money(row.original.currencyCode, row.original.paid)}</span> },
      { id: "balance", header: "Balance due", cell: ({ row }: { row: { original: BillRow } }) => <span className="font-medium tabular-nums">{money(row.original.currencyCode, row.original.balanceDue)}</span> },
    ]),
    { id: "status", header: "Status", cell: ({ row }) => <span className="flex flex-wrap gap-1"><DocStatus status={row.original.documentStatus} /><PayStatus status={row.original.paymentStatus} /></span> },
    ...([{ id: "matching", header: "Matching", cell: ({ row }: { row: { original: BillRow } }) => (
      <span className="flex flex-col gap-0.5">{row.original.twoWayResult === "not_applicable" ? <span className="text-xs text-text-muted">N/A</span> : <MatchBadge result={row.original.twoWayResult} />}
        {row.original.discrepancy && <span className="text-xs text-danger">{row.original.discrepancy}</span>}
        {row.original.matchingResult === "pending_receipt" && <span className="text-xs text-text-muted">Pending receipt</span>}</span>
    ) }]),
  ], []);
  return (
    <EnterpriseListPage header={{ title: "Supplier Bills",
      description: "What suppliers have charged: posted bills are Accounts Payable; payments and credits settle them.",
      primaryAction: options.data?.capabilities.create ? <LinkButton variant="primary" href="/procurement/supplier-bills/new"><Plus className="size-4" aria-hidden="true" />New Supplier Bill</LinkButton> : undefined }}
      savedViews={{ views: (options.data?.views ?? [{ key: "all", label: "All Bills" }]).map((entry) => ({ id: entry.key, label: entry.label })), activeViewId: view, onSelect: setView }}
      actionBar={{ start: (
        <>
          <SearchField aria-label="Search bills" placeholder="Bill, invoice, supplier, PO, line or category" className="w-full sm:w-80" value={search} onChange={setSearch} />
          <Select aria-label="Supplier" size="compact" selectedKey={supplierId} onSelectionChange={(value) => setSupplierId(String(value))}
            options={[{ value: "any", label: "Any supplier" }, ...(options.data?.suppliers ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name }))]} />
          <Select aria-label="Source" size="compact" selectedKey={extra.source} onSelectionChange={setFilter("source")}
            options={[{ value: "any", label: "Any source" }, { value: "purchase_order", label: "Purchase order" }, { value: "direct", label: "Direct (no PO)" }]} />
          <Select aria-label="Document status" size="compact" selectedKey={extra.documentStatus} onSelectionChange={setFilter("documentStatus")}
            options={[{ value: "any", label: "Any status" }, { value: "draft", label: "Draft" }, { value: "posted", label: "Posted" }, { value: "cancelled", label: "Cancelled" }, { value: "reversed", label: "Reversed" }]} />
          <Select aria-label="Payment status" size="compact" selectedKey={extra.paymentStatus} onSelectionChange={setFilter("paymentStatus")}
            options={[{ value: "any", label: "Any payment" }, { value: "unpaid", label: "Unpaid" }, { value: "partially_paid", label: "Partially paid" }, { value: "paid", label: "Paid" }]} />
          <Select aria-label="Matching result" size="compact" selectedKey={extra.matchingResult} onSelectionChange={setFilter("matchingResult")}
            options={[{ value: "any", label: "Any matching" }, { value: "matched", label: "Matched" }, { value: "mismatch", label: "Mismatch" },
              { value: "approved_exception", label: "Approved exception" }, { value: "not_checked", label: "Not checked" }, { value: "not_applicable", label: "Not applicable" }]} />
          <Select aria-label="Matching issue" size="compact" selectedKey={extra.issue} onSelectionChange={setFilter("issue")}
            options={[{ value: "any", label: "Any issue" }, { value: "missing_grn", label: "Missing GRN" }, { value: "insufficient_received", label: "Insufficient received quantity" },
              { value: "pending_quality", label: "Pending quality acceptance" }, { value: "price_mismatch", label: "Price mismatch" }, { value: "quantity_exceeded", label: "Quantity exceeded" },
              { value: "product_mismatch", label: "Product mismatch" }, { value: "duplicate_invoice", label: "Duplicate invoice" }, { value: "unresolved_variance", label: "Unresolved commercial variance" }]} />
          <Select aria-label="Due status" size="compact" selectedKey={extra.due} onSelectionChange={setFilter("due")}
            options={[{ value: "any", label: "Any due date" }, { value: "not_due", label: "Not due" }, { value: "overdue", label: "Overdue" }]} />
        </>
      ) }}>
      <EnterpriseDataGrid<BillRow> aria-label="Supplier bills" columns={columns} data={rows} getRowId={(row) => row.id}
        state={query.isLoading ? "loading" : query.isError ? "error" : rows.length === 0 ? (search || supplierId !== "any" || view !== "all" || Object.values(extra).some((value) => value !== "any") ? "no-results" : "empty") : "ready"}
        loadingContent={<LoadingState label="Loading bills" rows={6} />}
        errorContent={<ErrorState title="Could not load bills" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />}
        emptyContent={<EmptyState title="No supplier bills yet" description="Record one from a purchase order, a goods receipt, or directly for an expense." />}
        noResultsContent={<NoResultsState title="Nothing in this view" description="Try another view or search." />}
        onRowClick={(row) => router.push(`/procurement/supplier-bills/${row.id}`)}
        renderMobileCard={(row) => <div className="flex flex-col gap-1"><span className="font-medium tabular-nums">{row.billNumber} · {row.supplierName}</span>
          <span className="text-xs text-text-muted">{row.supplierInvoiceNumber} · {money(row.currencyCode, row.balanceDue)} due</span></div>} />
    </EnterpriseListPage>
  );
}

// ---------------------------------------------------------------- detail

function Shell({ title, description, error, onClose, label: action, isLoading, isDisabled, onPress, children }: {
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
          <Button variant="primary" isLoading={isLoading} isDisabled={isDisabled} onPress={onPress}>{action}</Button>
        </div>
      </div>
    </Dialog>
  );
}

type DialogName = "post" | "cancel" | "reverse" | "pay" | "advance" | "credit";
export function SupplierBillDetailScreen({ billId }: { billId: string }) {
  const [tab, setTab] = useTabParam(["overview","items","matching","taxes","payment-schedule","payments","accounting","related","notes","history"], "overview");
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill", billId), queryFn: () => getBill(billId) });
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const approve = useMutation({ mutationFn: () => billAction(billId, "approve"), onSuccess: () => changed("Approved and posted to Accounts Payable.") });
  function changed(message: string) { setDialog(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); }
  if (query.isLoading) return <LoadingState label="Loading supplier bill" />;
  if (!query.data) return <ErrorState title="Could not load this bill" description={errorMessage(query.error)} action={{ label: "Retry", onPress: () => query.refetch() }} />;
  const detail = query.data;
  const { bill, actions } = detail;
  const c = (value: string | null) => money(bill.currencyCode, value);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/procurement/supplier-bills" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />All supplier bills</Link>
      {notice && <ProcAlert tone="success">{notice}</ProcAlert>}
      {approve.error && <ProcAlert>{errorMessage(approve.error)}</ProcAlert>}
      {bill.documentStatus === "reversed" && <ProcAlert tone="warning">Reversed {dateTime(bill.reversedAt)}{bill.reversedByName ? ` by ${bill.reversedByName}` : ""}: {bill.reversalReason}. Its journals were reversed; it no longer counts as billed.</ProcAlert>}
      {bill.documentStatus === "awaiting_approval" && <ProcAlert tone="warning">Awaiting Finance&apos;s approval. Nothing is posted until it is approved.</ProcAlert>}
      {detail.duplicates.length > 0 && <ProcAlert tone="warning">Possible duplicate supplier invoice: {detail.duplicates.map((entry) => `${entry.billNumber} (${label(entry.status)})`).join(", ")}.</ProcAlert>}
      {bill.matchingResult === "mismatch" && <ProcAlert tone="warning">A price differs from the purchase order. Posting is blocked until the bill is corrected, the order amended, or the variance accepted with a reason.</ProcAlert>}
      <RecordDetailsPage header={{
        title: bill.billNumber,
        status: <span className="flex flex-wrap gap-2"><DocStatus status={bill.documentStatus} /><PayStatus status={bill.paymentStatus} /><MatchStatus status={bill.matchingResult} /></span>,
        fields: [
          { label: "Supplier", value: bill.supplierName },
          { label: "Supplier invoice", value: bill.supplierInvoiceNumber ?? "—" },
          { label: "Bill total", value: c(bill.invoiceTotal) },
          { label: "Balance due", value: <span className="font-semibold">{c(bill.balanceDue)}</span> }, { label: "Due date", value: bill.dueDate ? calendarDate(bill.dueDate) : "—" },
        ],
        primaryAction: actions.post ? <Button variant="primary" onPress={() => setDialog("post")}>Validate &amp; Post</Button>
          : actions.approve ? <Button variant="primary" isLoading={approve.isPending} onPress={() => approve.mutate()}>Approve &amp; Post</Button>
            : actions.recordPayment ? <Button variant="primary" onPress={() => setDialog("pay")}>Record Payment</Button> : undefined,
        secondaryActions: (
          <div className="flex flex-wrap gap-2">
            {actions.edit && <LinkButton variant="secondary" href={`/procurement/supplier-bills/${bill.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
            {actions.createCredit && <LinkButton variant="secondary" href={`/procurement/debit-notes-credits/vendor-credits/new?supplierBillId=${bill.id}${bill.supplierId ? `&supplierId=${bill.supplierId}` : ""}`}>Record Vendor Credit</LinkButton>}
            {actions.raiseClaim && <LinkButton variant="ghost" href={`/procurement/debit-notes-credits/claims/new?supplierBillId=${bill.id}${bill.supplierId ? `&supplierId=${bill.supplierId}` : ""}`}>Create Debit Claim</LinkButton>}
            {actions.applyAdvance && <Button variant="ghost" onPress={() => setDialog("advance")}>Apply advance</Button>}
            {actions.applyCredit && <Button variant="ghost" onPress={() => setDialog("credit")}>Apply credit</Button>}
            {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel draft</Button>}
            {actions.reverse && <Button variant="ghost" onPress={() => setDialog("reverse")}>Reverse</Button>}
            <a className={buttonVariants({ variant: "ghost" })} href={voucherUrl(bill.id, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Voucher</a>
            <a className={buttonVariants({ variant: "ghost" })} href={voucherUrl(bill.id)} download><Download className="size-4" aria-hidden="true" />PDF</a>
          </div>
        ),
      }}>
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Supplier bill sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items &amp; Expenses</Tab>
            <Tab id="taxes">Taxes &amp; Withholding</Tab>
            <Tab id="matching">Matching</Tab>
            {detail.paymentSchedule && <Tab id="payment-schedule">Payment Schedule</Tab>}
            <Tab id="payments">Payments &amp; Credits</Tab>
            <Tab id="accounting">Accounting</Tab>
            <Tab id="related">Related Documents</Tab>
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-4 pt-4">
              <ProcPanel title="Supplier invoice">
                <ProcFacts columns={3} items={[
                  { label: "Supplier (as invoiced)", value: `${bill.supplier?.legalName ?? bill.supplierName}${bill.supplier?.supplierNumber ? ` · ${bill.supplier.supplierNumber}` : ""}` },
                  { label: "Supplier GSTIN", value: bill.supplierTaxRegistration?.gstin ?? bill.supplier?.gstin ?? "Unregistered" },
                  { label: "Buying company", value: bill.buyingRegistration ? `${bill.buyingRegistration.legalName ?? bill.buyingRegistration.name ?? ""}${bill.buyingRegistration.gstin ? ` · ${bill.buyingRegistration.gstin}` : ""}` : "—" },
                  { label: "Invoice number", value: bill.supplierInvoiceNumber ?? "—" },
                  { label: "Invoice date", value: calendarDate(bill.supplierInvoiceDate) }, { label: "Posting date", value: calendarDate(bill.postingDate) },
                  { label: "Source", value: bill.sourceLabel ?? "—" }, { label: "Purchase order", value: bill.purchaseOrderId ? <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${bill.purchaseOrderId}`}>{bill.purchaseOrderNumber}</Link> : "—" },
                  { label: "Payment terms", value: bill.paymentTerm?.name ?? "—" },
                  ...(bill.dueDateOverrideReason ? [{ label: "Due date changed", value: `${bill.computedDueDate ? `${calendarDate(bill.computedDueDate)} → ` : ""}${bill.dueDate ? calendarDate(bill.dueDate) : "—"}: ${bill.dueDateOverrideReason}` }] : []), { label: "Place of supply", value: `${bill.placeOfSupply ?? "—"}${bill.supplyNature ? ` (${statusLabel(bill.supplyNature)})` : ""}` },
                  { label: "Currency", value: bill.currencyCode === bill.baseCurrencyCode ? bill.currencyCode : `${bill.currencyCode} @ ${bill.exchangeRate} = ${money(bill.baseCurrencyCode, bill.baseCurrencyTotal)}` },
                  { label: "Created", value: `${dateTime(bill.createdAt)}${bill.createdByName ? ` by ${bill.createdByName}` : ""}` },
                  { label: "Posted", value: bill.postedAt ? `${dateTime(bill.postedAt)}${bill.postedByName ? ` by ${bill.postedByName}` : ""}` : "Not posted" },
                  ...(bill.matchOverrideReason ? [{ label: "Price variance accepted", value: bill.matchOverrideReason }] : []),
                  ...(bill.duplicateOverrideReason ? [{ label: "Duplicate accepted", value: `${bill.duplicateOverrideReason}${bill.duplicateOverrideByName ? ` (${bill.duplicateOverrideByName})` : ""}` }] : []),
                ]} />
              </ProcPanel>
              <Totals detail={detail} />
            </div>
          </TabPanel>
          <TabPanel id="items">
            <div className="pt-4">
              <ProcPanel title="Items">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-text-muted"><th className="py-1 pr-3 font-normal">Item</th><th className="py-1 pr-3 text-right font-normal">Qty</th>
                      <th className="py-1 pr-3 text-right font-normal">Rate</th><th className="py-1 pr-3 text-right font-normal">Discount</th><th className="py-1 pr-3 text-right font-normal">Taxable</th>
                      <th className="py-1 pr-3 text-right font-normal">Tax</th><th className="py-1 text-right font-normal">Total</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {detail.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="py-2 pr-3">{line.description}<span className="block text-xs text-text-muted">{[line.expenseCategory, line.hsnSacCode && `HSN/SAC ${line.hsnSacCode}`, line.account, line.costCenter && `Cost centre ${line.costCenter}`,
                            line.department, line.inputTaxEligibility === "blocked" && "Blocked input tax (in cost)",
                            Number(line.correctedQuantity) > 0 && `${quantity(line.correctedQuantity)} credited`].filter(Boolean).join(" · ")}</span></td>
                          <td className="py-2 pr-3 text-right tabular-nums">{line.billingBasis === "amount" ? "By amount" : `${quantity(line.quantity)} ${line.uom?.code ?? ""}`}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{line.billingBasis === "amount" ? c(line.billedAmount) : c(line.unitPrice)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(String(Number(line.lineDiscount) + Number(line.allocatedDocumentDiscount)))}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{c(line.taxableAmount)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{line.reverseCharge ? <span className="text-xs">RCM {c(line.reverseChargeTax)}</span> : c(line.taxAmount)}</td>
                          <td className="py-2 text-right tabular-nums">{c(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="taxes">
            <div className="flex flex-col gap-4 pt-4">
              <ProcPanel title="Tax components" description="Calculated by the shared tax engine from the supplier's state and the place of supply. Reverse-charge tax is self-assessed by Finance, never owed to the supplier.">
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {detail.lines.flatMap((line) => line.taxes.map((tax, index) => (
                    <li key={`${line.id}-${index}`} className="flex flex-wrap justify-between gap-2 py-2"><span>Line {line.lineNumber}: {tax.label} {Number(tax.rate)}%{tax.classification === "reverse_charge" ? " — reverse charge" : ""}</span>
                      <span className="tabular-nums">{c(tax.taxAmount)} on {c(tax.taxableBase ?? line.taxableAmount)}</span></li>
                  )))}
                  {!detail.lines.some((line) => line.taxes.length) && <li className="py-2 text-text-muted">No tax on this bill.</li>}
                </ul>
              </ProcPanel>
              <ProcPanel title="Withholding (TDS)">
                <ProcFacts columns={3} items={[
                  { label: "Section", value: bill.withholdingSection ? `${bill.withholdingSection.code} · ${bill.withholdingSection.name}` : "None" },
                  { label: "Withheld", value: c(bill.withholdingTotal) }, { label: "Net payable to supplier", value: c(bill.netPayable) },
                ]} />
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="matching">
            <div className="flex flex-col gap-4 pt-4">
              <TwoWayMatching billId={bill.id} currencyCode={bill.currencyCode} editHref={actions.edit ? `/procurement/supplier-bills/${bill.id}/edit` : undefined} />
              {bill.sourceType !== "direct" && <ProcPanel title="Goods receipt allocations" description={bill.sourceType === "direct" ? "A direct expense bill has no order to match." : `Matched against ${bill.matchingBasis === "goods_receipt" ? "goods-receipt allocations" : "the purchase order's commitment"}: each line against its order line (agreed price) and the receipt lines it bills.`}>
                {bill.matchingResult === "pending_receipt" && <ProcAlert tone="warning">Part of this bill is not received (or accepted) yet. It stays a draft until the goods receipt is posted; posting re-checks it.</ProcAlert>}
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {detail.lines.filter((line) => line.purchaseOrderLineId).map((line) => (
                    <li key={line.id} className="flex flex-col gap-1 py-2">
                      <span className="font-medium">Order line {line.orderLineNumber}: {line.description}</span>
                      <span className="tabular-nums text-text-secondary">{line.billingBasis === "amount" ? `Fixed-value service: billed ${c(line.billedAmount)} of its agreed value` : <>Ordered {quantity(line.orderedQuantity)} at {c(line.orderedUnitPrice)} · billed {quantity(line.quantity)} at {c(line.unitPrice)}</>}
                        {Number(line.priceDifference) !== 0 && <span className="text-danger"> · difference {c(line.priceDifference)} a unit ({c(line.variance)} in all)</span>}</span>
                      {line.receipts.length > 0 && <span className="text-xs text-text-muted">Receipts: {line.receipts.map((entry) => `${entry.receiptNumber} × ${quantity(entry.quantity)}`).join(", ")}</span>}
                    </li>
                  ))}
                  {!detail.lines.some((line) => line.purchaseOrderLineId) && <li className="py-2 text-text-muted">Not applicable.</li>}
                </ul>
              </ProcPanel>}
            </div>
          </TabPanel>
          {detail.paymentSchedule && <TabPanel id="payment-schedule"><div className="pt-4"><PaymentSchedulePanel schedule={detail.paymentSchedule} /></div></TabPanel>}
          <TabPanel id="payments"><div className="flex flex-col gap-4 pt-4"><Payments detail={detail} onChanged={changed} /></div></TabPanel>
          <TabPanel id="accounting">
            <div className="flex flex-col gap-4 pt-4">
              {detail.reconciliation && <ProcAlert tone={detail.reconciliation.matched ? "success" : "warning"}>{detail.reconciliation.matched
                ? `Reconciles with Accounts Payable: payable ${c(detail.reconciliation.journalPayable)}, settled ${c(String(Number(detail.reconciliation.paid) + Number(detail.reconciliation.credited)))}, outstanding ${c(detail.reconciliation.outstanding)}.`
                : "The bill does not reconcile with Accounts Payable. Ask Finance to review it."}</ProcAlert>}
              {[["Bill journal", detail.accounting.journal], ["Reverse charge", detail.accounting.reverseCharge], ["Reversal", detail.accounting.reversal]].map(([title, journal]) => journal && typeof journal === "object" ? (
                <ProcPanel key={String(title)} title={`${title}: ${journal.number}`} description={`${statusLabel(journal.status)} · ${calendarDate(journal.date)}`}>
                  <table className="w-full text-sm"><tbody className="divide-y divide-border">
                    {journal.lines.map((line, index) => (
                      <tr key={index}><td className="py-1 pr-3">{line.account}<span className="block text-xs text-text-muted">{line.description}</span></td>
                        <td className="py-1 pr-3 text-right tabular-nums">{Number(line.debit) ? c(line.debit) : ""}</td><td className="py-1 text-right tabular-nums">{Number(line.credit) ? c(line.credit) : ""}</td></tr>
                    ))}
                  </tbody></table>
                </ProcPanel>
              ) : null)}
              {!detail.accounting.journal && <p className="text-sm text-text-muted">Nothing is posted until the bill is posted.</p>}
            </div>
          </TabPanel>
          <TabPanel id="related">
            <div className="pt-4">
              <ProcPanel title="Related documents">
                <ul className="flex flex-col gap-2 text-sm">
                  {detail.related.purchaseOrder && <li>Purchase order <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/${detail.related.purchaseOrder.id}`}>{detail.related.purchaseOrder.number}</Link> ({statusLabel(detail.related.purchaseOrder.status)})</li>}
                  {detail.related.receipts.map((entry) => <li key={entry.id}>Goods receipt <Link className="text-brand hover:underline" href={`/procurement/goods-receipts/${entry.id}`}>{entry.number}</Link></li>)}
                  {detail.related.returns.map((entry) => <li key={entry.id}>Purchase return <Link className="text-brand hover:underline" href={`/procurement/purchase-returns/${entry.id}`}>{entry.number}</Link> · {calendarDate(entry.date)} · {entry.reason}</li>)}
                  {detail.vendorCredits.map((entry) => <li key={entry.id}>Vendor credit <Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link> · {c(entry.total)} ({label(entry.status)})</li>)}
                  {detail.payments.map((entry) => <li key={entry.id}>Payment {entry.paymentNumber} · {c(entry.amount)}{entry.reversed ? " (reversed)" : ""}</li>)}
                </ul>
              </ProcPanel>
            </div>
          </TabPanel>
          <TabPanel id="notes"><div className="flex flex-col gap-4 pt-4"><Files detail={detail} /></div></TabPanel>
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
      {dialog === "cancel" && <ReasonDialog title={`Cancel ${bill.billNumber}`} description="A draft that will not be posted. It never had an accounting effect." label="Cancel draft"
        run={(reason) => billAction(bill.id, "cancel", { reason })} onClose={() => setDialog(null)} onDone={() => changed("Cancelled.")} />}
      {dialog === "reverse" && <ReasonDialog title={`Reverse ${bill.billNumber}`} description="Only while nothing settled it. Finance reverses its journals and tax entries; the bill is kept." label="Reverse bill"
        run={(reason) => billAction(bill.id, "reverse", { reason })} onClose={() => setDialog(null)} onDone={() => changed("Reversed.")} />}
      {dialog === "pay" && <PaymentDialog detail={detail} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "advance" && <ApplyDialog detail={detail} kind="advance" onClose={() => setDialog(null)} onDone={changed} />}
      {dialog === "credit" && <ApplyDialog detail={detail} kind="credit" onClose={() => setDialog(null)} onDone={changed} />}
    </div>
  );
}

function Totals({ detail }: { detail: BillDetail }) {
  const { bill } = detail;
  const c = (value: string | null) => money(bill.currencyCode, value);
  const rows: Array<[string, string | null, boolean?]> = [
    ["Subtotal", bill.subtotal], ["Discounts", `-${bill.discountTotal}`], ["Taxable value", bill.taxableTotal], ["Tax charged", bill.taxTotal],
    ...(Number(bill.reverseChargeTaxTotal) > 0 ? [["Reverse-charge tax (self-assessed)", bill.reverseChargeTaxTotal] as [string, string]] : []),
    ["Invoice total", bill.invoiceTotal, true],
    ...(Number(bill.withholdingTotal) > 0 ? [["TDS withheld", `-${bill.withholdingTotal}`] as [string, string]] : []),
    ...(Number(bill.roundingAdjustment) !== 0 ? [["Rounding", bill.roundingAdjustment] as [string, string]] : []),
    ["Net payable", bill.netPayable, true],
    ...(bill.supplierStatedTotal ? [["Total on the supplier's invoice", bill.supplierStatedTotal] as [string, string]] : []),
    ...(bill.type === "bill" ? [["Paid", bill.paid], ["Credits applied", bill.credited], ["Balance due", bill.balanceDue, true]] as Array<[string, string, boolean?]> : []),
  ];
  return (
    <ProcPanel title="Totals">
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {rows.map(([name, value, strong]) => <Fragment key={name}><dt className={strong ? "font-medium" : "text-text-secondary"}>{name}</dt>
          <dd className={`text-right tabular-nums ${strong ? "font-semibold" : ""}`}>{c(value)}</dd></Fragment>)}
      </dl>
    </ProcPanel>
  );
}

function Payments({ detail, onChanged }: { detail: BillDetail; onChanged: (message: string) => void }) {
  const { bill } = detail;
  const c = (value: string | null) => money(bill.currencyCode, value);
  const [reversing, setReversing] = useState<string | null>(null);
  return (
    <>
      <ProcPanel title="Payments" description="Recorded and posted by Finance. Paid status comes from these, never from a manual choice.">
        {!detail.payments.length ? <p className="text-sm text-text-muted">No payments.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.payments.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><span className="font-medium">{entry.paymentNumber}</span> · {calendarDate(entry.date)} · {statusLabel(entry.method)}{entry.reference ? ` · ${entry.reference}` : ""}{entry.reversed ? " · reversed" : ""}</span>
                <span className="flex items-center gap-2 tabular-nums">{c(entry.amount)}
                  {!entry.reversed && detail.actions.reversePayment && <Button size="compact" variant="ghost" onPress={() => setReversing(entry.paymentId)}>Reverse</Button>}</span>
              </li>
            ))}
          </ul>
        )}
      </ProcPanel>
      <ProcPanel title="Vendor credits" description="Credits applied to this bill, and the vendor credits that corrected it (applied here or elsewhere).">
        {!detail.credits.length && !detail.vendorCredits.length ? <p className="text-sm text-text-muted">None.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.credits.map((entry, index) => <li key={index} className="flex justify-between py-2"><span>Applied from <Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link></span><span className="tabular-nums">{c(entry.amount)}</span></li>)}
            {detail.vendorCredits.map((entry) => <li key={entry.id} className="flex justify-between py-2"><span>Vendor credit <Link className="text-brand hover:underline" href={entry.href}>{entry.number}</Link> ({label(entry.status)})</span>
              <span className="tabular-nums">{c(entry.total)}{Number(entry.unapplied) > 0 ? ` · ${c(entry.unapplied)} unapplied credit` : ""}</span></li>)}
          </ul>
        )}
      </ProcPanel>
      {reversing && <ReasonDialog title="Reverse payment" description="A payment that did not happen (bounced, entered in error). Finance reverses it; the bill is owed again." label="Reverse payment"
        run={(reason) => reversePayment(reversing, reason)} onClose={() => setReversing(null)} onDone={() => { setReversing(null); onChanged("Payment reversed."); }} />}
    </>
  );
}

function Files({ detail }: { detail: BillDetail }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "bill", detail.bill.id, "files");
  const files = useQuery({ queryKey: key, queryFn: () => listBillFiles(detail.bill.id) });
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const upload = useMutation({ mutationFn: (file: File) => uploadBillFile(detail.bill.id, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (fileId: string) => removeBillFile(detail.bill.id, fileId), onSuccess: refresh });
  return (
    <>
      <ProcPanel title="Notes"><p className="whitespace-pre-line text-sm">{detail.bill.notes ?? <span className="text-text-muted">None</span>}</p></ProcPanel>
      <ProcPanel title="Original invoice and attachments" description="The supplier's own tax invoice (PDF or image) is the source document; compare it with the bill before posting."
        actions={detail.actions.attach ? (
          <>
            <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button>
          </>
        ) : undefined}>
        {(upload.error || remove.error) && <ProcAlert>{errorMessage(upload.error ?? remove.error)}</ProcAlert>}
        {!files.data?.length ? <p className="text-sm text-text-muted">No files. Attach the supplier&apos;s invoice.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex gap-3"><a className="font-medium text-brand hover:underline" href={billFileUrl(detail.bill.id, file.id, true)} target="_blank" rel="noreferrer">{file.fileName}</a>
                  <a className="text-text-muted hover:underline" href={billFileUrl(detail.bill.id, file.id)}>Download</a></span>
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

function ReasonDialog({ title, description, label: action, run, onClose, onDone }: { title: string; description: string; label: string; run: (reason: string) => Promise<unknown>; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => run(reason), onSuccess: onDone });
  return (
    <Shell title={title} description={description} error={mutation.error} onClose={onClose} label={action} isLoading={mutation.isPending} isDisabled={reason.trim().length < 3} onPress={() => mutation.mutate()}>
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </Shell>
  );
}

// Validation first: what blocks posting, possible duplicates (accepted only with permission and a reason).
function PostDialog({ detail, onClose, onDone }: { detail: BillDetail; onClose: () => void; onDone: (message: string) => void }) {
  const validation = useQuery({ queryKey: ["procurement", "bill-validation", detail.bill.id], queryFn: () => validateBill(detail.bill.id) });
  const [override, setOverride] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const duplicate = validation.data?.issues.find((issue) => issue.startsWith("Supplier invoice "));
  const blocking = (validation.data?.issues ?? []).filter((issue) => issue !== duplicate);
  const run = useMutation({ mutationFn: () => billAction(detail.bill.id, "post", { duplicateOverrideReason: override || undefined, idempotencyKey: key }),
    onSuccess: (result) => onDone(result.status === "awaiting_approval" ? "Submitted: awaiting Finance's approval before it is posted." : "Posted to Accounts Payable.") });
  return (
    <Shell title={`Post ${detail.bill.billNumber}`} description={`${detail.bill.supplierName} · invoice ${detail.bill.supplierInvoiceNumber ?? "—"} · ${money(detail.bill.currencyCode, detail.bill.invoiceTotal)}`}
      error={run.error} onClose={onClose} label="Post bill" isLoading={run.isPending}
      isDisabled={!validation.data || blocking.length > 0 || (Boolean(duplicate) && (!detail.actions.overrideDuplicate || override.trim().length < 10))} onPress={() => run.mutate()}>
      {validation.isLoading && <p className="text-sm text-text-muted">Checking the bill…</p>}
      {blocking.length > 0 && <ProcAlert><ul className="list-disc pl-5">{blocking.map((issue) => <li key={issue}>{issue}</li>)}</ul></ProcAlert>}
      {validation.data?.warnings.map((warning) => <ProcAlert key={warning} tone="warning">{warning}</ProcAlert>)}
      {duplicate && (
        <ProcAlert tone="warning">{duplicate}{detail.actions.overrideDuplicate ? " If it is genuinely a different invoice, explain why." : " Only Finance can accept a duplicate."}</ProcAlert>
      )}
      {duplicate && detail.actions.overrideDuplicate && <TextArea label="Why this is not a duplicate" value={override} onChange={setOverride} />}
      {validation.data?.ready && <p className="text-sm text-text-secondary">Ready. Posting records the payable{Number(detail.bill.taxTotal) > 0 ? ", input tax" : ""}{Number(detail.bill.withholdingTotal) > 0 ? ", TDS" : ""} through Finance; it never pays the supplier.</p>}
    </Shell>
  );
}

function PaymentDialog({ detail, onClose, onDone }: { detail: BillDetail; onClose: () => void; onDone: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "bill-options"), queryFn: getBillOptions, staleTime: 60_000 });
  const [amount, setAmount] = useState(String(Number(detail.bill.balanceDue)));
  const [method, setMethod] = useState("bank_transfer");
  const [bank, setBank] = useState("none");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const run = useMutation({ mutationFn: () => billAction(detail.bill.id, "payments", { amount, paymentMethod: method, bankAccountId: bank === "none" ? undefined : bank, reference: reference || undefined,
    paymentDate: date || undefined, idempotencyKey: key }), onSuccess: (result) => onDone(result.status === "awaiting_approval" ? `Payment ${result.paymentNumber} awaits Finance's approval.` : `Payment ${result.paymentNumber} recorded.`) });
  return (
    <Shell title="Record Payment" description={`${detail.bill.billNumber}: ${money(detail.bill.currencyCode, detail.bill.balanceDue)} due. Recorded through Finance's supplier payments.`} error={run.error}
      onClose={onClose} label="Record payment" isLoading={run.isPending} isDisabled={!Number(amount)} onPress={() => run.mutate()}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label="Amount" inputMode="decimal" value={amount} onChange={setAmount} />
        <TextField label="Payment date" type="date" value={date} onChange={setDate} description="Today if empty." />
        <Select label="Method" selectedKey={method} onSelectionChange={(value) => setMethod(String(value))}
          options={[["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["upi", "UPI"], ["cash", "Cash"], ["card", "Card"], ["other", "Other"]].map(([value, text]) => ({ value, label: text }))} />
        <Select label="Paid from" selectedKey={bank} onSelectionChange={(value) => setBank(String(value))}
          options={[{ value: "none", label: "Default bank account" }, ...(options.data?.bankAccounts ?? []).map((entry) => ({ value: entry.id, label: entry.name }))]} />
        <TextField label="Reference (UTR, cheque no.)" value={reference} onChange={setReference} />
      </div>
    </Shell>
  );
}

function ApplyDialog({ detail, kind, onClose, onDone }: { detail: BillDetail; kind: "advance" | "credit"; onClose: () => void; onDone: (message: string) => void }) {
  const choices = kind === "advance" ? detail.settlementOptions.advances.map((entry) => ({ value: entry.id, label: `${entry.number} · ${money(detail.bill.currencyCode, entry.available)} available` }))
    : detail.settlementOptions.credits.map((entry) => ({ value: entry.id, label: `${entry.number} · ${money(detail.bill.currencyCode, entry.available)} available` }));
  const [choice, setChoice] = useState(choices[0]?.value ?? "");
  const [amount, setAmount] = useState("");
  const run = useMutation({ mutationFn: () => billAction(detail.bill.id, kind, kind === "advance" ? { paymentId: choice, amount: amount || undefined } : { creditId: choice, amount: amount || undefined }),
    onSuccess: () => onDone(kind === "advance" ? "Advance applied." : "Credit applied.") });
  return (
    <Shell title={kind === "advance" ? "Apply supplier advance" : "Apply supplier credit"} error={run.error} onClose={onClose} label="Apply" isLoading={run.isPending} isDisabled={!choice} onPress={() => run.mutate()}>
      <Select label={kind === "advance" ? "Advance" : "Credit"} selectedKey={choice} onSelectionChange={(value) => setChoice(String(value))} options={choices} />
      <TextField label="Amount" inputMode="decimal" value={amount} onChange={setAmount} description="All that is available, up to the balance due, if empty." />
    </Shell>
  );
}
