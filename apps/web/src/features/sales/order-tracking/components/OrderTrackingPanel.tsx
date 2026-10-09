"use client";

// Where the order stands: one card per dimension that applies to it
// (inventory, fulfilment, invoicing, payment), each on its own, never a
// single stage or a forced sequence; then the same quantities line by line,
// the documents it led to, and what happened in order of time. Everything
// shown is worked out by the server from those documents.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, ProgressBar, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";

import { closeOrder, reopenClosedOrder, type OrderTracking, type TrackingLine } from "../api/order-tracking-api";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";
const TONES: Record<string, Tone> = {
  not_required: "neutral", not_reserved: "warning", partially_reserved: "warning", fully_reserved: "success",
  not_delivered: "neutral", partially_delivered: "warning", delivered: "success", complete: "success", cancelled: "neutral",
  not_invoiced: "neutral", partially_invoiced: "warning", fully_invoiced: "success",
  unpaid: "warning", partially_paid: "warning", paid: "success", overdue: "danger",
};
const quantity = (value: number | null | undefined) => (value === null || value === undefined ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 }));
const KIND_LABELS: Record<string, string> = { order: "Order", reservation: "Inventory", delivery: "Delivery", invoice: "Invoice", payment: "Payment", return: "Return", credit: "Credit note", refund: "Refund" };

function Card({ title, status, tone, headline, percent, children }: { title: string; status: string; tone: Tone; headline: string; percent?: number; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      <p className="text-lg font-semibold tabular-nums text-text">{headline}</p>
      {percent !== undefined && <ProgressBar aria-label={`${title} progress`} value={percent} />}
      {children && <div className="flex flex-col gap-0.5 text-xs text-text-secondary">{children}</div>}
    </section>
  );
}

// Above the order's tabs: the order card and one card per dimension that
// applies (inventory, fulfilment, invoicing, payment), what needs attention,
// and Close / Reopen. A draft is not tracked yet.
export function OrderTrackingSummary({ tracking, onChanged }: { tracking: OrderTracking; onChanged: (message: string) => void }) {
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const { order, reservation, fulfillment, invoicing, payment, flags } = tracking;
  const currency = order.currencyCode;
  const executing = order.status === "confirmed" || order.status === "closed";
  const cards = [
    <Card key="order" title="Order" status={order.statusLabel} tone={order.status === "cancelled" ? "neutral" : order.status === "closed" ? "success" : "info"} headline={money(currency, order.orderValue)}>
      {order.requestedDeliveryDate && <span>Requested delivery {calendarDate(order.requestedDeliveryDate)}</span>}
      {order.outcome && <span>{OUTCOMES[order.outcome]}</span>}
    </Card>,
    tracking.applies.inventory && executing ? (
      <Card key="inventory" title="Inventory" status={reservation.label} tone={TONES[reservation.status]} headline={reservation.status === "not_required" ? "Nothing left to reserve" : `${quantity(reservation.reserved)} / ${quantity(reservation.required)} reserved`}
        percent={reservation.status === "not_required" ? undefined : reservation.percent}>
        {reservation.remainingToReserve > 0 && <span>{quantity(reservation.remainingToReserve)} still to reserve of what is left to deliver</span>}
      </Card>
    ) : null,
    tracking.applies.fulfillment && executing ? (
      <Card key="fulfillment" title="Fulfillment" status={fulfillment.label} tone={fulfillment.overdue ? "danger" : TONES[fulfillment.status]} headline={`${quantity(fulfillment.delivered)} / ${quantity(fulfillment.ordered)} delivered`} percent={fulfillment.percent}>
        {fulfillment.cancelled > 0 && <span>Cancelled {quantity(fulfillment.cancelled)} / {quantity(fulfillment.ordered)}</span>}
        {fulfillment.remaining > 0 && <span>{quantity(fulfillment.remaining)} still to deliver{fulfillment.overdue ? ` · overdue since ${calendarDate(order.requestedDeliveryDate)}` : ""}</span>}
        {fulfillment.returned > 0 && <span>Returned {quantity(fulfillment.returned)} · net with the customer {quantity(fulfillment.netWithCustomer)}</span>}
      </Card>
    ) : null,
    executing ? (
      <Card key="invoicing" title="Invoicing" status={invoicing.label} tone={TONES[invoicing.status]} headline={`${quantity(invoicing.invoiced)} / ${quantity(invoicing.ordered - invoicing.cancelled)} invoiced`} percent={invoicing.percent}>
        {order.status === "confirmed" && <span>Invoiceable now {quantity(invoicing.invoiceableNow)}{invoicing.basis === "delivered" ? " (delivered, not yet invoiced)" : ""}</span>}
        {invoicing.pendingDelivery > 0 && <span>{quantity(invoicing.pendingDelivery)} waits for delivery before it can be invoiced</span>}
        {invoicing.remaining > 0 && <span>Still to invoice {money(currency, invoicing.remainingValue)}</span>}
      </Card>
    ) : null,
    executing ? (
      <Card key="payment" title="Payment" status={payment.label} tone={TONES[payment.status] ?? "neutral"}
        headline={payment.netBilled === undefined ? payment.label : payment.status === "not_invoiced" ? "Nothing invoiced yet" : `${money(currency, payment.paid ?? 0)} paid`}
        percent={payment.netBilled === undefined || payment.status === "not_invoiced" ? undefined : payment.percent}>
        {payment.netBilled !== undefined && payment.status !== "not_invoiced" && (
          <>
            <span>Balance {money(currency, payment.balanceDue ?? 0)}{(payment.overdueBalance ?? 0) > 0 ? ` · overdue ${money(currency, payment.overdueBalance ?? 0)}` : ""}</span>
            <span>Net billed {money(currency, payment.netBilled)}{(payment.credits ?? 0) > 0 ? ` (invoiced ${money(currency, payment.invoiced ?? 0)} less credit notes ${money(currency, payment.credits ?? 0)})` : ""}</span>
          </>
        )}
        <span>Payment is recorded by Finance against each invoice.</span>
      </Card>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      {order.outcome === "closed_with_cancellations" && (
        <Notice tone="info">This order is closed: {quantity(fulfillment.delivered)} of {quantity(fulfillment.ordered)} delivered and {quantity(fulfillment.cancelled)} cancelled. It was not cancelled as a whole.</Notice>
      )}
      {order.outcome === "closed_manually" && <Notice tone="info">This order was closed by hand{order.closeReason ? `: ${order.closeReason}` : ""}.</Notice>}
      {tracking.warnings.length > 0 && (
        <section aria-label="Needs attention" className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            {tracking.warnings.map((warning) => <StatusBadge key={warning.code} tone={["delivery_overdue", "invoice_overdue", "stock_shortage"].includes(warning.code) ? "danger" : "warning"}>{warning.label}</StatusBadge>)}
          </div>
          <ul className="list-disc pl-5 text-sm text-text-secondary">{tracking.warnings.map((warning) => <li key={warning.code}>{warning.detail}</li>)}</ul>
        </section>
      )}
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${cards.length >= 5 ? "xl:grid-cols-5" : cards.length === 4 ? "xl:grid-cols-4" : cards.length === 3 ? "xl:grid-cols-3" : ""}`}>{cards}</div>
      {(tracking.actions.close || tracking.actions.reopenClosed) && (
        <div className="flex flex-wrap items-center gap-2">
          {tracking.actions.close && <Button variant="secondary" onPress={() => setDialog("close")}>Close Order</Button>}
          {tracking.actions.close && flags.readyToClose && <span className="text-sm text-text-muted">Nothing is left to deliver or invoice.</span>}
          {tracking.actions.reopenClosed && <Button variant="secondary" onPress={() => setDialog("reopen")}>Reopen Closed Order</Button>}
        </div>
      )}
      {dialog && <ReasonDialog kind={dialog} tracking={tracking} onClose={() => setDialog(null)} onDone={(message) => { setDialog(null); onChanged(message); }} />}
    </div>
  );
}

const OUTCOMES: Record<NonNullable<OrderTracking["order"]["outcome"]>, string> = {
  completed: "Completed: everything delivered and invoiced",
  closed_with_cancellations: "Completed with a cancelled part",
  closed_manually: "Closed by hand",
  cancelled_before_execution: "Cancelled before anything was delivered or invoiced",
};

// The Overview tab of an order in execution: the same quantities line by
// line, the milestones, and what happened in order of time.
export function OrderProgress({ tracking }: { tracking: OrderTracking }) {
  const { order } = tracking;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Progress by line" description="Ordered = delivered + cancelled + still to deliver. A return never reduces what was delivered, and a credit note never reduces what was invoiced.">
        <LineTable lines={tracking.lines} showInventory={tracking.applies.inventory} showDelivery={tracking.applies.fulfillment} confirmed={order.status === "confirmed"} />
      </Panel>
      <Panel title="Milestones">
        <Facts columns={4} items={[
          { label: "Created", value: dateTime(tracking.milestones.createdAt) },
          { label: "Confirmed", value: tracking.milestones.confirmedAt ? dateTime(tracking.milestones.confirmedAt) : "—" },
          ...(tracking.applies.inventory ? [{ label: "First reserved", value: tracking.milestones.firstReservedAt ? dateTime(tracking.milestones.firstReservedAt) : "—" }] : []),
          ...(tracking.applies.fulfillment ? [
            { label: "First delivery", value: tracking.milestones.firstDeliveryAt ? dateTime(tracking.milestones.firstDeliveryAt) : "—" },
            { label: "Last delivery", value: tracking.milestones.lastDeliveryAt ? dateTime(tracking.milestones.lastDeliveryAt) : "—" },
          ] : []),
          { label: "First invoice", value: tracking.milestones.firstInvoiceAt ? dateTime(tracking.milestones.firstInvoiceAt) : "—" },
          { label: "Fully invoiced", value: tracking.milestones.fullyInvoicedAt ? dateTime(tracking.milestones.fullyInvoicedAt) : "—" },
          { label: order.status === "cancelled" ? "Cancelled" : "Closed", value: (tracking.milestones.cancelledAt ?? tracking.milestones.closedAt) ? dateTime(tracking.milestones.cancelledAt ?? tracking.milestones.closedAt) : "—" },
        ]} />
      </Panel>
      <Panel title="Timeline" description="What happened, from the order, its reservations, deliveries, invoices, receipts, returns, credit notes and refunds. Edits and notes are in History.">
        {!tracking.timeline.length ? <p className="text-sm text-text-muted">Nothing yet.</p> : (
          <ol className="flex flex-col divide-y divide-border text-sm">
            {tracking.timeline.map((event) => (
              <li key={event.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[11rem_7rem_minmax(0,1fr)]">
                <span className="whitespace-nowrap tabular-nums text-text-muted">{dateTime(event.at)}</span>
                <span className="text-xs font-medium uppercase tracking-wide text-text-muted">{KIND_LABELS[event.kind] ?? event.kind}</span>
                <span>{event.text}{event.actor ? <span className="text-text-muted"> · {event.actor}</span> : null}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

// The Returns & Credits tab: what came back, what was credited and refunded,
// beside the delivered and invoiced figures (which never go down).
export function OrderReturnsCredits({ tracking }: { tracking: OrderTracking }) {
  const { documents, order } = tracking;
  const currency = order.currencyCode;
  const link = (href: string, label: string) => <Link className="font-medium tabular-nums text-brand hover:underline" href={href}>{label}</Link>;
  const amount = (value: number | null) => (value === null ? null : <span className="tabular-nums">{money(currency, value)}</span>);
  const list = <T extends { id: string }>(rows: T[], render: (row: T) => ReactNode) =>
    rows.length ? <span className="flex flex-col gap-1">{rows.map((row) => <span key={row.id} className="flex flex-wrap items-center gap-2">{render(row)}</span>)}</span> : "None";
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Returns and credits" description="What came back and what was credited afterwards. Delivered and invoiced stay as they happened.">
        <Facts columns={4} items={[
          ...(tracking.applies.fulfillment ? [
            { label: "Delivered", value: quantity(tracking.returns.delivered) },
            { label: "Returned", value: quantity(tracking.returns.returned) },
            { label: "Net with the customer", value: quantity(tracking.returns.netWithCustomer) },
          ] : []),
          ...(tracking.credits.invoiced !== undefined ? [
            { label: "Invoiced", value: money(currency, tracking.credits.invoiced) },
            { label: "Credit notes", value: money(currency, tracking.credits.credited ?? 0) },
            { label: "Net billed", value: money(currency, tracking.credits.netBilled ?? 0) },
          ] : []),
          ...(tracking.refunds ? [
            { label: "Refunded", value: money(currency, tracking.refunds.refunded) },
            { label: "Customer credit left", value: money(currency, tracking.refunds.remainingCustomerCredit) },
          ] : []),
        ]} />
      </Panel>
      <Panel title="Documents">
        <Facts columns={2} items={[
          { label: `Returns (${documents.counts.returns})`, value: list(documents.returns, (entry) => <>
            {link(`/sales/returns/${entry.id}`, entry.number)}<StatusBadge tone={statusTone(entry.status)}>{statusLabel(entry.status)}</StatusBadge>
            <span className="text-text-muted">{quantity(entry.quantity)} · {calendarDate(entry.return_date)}{entry.awaiting_credit ? " · awaiting credit note" : ""}</span></>) },
          { label: `Credit notes (${documents.counts.creditNotes})`, value: list(documents.creditNotes, (credit) => <>
            {link(`/sales/credit-notes/${credit.id}`, credit.number)}<StatusBadge tone={statusTone(credit.status)}>{statusLabel(credit.status)}</StatusBadge>
            {amount(credit.grand_total)}<span className="text-text-muted">against {credit.invoice_number}</span></>) },
          ...(tracking.actions.viewMoney ? [{ label: `Refunds (${documents.counts.refunds})`, value: list(documents.refunds, (refund) => <>
            {tracking.actions.openRefunds ? link(`/sales/refunds/${refund.id}`, refund.number) : <span className="font-medium tabular-nums">{refund.number}</span>}
            <StatusBadge tone={statusTone(refund.status)}>{statusLabel(refund.status)}</StatusBadge>{amount(refund.amount)}<span className="text-text-muted">from {refund.credit_note_number}</span></>) }] : []),
        ]} />
      </Panel>
    </div>
  );
}


function LineTable({ lines, showInventory, showDelivery, confirmed }: { lines: TrackingLine[]; showInventory: boolean; showDelivery: boolean; confirmed: boolean }) {
  const head = "py-2 pr-3 text-right font-medium";
  const cell = "py-2 pr-3 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="bg-surface-muted text-left text-text-secondary">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Product / service</th>
            <th className={head}>Ordered</th>
            {showInventory && <th className={head}>Reserved</th>}
            {showDelivery && <th className={head}>Delivered</th>}
            {showDelivery && <th className={head}>Returned</th>}
            <th className={head}>Cancelled</th>
            <th className={head}>Invoiced</th>
            {showDelivery && <th className={head}>To deliver</th>}
            {confirmed && <th className={head}>Invoiceable now</th>}
            <th className={head}>To invoice</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.lineId} className="border-b border-border">
              <td className="py-2 pr-3"><span className="font-medium">{line.itemName}</span>{line.kind === "service" && <span className="text-xs text-text-muted"> · service</span>}{line.unit && <span className="text-xs text-text-muted"> · {line.unit}</span>}</td>
              <td className={cell}>{quantity(line.ordered)}</td>
              {showInventory && <td className={cell}>{quantity(line.reserved)}</td>}
              {showDelivery && <td className={cell}>{quantity(line.delivered)}</td>}
              {showDelivery && <td className={cell}>{quantity(line.returned)}</td>}
              <td className={cell}>{quantity(line.cancelled)}</td>
              <td className={cell}>{quantity(line.invoiced)}</td>
              {showDelivery && <td className={cell}>{quantity(line.remainingToDeliver)}</td>}
              {confirmed && <td className={cell}>{quantity(line.invoiceableNow)}</td>}
              <td className={cell}>{quantity(line.remainingToInvoice)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The documents the order led to, each opening its own page. Counts first, for an immediate picture.
export function RelatedDocuments({ tracking }: { tracking: OrderTracking }) {
  const { documents, order } = tracking;
  const currency = order.currencyCode;
  const link = (href: string, label: string) => <Link className="font-medium tabular-nums text-brand hover:underline" href={href}>{label}</Link>;
  const list = <T extends { id: string }>(rows: T[], render: (row: T) => ReactNode) =>
    rows.length ? <span className="flex flex-col gap-1">{rows.map((row) => <span key={row.id} className="flex flex-wrap items-center gap-2">{render(row)}</span>)}</span> : "None";
  const amount = (value: number | null) => (value === null ? null : <span className="tabular-nums">{money(currency, value)}</span>);
  return (
    <Panel title="Related documents" description={`Deliveries ${documents.counts.deliveries} · Invoices ${documents.counts.invoices} · Receipts ${documents.counts.receipts} · Returns ${documents.counts.returns} · Credit notes ${documents.counts.creditNotes} · Refunds ${documents.counts.refunds}`}>
      <Facts columns={2} items={[
        { label: "Source quotation", value: documents.quotation ? link(`/sales/quotations/${documents.quotation.id}`, documents.quotation.number) : "None (direct order)" },
        { label: "Reservations", value: documents.reservations.total ? `${documents.reservations.active} active of ${documents.reservations.total}` : "None" },
        { label: `Deliveries (${documents.counts.deliveries})`, value: list(documents.deliveries, (delivery) => <>
          {link(`/sales/deliveries/${delivery.id}`, delivery.number)}<StatusBadge tone={statusTone(delivery.status)}>{statusLabel(delivery.status)}</StatusBadge>
          <span className="text-text-muted">{quantity(delivery.quantity)}{delivery.dispatch_date ? ` · ${calendarDate(delivery.dispatch_date)}` : ""}</span></>) },
        { label: `Invoices (${documents.counts.invoices})`, value: list(documents.invoices, (invoice) => <>
          {link(`/sales/invoices/${invoice.id}`, invoice.number)}<StatusBadge tone={invoice.paymentState === "overdue" ? "danger" : statusTone(invoice.paymentState)}>{statusLabel(invoice.paymentState)}</StatusBadge>
          {amount(invoice.grand_total)}<span className="text-text-muted">due {calendarDate(invoice.due_date)}</span></>) },
        ...(tracking.actions.viewMoney ? [{ label: `Receipts (${documents.counts.receipts})`, value: list(documents.receipts, (receipt) => <>
          <span className="font-medium tabular-nums">{receipt.number}</span>{amount(receipt.amount)}<span className="text-text-muted">on {receipt.invoice_number} · {calendarDate(receipt.receipt_date)}</span></>) }] : []),
        { label: `Returns (${documents.counts.returns})`, value: list(documents.returns, (entry) => <>
          {link(`/sales/returns/${entry.id}`, entry.number)}<StatusBadge tone={statusTone(entry.status)}>{statusLabel(entry.status)}</StatusBadge>
          <span className="text-text-muted">{quantity(entry.quantity)}{entry.awaiting_credit ? " · awaiting credit note" : ""}</span></>) },
        { label: `Credit notes (${documents.counts.creditNotes})`, value: list(documents.creditNotes, (credit) => <>
          {link(`/sales/credit-notes/${credit.id}`, credit.number)}<StatusBadge tone={statusTone(credit.status)}>{statusLabel(credit.status)}</StatusBadge>
          {amount(credit.grand_total)}<span className="text-text-muted">against {credit.invoice_number}</span></>) },
        ...(tracking.actions.viewMoney ? [{ label: `Refunds (${documents.counts.refunds})`, value: list(documents.refunds, (refund) => <>
          {tracking.actions.openRefunds ? link(`/sales/refunds/${refund.id}`, refund.number) : <span className="font-medium tabular-nums">{refund.number}</span>}
          <StatusBadge tone={statusTone(refund.status)}>{statusLabel(refund.status)}</StatusBadge>{amount(refund.amount)}<span className="text-text-muted">from {refund.credit_note_number}</span></>) }] : []),
      ]} />
    </Panel>
  );
}

function ReasonDialog({ kind, tracking, onClose, onDone }: { kind: "close" | "reopen"; tracking: OrderTracking; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const closing = kind === "close";
  const save = useMutation({
    mutationFn: () => (closing ? closeOrder(tracking.order.id, reason.trim()) : reopenClosedOrder(tracking.order.id, reason.trim())) as Promise<unknown>,
    onSuccess: () => onDone(closing ? "The order is closed." : "The order is open again."),
  });
  const waived = tracking.invoicing.remaining > 0;
  return (
    <Dialog isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title={closing ? `Close ${tracking.order.number}?` : `Reopen ${tracking.order.number}?`}
      description={closing
        ? "An order closes by itself when nothing is left to deliver or invoice. Close it by hand only when the work is done and that will not happen on its own. Payment does not need to be complete: Finance keeps collecting."
        : "The order becomes Confirmed again with whatever was left on it."}>
      <div className="flex flex-col gap-3">
        {Boolean(save.error) && <Notice>{save.error instanceof SalesApiError || save.error instanceof Error ? save.error.message : "That could not be done."}</Notice>}
        {closing && waived && (
          <Notice tone="warning">{Number(tracking.invoicing.remaining).toLocaleString(undefined, { maximumFractionDigits: 3 })} is still to invoice ({money(tracking.order.currencyCode, tracking.invoicing.remainingValue)}). Closing means it will not be invoiced.</Notice>
        )}
        <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!reason.trim()} onPress={() => save.mutate()}>{closing ? "Close Order" : "Reopen Order"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
