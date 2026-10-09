"use client";

// One purchase order: what was agreed (and in which confirmed version), and
// where it stands — received, billed and paid, each from its own documents.
// The actions offered are the ones the server says are possible now.
import { useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Pencil, Send, Truck } from "lucide-react";
import {
  Button, Dialog, ErrorState, LinkButton, MetricStrip, PermissionState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField, buttonVariants,
} from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { RelatedDocuments } from "@/shared/related/RelatedDocuments";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { calendarDate, dateTime, money, quantity, statusLabel, statusTone } from "@/features/procurement/shared/format";

import {
  errorCode, errorMessage, getPurchaseOrder, getPurchaseOrderOptions, listOrderFiles, orderAction, orderFileUrl, purchaseOrderPdfUrl, removeOrderFile, uploadOrderFile, type Address, type OrderLine,
  type PurchaseOrderDetail, type PurchaseOrderOptions,
} from "../api/purchase-orders-api";
import { BillingBadge, CommunicationBadge, LifecycleBadge, OverdueBadge, PaymentBadge, ReceiptBadge } from "../components/PurchaseOrderBadges";
import {
  AcknowledgeDialog, AmendDialog, CancelDialog, CancelRemainingDialog, CloseDialog, ConfirmDialog, ExpectedDatesDialog, MarkSentDialog, SendDialog,
} from "../components/PurchaseOrderDialogs";
import { DockRejectionDialog, RejectionTable } from "./RejectionScreens";
import { getOrderBilling } from "@/features/procurement/supplier-bills/api/supplier-bills-api";
import { MatchBadge } from "@/features/procurement/supplier-bills/screens/TwoWayMatching";
import { useTabParam } from "@/features/procurement/shared/navigation";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

type DialogName = "confirm" | "amend" | "cancel" | "cancelRemaining" | "close" | "send" | "markSent" | "acknowledge" | "dates" | "rejection";
const addressText = (address: Address | null | undefined) =>
  address ? [address.label, address.line1, address.line2, [address.city, address.stateName ?? address.state, address.postalCode].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : "—";

const ORDER_TABS = ["overview", "items", "receipts", "rejections", "bills", "returns-credits", "related", "notes", "history"] as const;

export function PurchaseOrderDetailScreen({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "purchase-order", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => getPurchaseOrder(orderId) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "po-options"), queryFn: getPurchaseOrderOptions, staleTime: 60_000 });
  const [notice, setNotice] = useState<string | null>(null);
  const changed = (message: string) => {
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") });
  };
  if (query.isLoading || optionsQuery.isLoading) return <LoadingState label="Loading purchase order" />;
  if (query.isError || !query.data) {
    if (errorCode(query.error) === "PERMISSION_DENIED") return <PermissionState title="You don't have access to purchase orders" />;
    return <ErrorState title={errorCode(query.error) === "PURCHASE_ORDER_NOT_FOUND" ? "Purchase order not found" : "Could not load this purchase order"} description={errorMessage(query.error)}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }
  if (!optionsQuery.data) return <ErrorState title="Could not load this purchase order" action={{ label: "Retry", onPress: () => optionsQuery.refetch() }} />;
  return <Detail detail={query.data} options={optionsQuery.data} notice={notice} onChanged={changed} />;
}

function Detail({ detail, options, notice, onChanged }: { detail: PurchaseOrderDetail; options: PurchaseOrderOptions; notice: string | null; onChanged: (message: string) => void }) {
  const { order, tracking, actions } = detail;
  const [tab, setTab] = useTabParam(ORDER_TABS, "overview");
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const done = (message: string) => { setDialog(null); onChanged(message); };
  const executing = order.status !== "draft";
  const props = { detail, options, onClose: () => setDialog(null), onDone: done };
  const currency = order.currencyCode;

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="success">{notice}</Notice>}
      {order.amending && <Notice tone="warning">Being amended: {order.amendmentReason}. Version {order.versionNumber} stays in force until the amendment is confirmed.</Notice>}
      {order.status === "cancelled" && <Notice tone="warning">Cancelled{order.cancelledAt ? ` on ${dateTime(order.cancelledAt)}` : ""}{order.cancelledByName ? ` by ${order.cancelledByName}` : ""}: {options.cancelReasons.find((entry) => entry.code === order.cancelReasonCode)?.label ?? order.cancelReasonCode}{order.cancelReason ? ` (${order.cancelReason})` : ""}.</Notice>}
      {order.status === "closed" && <Notice tone="success">Closed{order.closedAt ? ` on ${dateTime(order.closedAt)}` : ""}{order.closedByName ? ` by ${order.closedByName}` : ""}. {tracking.payment !== "paid" && tracking.payment !== "no_payable" ? "Payment of its bills is with Finance." : ""}</Notice>}
      <RecordDetailsPage
        header={{
          title: `${order.purchaseOrderNumber}${order.versionNumber > 1 ? ` · version ${order.versionNumber}` : ""}`,
          status: (
            <span className="flex flex-wrap items-center gap-1.5">
              <LifecycleBadge status={order.status} amending={order.amending} />
              {executing && order.status !== "cancelled" && <CommunicationBadge status={order.communicationStatus} />}
              {executing && order.status !== "cancelled" && <ReceiptBadge status={tracking.receipt} />}
              {executing && order.status !== "cancelled" && <BillingBadge status={tracking.billing} />}
              {executing && order.status !== "cancelled" && <PaymentBadge status={tracking.payment} />}
              {tracking.overdueReceipt && <OverdueBadge />}
            </span>
          ),
          fields: [
            { label: "Supplier", value: <Link className="text-brand hover:underline" href={`/procurement/suppliers/${order.supplierId}`}>{order.supplier?.supplierName ?? order.supplierName}</Link> },
            { label: "Order date", value: calendarDate(order.orderDate) },
            { label: "Expected delivery", value: order.expectedDeliveryDate ? calendarDate(order.expectedDeliveryDate) : "—" },
            { label: "Total", value: money(currency, order.grandTotal) },
            { label: "Buyer", value: order.buyerName ?? "—" },
          ],
          primaryAction: actions.confirm ? <Button variant="primary" onPress={() => setDialog("confirm")}>{order.amending ? `Confirm version ${order.versionNumber + 1}` : "Confirm"}</Button>
            : actions.receive ? <LinkButton variant="primary" href={`/procurement/goods-receipts/new?purchaseOrderId=${order.id}`}><Truck className="size-4" aria-hidden="true" />Create Goods Receipt</LinkButton>
              : actions.bill ? <LinkButton variant="primary" href={`/procurement/supplier-bills/new?source=po&purchaseOrderId=${order.id}`}>Record supplier bill</LinkButton>
                : actions.close ? <Button variant="primary" onPress={() => setDialog("close")}>Close order</Button> : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <LinkButton variant="secondary" href={`/procurement/purchase-orders/${order.id}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
              {actions.bill && (actions.receive || actions.close) && <LinkButton variant="secondary" href={`/procurement/supplier-bills/new?source=po&purchaseOrderId=${order.id}`}>Record supplier bill</LinkButton>}
              {actions.close && (actions.receive || actions.bill) && <Button variant="secondary" onPress={() => setDialog("close")}>Close order</Button>}
              {actions.send && <Button variant="secondary" onPress={() => setDialog("send")}><Send className="size-4" aria-hidden="true" />Send</Button>}
              {actions.send && <Button variant="ghost" onPress={() => setDialog("markSent")}>Mark sent</Button>}
              {actions.acknowledge && <Button variant="ghost" onPress={() => setDialog("acknowledge")}>Acknowledged</Button>}
              <a className={buttonVariants({ variant: "ghost" })} href={purchaseOrderPdfUrl(order.id, { inline: true })} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />Print</a>
              <a className={buttonVariants({ variant: "ghost" })} href={purchaseOrderPdfUrl(order.id)} download><Download className="size-4" aria-hidden="true" />PDF</a>
              {actions.recordRejection && <Button variant="ghost" onPress={() => setDialog("rejection")}>Record rejection</Button>}
              {actions.updateDates && <Button variant="ghost" onPress={() => setDialog("dates")}>Update dates</Button>}
              {actions.amend && <Button variant="ghost" onPress={() => setDialog("amend")}>Amend</Button>}
              {actions.cancelRemaining && <Button variant="ghost" onPress={() => setDialog("cancelRemaining")}>Cancel remaining</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel order</Button>}
            </div>
          ),
        }}
      >
        <Tabs selectedKey={tab} onSelectionChange={(value) => setTab(String(value))}>
          <TabList aria-label="Purchase order sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items</Tab>
            <Tab id="receipts">Receipts</Tab>
            {detail.rejections && <Tab id="rejections">Rejections &amp; Discrepancies{detail.rejections.summary.open ? ` (${detail.rejections.summary.open})` : ""}</Tab>}
            <Tab id="bills">Supplier Bills</Tab>
            <Tab id="returns-credits">Returns &amp; Credits</Tab>
            <Tab id="related">Related</Tab>
            <Tab id="notes">Notes &amp; Attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><div className="flex flex-col gap-4 pt-4"><Overview detail={detail} /><Related detail={detail} /></div></TabPanel>
          <TabPanel id="items"><div className="pt-4"><Items detail={detail} /></div></TabPanel>
          <TabPanel id="receipts"><div className="flex flex-col gap-4 pt-4"><Receipts detail={detail} /></div></TabPanel>
          {detail.rejections && <TabPanel id="rejections"><div className="flex flex-col gap-4 pt-4"><Rejections detail={detail} onRecord={() => setDialog("rejection")} /></div></TabPanel>}
          <TabPanel id="bills"><div className="pt-4"><Bills detail={detail} /></div></TabPanel>
          <TabPanel id="returns-credits"><div className="pt-4"><Returns detail={detail} /></div></TabPanel>
          <TabPanel id="notes"><div className="flex flex-col gap-4 pt-4"><Notes detail={detail} onChanged={onChanged} /></div></TabPanel>
          <TabPanel id="related"><div className="pt-4"><RelatedDocuments type="purchase_order" id={detail.order.id} /></div></TabPanel>
          <TabPanel id="history"><div className="pt-4"><History detail={detail} /></div></TabPanel>
        </Tabs>
      </RecordDetailsPage>
      {dialog === "confirm" && <ConfirmDialog {...props} />}
      {dialog === "amend" && <AmendDialog {...props} />}
      {dialog === "cancel" && <CancelDialog {...props} />}
      {dialog === "cancelRemaining" && <CancelRemainingDialog {...props} />}
      {dialog === "close" && <CloseDialog {...props} />}
      {dialog === "send" && <SendDialog {...props} />}
      {dialog === "markSent" && <MarkSentDialog {...props} />}
      {dialog === "acknowledge" && <AcknowledgeDialog {...props} />}
      {dialog === "dates" && <ExpectedDatesDialog {...props} />}
      {dialog === "rejection" && <DockRejectionDialog orderId={detail.order.id} lines={detail.lines} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

function Overview({ detail }: { detail: PurchaseOrderDetail }) {
  const { order, tracking } = detail;
  const currency = order.currencyCode;
  const sum = (key: "ordered" | "received" | "billed" | "cancelled" | "remainingToReceive" | "remainingToBill") =>
    tracking.lines.reduce((total, line) => total + Number(line[key]), 0);
  return (
    <>
      {order.status !== "draft" && order.status !== "cancelled" && (
        <MetricStrip metrics={[
          { label: "Ordered", value: quantity(sum("ordered")) },
          { label: "Received", value: quantity(sum("received")) },
          { label: "Still to receive", value: quantity(sum("remainingToReceive")) },
          { label: "Billed", value: quantity(sum("billed")) },
          { label: "Still to bill", value: quantity(sum("remainingToBill")) },
          { label: "Cancelled", value: quantity(sum("cancelled")) },
        ]} />
      )}
      {tracking.closureBlockers.length > 0 && order.status === "confirmed" && (
        <Panel title="Before it can be closed" description="Closing needs nothing left to receive or bill.">
          <ul className="list-disc pl-5 text-sm text-text-secondary">{tracking.closureBlockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </Panel>
      )}
      <Panel title="Commercial summary" description="As agreed with the supplier. Confirmed versions keep these values even if the supplier, products or tax rates change later.">
        <Facts columns={3} items={[
          { label: "Subtotal", value: money(currency, order.grossTotal) },
          { label: "Discounts", value: money(currency, Number(order.lineDiscountTotal) + Number(order.documentDiscountAmount)) },
          { label: "Taxable value", value: money(currency, order.taxableTotal) },
          { label: "Tax", value: money(currency, order.taxTotal) },
          { label: "Total", value: money(currency, order.grandTotal) },
          { label: "Prices", value: order.priceMode === "inclusive" ? "Inclusive of tax" : "Exclusive of tax" },
          { label: "Payment terms", value: detail.paymentTerms?.paymentTerm ? `${detail.paymentTerms.paymentTerm.name}${detail.paymentTerms.advance ? ` · ${detail.paymentTerms.advance.percentage}% advance` : ""}` : order.paymentTerm?.name ?? "—" },
          { label: "Supplier reference", value: order.supplierReference ?? "—" },
          { label: "Supplier quotation", value: order.sourceQuotationId ? <Link className="text-brand hover:underline" href={`/procurement/purchase-orders/quotations/${order.sourceQuotationId}`}>{order.sourceQuotationNumber}</Link> : order.supplierQuotationReference ?? "—" },
        ]} />
      </Panel>
      <Panel title="Supplier">
        <Facts columns={2} items={[
          { label: "Supplier", value: `${order.supplier?.supplierName ?? order.supplierName} · ${order.supplierNumber}` },
          { label: "GST registration", value: order.supplierTaxRegistration?.gstin ? `${order.supplierTaxRegistration.gstin}${order.supplierTaxRegistration.stateName ? ` · ${order.supplierTaxRegistration.stateName}` : ""}` : "Unregistered" },
          { label: "Contact", value: order.contact ? [order.contact.name, order.contact.email, order.contact.phone].filter(Boolean).join(" · ") : "—" },
          { label: "Ordering address", value: addressText(order.orderingAddress) },
          { label: "Billing address", value: addressText(order.billingAddress) },
          { label: "Ships from", value: addressText(order.shipFrom) },
        ]} />
      </Panel>
      <Panel title="Buying company and delivery">
        <Facts columns={2} items={[
          { label: "Placed from", value: order.buyerRegistration ? `${order.buyerRegistration.legalName ?? order.buyerRegistration.name ?? ""}${order.buyerRegistration.gstin ? ` · GSTIN ${order.buyerRegistration.gstin}` : ""}` : "—" },
          { label: "Bill to", value: order.billTo ? [order.billTo.name, order.billTo.line1].filter(Boolean).join(" · ") : "—" },
          { label: "Ship to", value: order.shipTo ? addressText(order.shipTo) : "Company address" },
          { label: "Receiving warehouse", value: order.defaultWarehouseName ?? "—" },
        ]} />
      </Panel>
      {detail.confirmations.length > 0 && (
        <Panel title="Confirmed versions" description="Each confirmation is kept exactly as it was authorised.">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.confirmations.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>Version {entry.version} · {money(currency, entry.grandTotal)} · {dateTime(entry.confirmedAt)}{entry.confirmedBy ? ` by ${entry.confirmedBy}` : ""}
                  {entry.amendmentReason && <span className="block text-xs text-text-muted">Amendment: {entry.amendmentReason}</span>}</span>
                <span className="flex items-center gap-2">{entry.current ? <StatusBadge tone="info">Current</StatusBadge> : <StatusBadge tone="neutral">Superseded</StatusBadge>}
                  <a className="text-brand hover:underline" href={purchaseOrderPdfUrl(detail.order.id, { version: entry.version, inline: true })} target="_blank" rel="noreferrer">PDF</a></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {detail.communications.length > 0 && (
        <Panel title="Sent to the supplier">
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.communications.map((entry) => (
              <li key={entry.id} className="py-2">{entry.kind === "acknowledged" ? "Acknowledged" : `Sent (${entry.channel.replace(/_/g, " ")})`} · version {entry.version} · {dateTime(entry.at)}{entry.by ? ` by ${entry.by}` : ""}
                {(entry.recipients || entry.note) && <span className="block text-xs text-text-muted">{[entry.recipients, entry.note].filter(Boolean).join(" · ")}</span>}</li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Items({ detail }: { detail: PurchaseOrderDetail }) {
  const [open, setOpen] = useState<string | null>(null);
  const currency = detail.order.currencyCode;
  const executing = !["draft", "cancelled"].includes(detail.order.status);
  return (
    <Panel title="Items" description={executing ? "Select a line to see the receipts and bills behind its figures." : undefined}>
      <ul className="flex flex-col divide-y divide-border">
        {detail.lines.map((line: OrderLine) => (
          <li key={line.id} className="py-3">
            <button type="button" className="flex w-full flex-wrap items-start justify-between gap-3 text-left" onClick={() => setOpen(open === line.id ? null : line.id)} aria-expanded={open === line.id}>
              <span className="flex min-w-0 flex-col gap-0.5 text-sm">
                <span className="font-medium">{line.lineNumber}. {line.product.code ? `${line.product.code} · ` : ""}{line.description}</span>
                <span className="text-xs text-text-muted">{[line.productTypeLabel, line.hsnSacCode && `${line.productType === "service" ? "SAC" : "HSN"} ${line.hsnSacCode}`, line.warehouseName,
                  line.expectedDeliveryDate && `due ${calendarDate(line.expectedDeliveryDate)}`, line.priceSource === "quotation" && "quoted price", line.zeroPriceReason && `no charge: ${line.zeroPriceReason}`].filter(Boolean).join(" · ")}</span>
                <span className="tabular-nums text-text-secondary">{quantity(line.orderedQuantity)} {line.uom.code} × {money(currency, line.unitPrice)}
                  {Number(line.lineDiscount) + Number(line.allocatedDocumentDiscount) > 0 ? ` − ${money(currency, Number(line.lineDiscount) + Number(line.allocatedDocumentDiscount))}` : ""}
                  {" "}· taxable {money(currency, line.taxableAmount)} · {line.taxes.length ? line.taxes.map((tax) => `${tax.label} ${Number(tax.rate)}%`).join(" + ") : statusLabel(line.taxTreatment)} {money(currency, line.taxTotal)}</span>
              </span>
              <span className="flex flex-col items-end gap-0.5 text-sm">
                <span className="font-medium tabular-nums">{money(currency, line.lineTotal)}</span>
                {executing && line.progress && (
                  <span className="text-xs tabular-nums text-text-muted">
                    {line.progress.receiptRequired ? `received ${quantity(line.progress.received)} · ` : ""}billed {quantity(line.progress.billed)}
                    {Number(line.progress.cancelled) > 0 ? ` · cancelled ${quantity(line.progress.cancelled)}` : ""}
                    {Number(line.progress.returned) > 0 ? ` · returned ${quantity(line.progress.returned)}` : ""}
                    {line.progress.receiptRequired ? ` · ${quantity(line.progress.remainingToReceive)} to receive` : ""}
                  </span>
                )}
              </span>
            </button>
            {open === line.id && line.progress && (
              <div className="mt-2 grid grid-cols-1 gap-3 rounded-[var(--radius-control)] bg-surface-muted p-3 text-sm sm:grid-cols-3">
                <Facts columns={2} items={[
                  { label: "Ordered", value: quantity(line.progress.ordered) },
                  { label: "Received", value: line.progress.receiptRequired ? `${quantity(line.progress.received)}${Number(line.progress.held) > 0 ? ` (${quantity(line.progress.held)} on hold)` : ""}` : "Not required" },
                  { label: "Rejected at receipt", value: quantity(line.progress.rejected) },
                  { label: "Returned", value: quantity(line.progress.returned) },
                  { label: "Cancelled", value: quantity(line.progress.cancelled) },
                  { label: "Billed", value: quantity(line.progress.billed) },
                  { label: "Still to receive", value: quantity(line.progress.remainingToReceive) },
                  { label: "Still to bill", value: quantity(line.progress.remainingToBill) },
                ]} />
                <div>
                  <p className="mb-1 font-medium">Goods receipts</p>
                  {line.receipts.length ? line.receipts.map((receipt) => (
                    <p key={receipt.id}><Link className="text-brand hover:underline" href={`/procurement/goods-receipts/${receipt.id}`}>{receipt.number}</Link> · {statusLabel(receipt.status)} · {quantity(receipt.accepted)} accepted
                      {Number(receipt.held) > 0 ? `, ${quantity(receipt.held)} held` : ""}{Number(receipt.rejected) > 0 ? `, ${quantity(receipt.rejected)} rejected` : ""}</p>
                  )) : <p className="text-text-muted">None</p>}
                </div>
                <div>
                  <p className="mb-1 font-medium">Supplier bills</p>
                  {line.bills.length ? line.bills.map((bill) => <p key={bill.id}>{bill.number}{bill.supplierInvoiceNumber ? ` (${bill.supplierInvoiceNumber})` : ""} · {statusLabel(bill.status)} · {quantity(bill.quantity)}</p>)
                    : <p className="text-text-muted">None</p>}
                  {line.cancellations.map((entry, index) => <p key={index} className="text-text-muted">Cancelled {quantity(entry.quantity)} on {dateTime(entry.at)}{entry.by ? ` by ${entry.by}` : ""}</p>)}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// Receipt summary per product, the previous receipts and what is still pending. Quantities are per line: products are never added together.
// Rejections & discrepancies: what was refused at the dock (never received, still owed unless cancelled) and what was rejected after receipt
// (received, then blocked until returned, disposed of or accepted back), per line and case by case.
function Rejections({ detail, onRecord }: { detail: PurchaseOrderDetail; onRecord: () => void }) {
  const goods = detail.lines.filter((line) => line.progress?.receiptRequired);
  const cases = detail.rejections?.cases ?? [];
  return (
    <>
      <Panel title="Rejection summary" description={`${detail.rejections?.summary.open ?? 0} open · ${detail.rejections?.summary.resolved ?? 0} resolved. Refused goods do not count as received; rejected goods stay received.`}
        actions={detail.actions.recordRejection ? <Button size="compact" variant="secondary" onPress={onRecord}>Record rejection</Button> : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted"><th className="py-1 pr-3 font-normal">Product</th><th className="py-1 pr-3 text-right font-normal">Ordered</th>
              <th className="py-1 pr-3 text-right font-normal">Received</th><th className="py-1 pr-3 text-right font-normal">Refused at dock</th>
              <th className="py-1 pr-3 text-right font-normal">Rejected after receipt</th><th className="py-1 pr-3 text-right font-normal">Returned</th>
              <th className="py-1 pr-3 text-right font-normal">Cancelled</th><th className="py-1 text-right font-normal">Remaining</th></tr></thead>
            <tbody className="divide-y divide-border">
              {goods.map((line) => (
                <tr key={line.id}>
                  <td className="py-2 pr-3">{line.description}{line.progress!.openRejections > 0 && <span className="block text-xs text-warning">{line.progress!.openRejections} open</span>}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.orderedQuantity)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.received)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.refusedAtDock)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.qualityRejected)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.returned)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.cancelled)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{quantity(line.progress!.remainingToReceive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Rejection cases">
        <RejectionTable rows={cases} empty="Nothing has been refused or rejected on this order." />
      </Panel>
    </>
  );
}

function Receipts({ detail }: { detail: PurchaseOrderDetail }) {
  const goods = detail.lines.filter((line) => line.progress?.receiptRequired);
  return (
    <>
    <Panel title="Receipt summary" description={detail.tracking.receivingComplete ? "Receiving is complete." : "Received from posted goods receipts; cancelled quantities are no longer owed."}
      actions={detail.actions.receive ? <LinkButton size="compact" variant="primary" href={`/procurement/goods-receipts/new?purchaseOrderId=${detail.order.id}`}>Create Goods Receipt</LinkButton> : undefined}>
      {!goods.length ? <p className="text-sm text-text-muted">Nothing on this order is received physically.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted"><th className="py-1 pr-3 font-normal">Product</th><th className="py-1 pr-3 text-right font-normal">Ordered</th>
              <th className="py-1 pr-3 text-right font-normal">Received</th><th className="py-1 pr-3 text-right font-normal">Cancelled</th><th className="py-1 pr-3 text-right font-normal">Remaining</th>
              <th className="py-1 pr-3 text-right font-normal">On hold</th><th className="py-1 text-right font-normal">Returned</th></tr></thead>
            <tbody className="divide-y divide-border">
              {goods.map((line) => (
                <tr key={line.id}>
                  <td className="py-2 pr-3">{line.description}<span className="block text-xs text-text-muted">{line.uom.code}{Number(line.progress!.received) > 0 ? ` · ${Math.round(Number(line.progress!.received) / Number(line.orderedQuantity) * 100)}% received` : ""}</span></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.orderedQuantity)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.received)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.progress!.cancelled)}</td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums">{quantity(line.progress!.remainingToReceive)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{quantity(Number(line.progress!.openInspection) + Number(line.progress!.openDamaged))}</td>
                  <td className="py-2 text-right tabular-nums">{quantity(line.progress!.returned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {goods.some((line) => Number(line.progress!.draftReceipt) > 0) && <p className="text-xs text-warning">Draft receipts hold {goods.filter((line) => Number(line.progress!.draftReceipt) > 0).map((line) => `${quantity(line.progress!.draftReceipt)} ${line.uom.code} of ${line.description}`).join(", ")}; they count only once posted.</p>}
    </Panel>
    <Panel title="Previous goods receipts" description="Each delivery is its own receipt; its stock moved when it was posted.">
      {!detail.related.receipts.length ? <p className="text-sm text-text-muted">Nothing received yet.</p> : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {detail.related.receipts.map((receipt) => (
            <li key={receipt.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <Link className="font-medium tabular-nums text-brand hover:underline" href={receipt.href ?? "#"}>{receipt.number}</Link>
              <StatusBadge tone={receipt.status === "reversed" ? "danger" : statusTone(receipt.status)}>{statusLabel(receipt.status)}</StatusBadge>
              <span className="text-text-muted">{calendarDate(receipt.date)}</span>
              {receipt.deliveryNote && <span className="text-text-muted">Delivery note {receipt.deliveryNote}</span>}
              <span className="tabular-nums">{quantity(Number(receipt.accepted) + Number(receipt.held))} received{Number(receipt.held) > 0 ? ` (${quantity(receipt.held)} held)` : ""}{Number(receipt.rejected) > 0 ? ` · ${quantity(receipt.rejected)} refused` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
    </>
  );
}

// Payment terms: the agreed term (as confirmed), how it counts, the advance it expects and where Finance's advance stands, and the statutory
// warning for a micro or small supplier. A confirmed order is a commitment, not a payable.
function PaymentTermsPanel({ detail }: { detail: PurchaseOrderDetail }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const view = detail.paymentTerms;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ amount: view?.advance?.remaining ?? "", reference: "", paymentDate: "" });
  const [key] = useState(() => crypto.randomUUID());
  const record = useMutation({ mutationFn: () => orderAction(detail.order.id, "advance", { ...values, paymentDate: values.paymentDate || undefined, idempotencyKey: key }),
    onSuccess: () => { setOpen(false); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); } });
  if (!view) return null;
  const c = (value: string | null | undefined) => money(detail.order.currencyCode, value);
  return (
    <Panel title="Payment terms" description="Agreed with the supplier and kept as confirmed. The bill's payment schedule comes from them; the order itself owes nothing until a bill is posted."
      actions={view.actions.recordAdvance ? <Button size="compact" variant="secondary" onPress={() => setOpen(true)}>Record advance</Button> : undefined}>
      {view.statutory?.exceeds && <Notice tone="warning">{view.statutory.message}</Notice>}
      <Facts columns={3} items={[
        { label: "Payment term", value: view.paymentTerm ? `${view.paymentTerm.name}${view.paymentTerm.version > 1 ? ` (v${view.paymentTerm.version})` : ""}` : "—" },
        { label: "Payment agreement", value: view.paymentTerm?.summary ?? "—" },
        { label: "Counted", value: view.paymentAgreement ?? "—" },
        { label: "Advance requirement", value: view.advance ? `${view.advance.percentage}% · ${c(view.advance.amount)}` : "None" },
        ...(view.advance?.requested !== undefined ? [{ label: "Advance paid / applied / remaining", value: `${c(view.advance.paid)} / ${c(view.advance.allocated)} / ${c(view.advance.remaining)}` }] : []),
        ...(view.statutory ? [{ label: "Statutory deadline", value: `${view.statutory.statutoryDays} days from acceptance (${view.statutory.classification} enterprise)` }] : []),
        { label: "Payment notes", value: view.notes ?? "—" },
        ...(view.changeReason ? [{ label: "Why these terms", value: view.changeReason }] : []),
      ]} />
      {view.advance?.payments && view.advance.payments.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-border text-sm">
          {view.advance.payments.map((payment) => <li key={payment.id} className="flex justify-between py-1"><span>Advance {payment.number} · {calendarDate(payment.date)} · {statusLabel(payment.status)}</span>
            <span className="tabular-nums">{c(payment.amount)}{Number(payment.unapplied) > 0 ? ` · ${c(payment.unapplied)} not yet applied` : ""}</span></li>)}
        </ul>
      )}
      {open && (
        <Dialog isOpen onOpenChange={(value) => !value && setOpen(false)} title="Record the supplier advance" description={`Finance pays the advance the terms expect (${c(view.advance?.remaining)} still to pay). It is applied to the bill when the bill posts.`} size="md">
          <div className="flex flex-col gap-3">
            {record.error && <Notice>{record.error instanceof Error ? record.error.message : "Could not record the advance."}</Notice>}
            <TextField label="Amount" inputMode="decimal" value={values.amount} onChange={(value) => setValues((current) => ({ ...current, amount: value }))} />
            <TextField label="Payment date" type="date" value={values.paymentDate} onChange={(value) => setValues((current) => ({ ...current, paymentDate: value }))} description="Today if empty." />
            <TextField label="Bank reference" value={values.reference} onChange={(value) => setValues((current) => ({ ...current, reference: value }))} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setOpen(false)}>Close</Button>
              <Button variant="primary" isLoading={record.isPending} isDisabled={!Number(values.amount)} onPress={() => record.mutate()}>Record advance</Button></div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

// The order's matching policy (fixed at confirmation): shown with its reason; changed only by someone allowed to, with a reason.
function MatchingPolicy({ detail, label }: { detail: PurchaseOrderDetail; label: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<string>(detail.order.matchingPolicy ?? "three_way_accepted");
  const [reason, setReason] = useState("");
  const change = useMutation({ mutationFn: () => orderAction(detail.order.id, "matching-policy", { policy, reason }),
    onSuccess: () => { setOpen(false); setReason(""); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "procurement") }); } });
  return (
    <Panel title="Matching policy" description="How this order's supplier bills are matched: 3-Way against posted goods receipts, or 2-Way against the order alone (billing before receipt). Fixed when the order was confirmed."
      actions={detail.actions.changeMatchingPolicy ? <Button size="compact" variant="ghost" onPress={() => setOpen(true)}>Change policy</Button> : undefined}>
      <p className="text-sm"><span className="font-medium">{label}</span>{detail.order.matchingPolicyReason ? <span className="text-text-secondary"> — {detail.order.matchingPolicyReason}</span> : null}</p>
      {open && (
        <Dialog isOpen onOpenChange={(value) => !value && setOpen(false)} title="Change the matching policy" description="Draft bills are matched again under the new policy; posted bills keep the policy they were posted with. The change and your reason are kept on the order." size="lg">
          <div className="flex flex-col gap-3">
            {change.error && <Notice>{change.error instanceof Error ? change.error.message : "Could not change the policy."}</Notice>}
            <Select label="Matching policy" selectedKey={policy} onSelectionChange={(value) => setPolicy(String(value))}
              options={[{ value: "three_way_accepted", label: "3-Way — acceptance required" }, { value: "three_way_received", label: "3-Way — physical receipt" }, { value: "two_way", label: "2-Way — PO-based billing (before receipt)" }]} />
            <TextArea label="Business reason (at least a sentence)" value={reason} onChange={setReason} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onPress={() => setOpen(false)}>Close</Button>
              <Button variant="primary" isLoading={change.isPending} isDisabled={reason.trim().length < 10} onPress={() => change.mutate()}>Change policy</Button></div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

// Supplier Bills: the order's billing progress (from posted bills only), billing by item, the related bills with Finance's paid and outstanding
// amounts, and what is still to be invoiced. Several ordinary supplier bills per order; drafts are shown, never counted as billed.
function Bills({ detail }: { detail: PurchaseOrderDetail }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "order-billing", detail.order.id), queryFn: () => getOrderBilling(detail.order.id) });
  if (query.isLoading) return <LoadingState label="Loading billing progress" />;
  if (!query.data) return <ErrorState title="Could not load billing progress" description={query.error instanceof Error ? query.error.message : undefined} />;
  const billing = query.data;
  const currency = detail.order.currencyCode;
  const createAction = detail.actions.bill && billing.readyToBill
    ? <LinkButton size="compact" variant="primary" href={`/procurement/supplier-bills/new?source=po&purchaseOrderId=${detail.order.id}`}>Create Supplier Bill</LinkButton> : undefined;
  const pending = billing.lines.filter((line) => Number(line.remainingCommitment) > 0);
  return (
    <div className="flex flex-col gap-4">
      <PaymentTermsPanel detail={detail} />
      <MatchingPolicy detail={detail} label={billing.matchingPolicy.label} />
      <Panel title="Billing progress" description={`Only posted bills count as billed. Matching: ${billing.matchingPolicy.label}.`}
        actions={createAction}>
        <div className="flex flex-wrap items-center gap-2"><BillingBadge status={billing.status} />
          <span className="text-sm text-text-secondary">{quantity(billing.totals.billed)} of the original {quantity(billing.totals.ordered)} billed
            {Number(billing.totals.cancelled) > 0 ? ` · ${quantity(billing.totals.cancelled)} cancelled (never billed)` : ""}{billing.bills ? ` through ${billing.bills.filter((bill) => bill.type === "bill" && bill.documentStatus === "posted").length} posted bill(s)` : ""}</span></div>
        <MetricStrip metrics={billing.values ? [
          { label: "Committed value", value: money(currency, billing.values.committed) },
          { label: "Billed value", value: money(currency, billing.values.billed) },
          { label: "Unbilled", value: money(currency, billing.values.unbilled) },
          { label: "Received", value: quantity(billing.totals.received) },
          { label: "Eligible to bill now", value: quantity(billing.totals.eligibleNow) },
        ] : [
          { label: "Committed", value: quantity(billing.totals.committed) }, { label: "Billed", value: quantity(billing.totals.billed) },
          { label: "Remaining commitment", value: quantity(billing.totals.remainingCommitment) }, { label: "Eligible to bill now", value: quantity(billing.totals.eligibleNow) },
        ]} />
        {billing.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
      </Panel>
      <Panel title="Billing by item">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-text-muted">
              {["Item", "Ordered", "Cancelled", "Received", "Billed", "Drafts", "Remaining", "Eligible now"].map((name, index) => <th key={name} className={`py-1 pr-3 font-normal${index ? " text-right" : ""}`}>{name}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {billing.lines.map((line) => (
                <tr key={line.lineId}>
                  <td className="py-2 pr-3">{line.lineNumber}. {line.description}
                    <span className="block text-xs text-text-muted">{line.basis === "amount" ? `Billed by amount: ${money(currency, line.billedAmount)} of ${money(currency, line.agreedAmount)}` : line.receiptRequired ? (line.matching === "receipt" ? "Receipt-based" : "PO-based") : "Service"}{line.overbilled ? " · overbilled" : ""}</span></td>
                  {[line.ordered, line.cancelled, line.received, line.billed, line.draftBilled, line.remainingCommitment, line.eligibleNow].map((value, index) => (
                    <td key={index} className={`py-2 pr-3 text-right tabular-nums${index === 6 && Number(value) > 0 ? " font-medium" : ""}`}>{index === 2 && !line.receiptRequired ? "—" : quantity(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {billing.bills && (
        <Panel title="Related supplier bills" description="Each bill is its own payable with its own due date; payments come from Finance.">
          {!billing.bills.length ? <p className="text-sm text-text-muted">No bills yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-text-muted">
                  {["Bill", "Supplier invoice", "Billed", "Status", "Due", "Invoice total", "Paid", "Outstanding"].map((name, index) => <th key={name} className={`py-1 pr-3 font-normal${index >= 5 ? " text-right" : ""}`}>{name}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {billing.bills.map((bill) => (
                    <tr key={bill.id}>
                      <td className="py-2 pr-3"><Link className="font-medium tabular-nums text-brand hover:underline" href={bill.href}>{bill.billNumber}</Link>{bill.type === "vendor_credit" && <span className="block text-xs text-text-muted">Vendor credit</span>}</td>
                      <td className="py-2 pr-3">{bill.supplierInvoiceNumber ?? "—"}<span className="block text-xs text-text-muted">{calendarDate(bill.billDate)}{bill.receipts.length ? ` · ${bill.receipts.join(", ")}` : ""}</span></td>
                      <td className="py-2 pr-3 tabular-nums">{bill.amount ? money(bill.currencyCode, bill.amount) : bill.quantity ? quantity(bill.quantity) : "—"}</td>
                      <td className="py-2 pr-3"><span className="flex flex-wrap gap-1"><StatusBadge tone={statusTone(bill.documentStatus)}>{statusLabel(bill.documentStatus)}</StatusBadge>
                        {bill.documentStatus === "posted" && <StatusBadge tone={bill.paymentStatus === "paid" ? "success" : "warning"}>{statusLabel(bill.paymentStatus)}</StatusBadge>}
                        {bill.type === "bill" && bill.twoWayResult !== "not_applicable" && <MatchBadge result={bill.twoWayResult} />}
                        {bill.matchingResult === "pending_receipt" && <StatusBadge tone="warning">Pending receipt</StatusBadge>}</span></td>
                      <td className={`py-2 pr-3${bill.dueStatus === "overdue" ? " text-danger" : ""}`}>{bill.dueDate ? calendarDate(bill.dueDate) : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(bill.currencyCode, bill.invoiceTotal)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(bill.currencyCode, bill.paid)}</td>
                      <td className="py-2 text-right tabular-nums">{money(bill.currencyCode, bill.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {billing.payments && billing.payments.bills > 0 && (
            <p className="text-sm text-text-secondary">From Accounts Payable: {money(currency, billing.payments.payable)} payable, {money(currency, billing.payments.paid)} paid, {money(currency, billing.payments.outstanding)} outstanding.</p>
          )}
        </Panel>
      )}
      {billing.matching && (
        <Panel title="Matching results" description="2-Way Matching of the order's bills: each bill against the order's agreed quantities, prices and discounts.">
          <div className="flex flex-wrap gap-3 text-sm">
            {(["matched", "mismatch", "approved_exception", "not_checked"] as const).map((result) => (
              <span key={result} className="flex items-center gap-1"><MatchBadge result={result} /><span className="tabular-nums">{billing.matching?.counts[result] ?? 0}</span></span>
            ))}
          </div>
          {billing.matching.issues.length > 0 && (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {billing.matching.issues.map((issue) => (
                <li key={issue.id} className="flex flex-wrap items-center gap-2 py-2"><Link className="font-medium tabular-nums text-brand hover:underline" href={issue.href}>{issue.billNumber}</Link>
                  <MatchBadge result={issue.result} />{issue.openDiscrepancies > 0 && <span className="text-text-muted">{issue.openDiscrepancies} open discrepanc{issue.openDiscrepancies === 1 ? "y" : "ies"}</span>}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <Panel title="Pending billing" description="What the order still commits that the supplier has not invoiced yet.">
        {!pending.length ? <p className="text-sm text-text-muted">Nothing left to bill.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {pending.map((line) => (
              <li key={line.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{line.lineNumber}. {line.description}</span>
                <span className="tabular-nums text-text-secondary">{line.basis === "amount" ? `${money(currency, line.remainingAmount)} of the agreed value` : `${quantity(line.remainingCommitment)} ${line.uom ?? ""} uninvoiced`}
                  {line.receiptRequired && line.matching === "receipt" ? ` · ${quantity(line.eligibleNow)} received and ready to bill` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Returns({ detail }: { detail: PurchaseOrderDetail }) {
  return (
    <>
      <Panel title="Purchase returns" description="Goods sent back after receipt. The original receipt is kept and the order is not reopened; a replacement is its own purchase order."
        actions={detail.actions.returnGoods ? <LinkButton size="compact" variant="secondary" href={`/procurement/purchase-returns/new?purchaseOrderId=${detail.order.id}`}>Create Purchase Return</LinkButton> : undefined}>
        {!detail.related.returns.length ? <p className="text-sm text-text-muted">No returns.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.related.returns.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link className="font-medium tabular-nums text-brand hover:underline" href={entry.href ?? "#"}>{entry.number}</Link>
                <span className="text-text-muted">{calendarDate(entry.date)} · from {entry.receiptNumber}</span>
                <span className="tabular-nums">{quantity(entry.quantity)} returned</span>
                {entry.replacementNumber && <StatusBadge tone="info">{`Replacement ${entry.replacementNumber}`}</StatusBadge>}
                <span className="text-text-muted">{entry.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <div className="h-4" />
      <Panel title="Vendor credits" description="The supplier's credits correcting this order's bills; a return does not post one by itself.">
        {!detail.related.vendorCredits.length ? <p className="text-sm text-text-muted">None.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.related.vendorCredits.map((note) => (
              <li key={note.id} className="flex flex-wrap items-center gap-x-3 py-2">{note.href ? <Link className="font-medium tabular-nums text-brand hover:underline" href={note.href}>{note.number}</Link> : <span className="font-medium tabular-nums">{note.number}</span>}
                <StatusBadge tone={statusTone(note.status)}>{statusLabel(note.status)}</StatusBadge>{note.total !== undefined && <span className="tabular-nums">{money(note.currencyCode, note.total)}</span>}</li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Related({ detail }: { detail: PurchaseOrderDetail }) {
  const { related } = detail;
  const groups: Array<{ title: string; items: Array<{ id: string; number: string; href: string | null; extra?: string }> }> = [
    { title: "Supplier quotation", items: related.quotation ? [{ id: related.quotation.id, number: related.quotation.number, href: related.quotation.href }] : [] },
    { title: "Goods receipts", items: related.receipts.map((entry) => ({ id: entry.id, number: entry.number, href: entry.href, extra: statusLabel(entry.status ?? "") })) },
    { title: "Supplier bills", items: related.bills.map((entry) => ({ id: entry.id, number: entry.number, href: entry.href, extra: statusLabel(entry.status ?? "") })) },
    { title: "Purchase returns", items: related.returns.map((entry) => ({ id: entry.id, number: entry.number, href: entry.href })) },
    { title: "Vendor credits", items: related.vendorCredits.map((entry) => ({ id: entry.id, number: entry.number, href: entry.href })) },
    { title: "Payments", items: related.payments.map((entry) => ({ id: entry.id, number: entry.number, href: entry.href, extra: money(entry.currencyCode, entry.amount) })) },
  ];
  return (
    <Panel title="Related documents">
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title}>
            <dt className="font-medium">{group.title}</dt>
            <dd className="text-text-secondary">{group.items.length ? group.items.map((item) => (
              <span key={item.id} className="mr-3 inline-block">{item.href ? <Link className="text-brand hover:underline" href={item.href}>{item.number}</Link> : item.number}{item.extra ? ` (${item.extra})` : ""}</span>
            )) : "—"}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Notes({ detail, onChanged }: { detail: PurchaseOrderDetail; onChanged: (message: string) => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "procurement", "purchase-order", detail.order.id, "files");
  const files = useQuery({ queryKey: key, queryFn: () => listOrderFiles(detail.order.id) });
  const input = useRef<HTMLInputElement>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const upload = useMutation({ mutationFn: (file: File) => uploadOrderFile(detail.order.id, file), onSuccess: () => { refresh(); onChanged("File added."); } });
  const remove = useMutation({ mutationFn: (fileId: string) => removeOrderFile(detail.order.id, fileId), onSuccess: refresh });
  return (
    <>
      <Panel title="Notes for the supplier" description="Printed on the purchase order."><p className="whitespace-pre-line text-sm">{detail.order.supplierNotes ?? <span className="text-text-muted">None</span>}</p></Panel>
      <Panel title="Internal notes" description="Never shown to the supplier."><p className="whitespace-pre-line text-sm">{detail.order.internalNotes ?? <span className="text-text-muted">None</span>}</p></Panel>
      <Panel title="Attachments" description="Quotations, specifications, drawings, contracts and correspondence. Never sent with the order. Emailed PDFs are kept here too."
        actions={detail.actions.attach ? (
          <>
            <input ref={input} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button size="compact" variant="secondary" isLoading={upload.isPending} onPress={() => input.current?.click()}>Add file</Button>
          </>
        ) : undefined}>
        {(upload.error || remove.error) && <Notice>{errorMessage(upload.error ?? remove.error)}</Notice>}
        {files.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !files.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a className="font-medium text-brand hover:underline" href={orderFileUrl(detail.order.id, file.id)}>{file.fileName}</a>
                <span className="flex items-center gap-3 text-text-muted">{dateTime(file.uploadedAt)}
                  {detail.actions.attach && <Button size="compact" variant="ghost" isLoading={remove.isPending && remove.variables === file.id} onPress={() => remove.mutate(file.id)}>Remove</Button>}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function History({ detail }: { detail: PurchaseOrderDetail }) {
  return (
    <Panel title="Timeline" description="Confirmations, amendments, sending, receipts, bills, cancellations, returns and closure.">
      <ol className="flex flex-col divide-y divide-border text-sm">
        {detail.history.map((entry) => (
          <li key={entry.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <span className="whitespace-nowrap tabular-nums text-text-muted">{dateTime(entry.at)}</span>
            <span>{entry.summary}{entry.actor ? <span className="text-text-muted"> · {entry.actor}</span> : null}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
