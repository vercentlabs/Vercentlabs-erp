"use client";

// One sales order: the header with its three statuses (order, fulfillment,
// invoicing) and the actions open to the caller now (the server decides them
// and checks each again), then the customer and terms, the lines, what has
// been reserved and delivered, what has been invoiced, related documents,
// notes and files, and the history. A Draft is edited; a Confirmed order is
// executed by deliveries and invoices and is changed only by reopening it
// while nothing has been delivered or invoiced. Each confirmation is kept as
// a revision of the Order Confirmation, with how it was sent and whether the
// customer acknowledged it.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Check, Eye, FileText, Pencil, Send, Truck, Upload } from "lucide-react";
import {
  Button, EnterpriseDataGrid, ErrorState, LinkButton, MetricStrip, PermissionState, ProgressBar, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, buttonVariants,
} from "@vercentlabs/design-system";

import { useCreateRequest } from "@/features/sales/shared/use-create-request";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { StoredTotals, discountReasonLabel } from "@/features/sales/shared/DocumentDiscounts";
import { getOrderTracking, type OrderTracking } from "@/features/sales/order-tracking/api/order-tracking-api";
import { OrderProgress, OrderReturnsCredits, OrderTrackingSummary, RelatedDocuments } from "@/features/sales/order-tracking/components/OrderTrackingPanel";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

import {
  addSalesOrderNote, confirmationPdfUrl, listSalesOrderFiles, getSalesOrder, orderPdfUrl, removeSalesOrderFile, reserveSalesOrderStock, uploadSalesOrderFile,
  type ConfirmResult, type ReservationOutcome, type SalesOrderDetail, type SalesOrderLine,
} from "../api/orders-api";
import { AvailabilityPanel } from "../components/AvailabilityPanel";
import { ReservationPanel } from "../components/ReservationPanel";
import { AcknowledgeConfirmationDialog, ConfirmOrderDialog, MarkConfirmationSentDialog, SendConfirmationDialog } from "../components/ConfirmationDialogs";
import { CreateDeliveryDialog } from "@/features/sales/deliveries/components/DeliveryDialogs";
import { DeliveryStatusBadge } from "@/features/sales/deliveries/components/DeliveryStatusBadge";

import { CreateInvoiceDialog } from "@/features/sales/invoices/components/InvoiceDialogs";

import { CancelOrderDialog, CancelRemainingDialog, ReopenOrderDialog, failureText } from "../components/OrderDialogs";
import { ConfirmationStatusBadge, FulfillmentStatusBadge, InvoicingStatusBadge, OrderStatusBadge, OverdueDeliveryBadge, ReservationStatusBadge } from "../components/OrderStatusBadges";
import { Facts, Notice, Panel } from "@/shared/ui/Panel";

type Snapshot = Record<string, string | null | undefined> | null;
const addressText = (snapshot: Snapshot) =>
  snapshot ? [snapshot.label, snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postal_code].filter(Boolean).join(", "), snapshot.gstin ? `GSTIN ${snapshot.gstin}` : null]
    .filter(Boolean).join("\n") || "—" : "—";
const personName = (snapshot: Snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;
const quantity = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const withUnit = (value: number | string | null | undefined, unit: string | null) => `${quantity(value)}${unit ? ` ${unit}` : ""}`;

type DialogKind = "confirm" | "reopen" | "cancel" | "cancelRemaining" | "delivery" | "invoice" | "email" | "markSent" | "acknowledge" | null;

const EVENT_LABELS: Record<string, string> = {
  "sales_order.created": "Created", "sales_order.updated": "Draft saved", "sales_order.confirmed": "Confirmed", "sales_order.reconfirmed": "Reconfirmed", "sales_order.reopened": "Reopened to draft",
  "sales_order.confirmation_refused": "Confirmation refused", "sales_order.confirmation_created": "Order Confirmation recorded", "sales_order.confirmation_superseded": "Order Confirmation superseded",
  "sales_order.confirmation_marked_sent": "Order Confirmation marked as sent", "sales_order.confirmation_acknowledged": "Customer acknowledged the confirmation",
  "sales_order.cancelled": "Cancelled", "sales_order.quantity_cancelled": "Remaining quantity cancelled", "sales_order.stock_reserved": "Stock reserved",
  "sales_order.stock_released": "Reservation released", "sales_order.delivery_created": "Delivery created", "sales_order.delivery_dispatched": "Delivery dispatched", "sales_order.delivery_cancelled": "Delivery cancelled",
  "sales_order.reservation_consumed": "Reserved stock issued",
  "sales_order.delivery_received": "Delivered to the customer", "sales_order.invoice_created": "Invoice created", "sales_order.confirmation_sent": "Order Confirmation sent",
  "sales_order.closed": "Closed", "sales_order.reopened_for_work": "Open again", "sales_order.note_added": "Note", "sales_order.file_added": "File added",
  "sales_order.file_removed": "File removed",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
function eventDetail(event: SalesDocumentEvent) {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  const lines = Array.isArray(m.lines)
    ? (m.lines as Array<Record<string, unknown>>).map((line) => `${line.item ?? ""} × ${quantity(line.quantity as number)}${line.unit ? ` ${line.unit}` : ""}`).join(", ")
    : null;
  // An address or warehouse change is recorded by id: say what changed, not the ids.
  const changes = Array.isArray(m.changes)
    ? (m.changes as Array<Record<string, unknown>>).map((change) =>
        UUID.test(String(change.from ?? "")) || UUID.test(String(change.to ?? "")) ? `${change.what} changed` : `${change.what}: ${change.from ?? "none"} → ${change.to ?? "none"}`).join("\n")
    : null;
  const problems = Array.isArray(m.problems) ? (m.problems as string[]).join("\n") : null;
  const revision = typeof m.version === "number" ? `Revision ${m.version}` : typeof m.confirmationVersion === "number" && m.confirmationVersion > 1 ? `Revision ${m.confirmationVersion}` : null;
  return [
    event.event_type === "sales_order.created" && (text("quotationNumber") ? `From quotation ${text("quotationNumber")}` : "Direct order"),
    revision, problems, text("channel"), text("varianceReason") && `Differs from the quotation: ${text("varianceReason")}`,
    text("deliveryNumber"), text("invoiceNumber"), lines, changes, m.automatic ? "Reserved automatically on confirmation" : null,
    Number(m.short) > 0 ? `${m.short} line(s) short of stock` : null, text("carrier") && `Carrier ${text("carrier")}${text("trackingNumber") ? ` · ${text("trackingNumber")}` : ""}`,
    text("receivedBy") && `Received by ${text("receivedBy")}`, text("recipient") && `To ${text("recipient")}`, text("fileName"), text("note"), text("reason"),
  ].filter(Boolean).join(" · ");
}

export function SalesOrderDetailScreen({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "order", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => getSalesOrder(orderId).then((r) => r.order) });
  // Where the order stands: one service for every dimension, read beside the order itself.
  const trackingKey = scopedQueryKey(workspace, "sales", "order", orderId, "tracking");
  const trackingQuery = useQuery({ queryKey: trackingKey, queryFn: () => getOrderTracking(orderId).then((r) => r.tracking) });
  const [chosenTab, setTab] = useState<string | null>(null);
  // Check Availability in the header opens Fulfillment and runs the check.
  const [checkAvailability, setCheckAvailability] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "orders") });
  };
  const done = (message?: string) => { setDialog(null); setNotice(message ?? null); refresh(); };
  const fail = (fallback: string) => (failure: unknown) => setError(failureText(failure, fallback));
  const shortOf = (outcome: ReservationOutcome[] = []) => outcome.filter((line) => line.problem).map((line) => `${line.itemName}: ${line.problem}`);
  const confirmed = (result: ConfirmResult) => {
    const short = shortOf(result.reservation);
    const revision = result.confirmationVersion && result.confirmationVersion > 1 ? ` (revision ${result.confirmationVersion})` : "";
    done(short.length ? `The order is confirmed${revision}. Stock could not be reserved in full:\n${short.join("\n")}` : `The order is confirmed${revision}. Send the Order Confirmation to the customer when ready.`);
  };
  const reserve = useMutation({
    // Stock is checked again by the server; what is short stays unreserved demand.
    mutationFn: () => reserveSalesOrderStock(orderId, { idempotencyKey: crypto.randomUUID() }),
    onSuccess: ({ result }) => {
      const short = shortOf(result.lines);
      done(short.length ? `Reserved what is available now.\n${short.join("\n")}` : result.reservedLines ? "Stock is reserved." : "There was nothing more to reserve.");
    },
    onError: fail("The stock could not be reserved."),
  });

  // From Sales → + Create: open the delivery or invoice dialog when this order allows it.
  useCreateRequest(Boolean(query.data), (kind) => {
    const actions = query.data?.actions;
    if (kind === "delivery") { if (actions?.deliver) setDialog("delivery"); else setNotice("Nothing on this order can be delivered now."); }
    if (kind === "invoice") { if (actions?.invoice) setDialog("invoice"); else setNotice("Nothing on this order can be invoiced now."); }
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to sales orders" description="Ask an administrator for the View sales orders permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Sales order not found" : "Could not load this sales order"}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const order = detail.order;
  const actions = detail.actions;
  const currency = order.currency_code;
  const executing = order.status !== "draft";
  const tracking = trackingQuery.data;
  const tab = chosenTab ?? "overview";
  const trackingMissing = executing && !tracking && (trackingQuery.isLoading
    ? <p className="text-sm text-text-muted">Loading where the order stands…</p>
    : <ErrorState title="Could not load the order's tracking" action={{ label: "Retry", onPress: () => trackingQuery.refetch() }} />);

  return (
    <div className="flex flex-col gap-4">
      {error && <Notice>{error}</Notice>}
      {notice && <Notice tone="info" className="whitespace-pre-line">{notice}</Notice>}
      {order.status === "cancelled" && (
        <Notice tone="warning">
          This order was cancelled{order.cancelled_at ? ` on ${dateTime(order.cancelled_at)}` : ""}{order.cancelled_by_name ? ` by ${order.cancelled_by_name}` : ""}.
          {" "}{[detail.cancelReasons.find((reason) => reason.code === order.cancel_reason_code)?.label, order.cancel_reason].filter(Boolean).join(": ")}
        </Notice>
      )}
      {detail.duplicatePurchaseOrders.length > 0 && order.status !== "cancelled" && (
        <Notice tone="warning">
          Customer PO {order.customer_po_number} is also on{" "}
          {detail.duplicatePurchaseOrders.map((other, index) => (
            <span key={other.id}>{index > 0 ? ", " : ""}<Link className="underline" href={`/sales/orders/${other.id}`}>{other.number}</Link></span>
          ))}. Check that this is not a duplicate order.
        </Notice>
      )}

      <RecordDetailsPage
        header={{
          title: order.sales_order_number,
          status: (
            <span className="flex flex-wrap items-center gap-1.5">
              <OrderStatusBadge status={order.status} label={order.statusLabel} />
              {executing && order.confirmation !== "none" && <ConfirmationStatusBadge status={order.confirmation} label={order.confirmationLabel} />}
              {order.status === "confirmed" && order.reservation !== "not_required" && <ReservationStatusBadge status={order.reservation} label={order.reservationLabel} />}
              {executing && order.fulfillment !== "not_required" && <FulfillmentStatusBadge status={order.fulfillment} label={order.fulfillmentLabel} />}
              {detail.delivery.overdue && <OverdueDeliveryBadge />}
              {executing && order.status !== "cancelled" && <InvoicingStatusBadge status={order.invoicing} label={order.invoicingLabel} />}
            </span>
          ),
          fields: [
            { label: "Customer", value: order.party_id ? <Link className="hover:underline" href={`/sales/customers/${order.party_id}`}>{order.customer_snapshot?.displayName ?? "—"}</Link> : "—" },
            { label: "Order date", value: calendarDate(order.order_date) },
            { label: "Customer PO", value: order.customer_po_number ?? "—" },
            { label: "Requested delivery", value: calendarDate(order.requested_delivery_date) },
            { label: "Order value", value: money(currency, order.grand_total) },
            ...(executing && tracking?.payment.balanceDue !== undefined && tracking.payment.status !== "not_invoiced" ? [{ label: "Balance due", value: money(currency, tracking.payment.balanceDue) }] : []),
            { label: "Salesperson", value: order.owner_name ?? "—" },
            ...(order.source_quotation_id
              ? [{ label: "Quotation", value: <Link className="hover:underline" href={`/sales/quotations/${order.source_quotation_id}`}>{order.source_quotation_number}</Link> }]
              : []),
          ],
          primaryAction: actions.confirm ? (
            <Button variant="primary" onPress={() => setDialog("confirm")}><Check className="size-4" aria-hidden="true" />Confirm Order</Button>
          ) : actions.deliver ? (
            <Button variant="primary" onPress={() => setDialog("delivery")}><Truck className="size-4" aria-hidden="true" />Create Delivery</Button>
          ) : actions.invoice ? (
            <Button variant="primary" onPress={() => setDialog("invoice")}><FileText className="size-4" aria-hidden="true" />Create Invoice</Button>
          ) : undefined,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <LinkButton variant="secondary" href={`/sales/orders/${orderId}/edit`}><Pencil className="size-4" aria-hidden="true" />Edit</LinkButton>}
              {actions.viewConfirmation && <a className={buttonVariants({ variant: "secondary" })} href={orderPdfUrl(orderId, true)} target="_blank" rel="noreferrer"><Eye className="size-4" aria-hidden="true" />View Confirmation</a>}
              {actions.sendConfirmation && <Button variant="secondary" onPress={() => setDialog("email")}><Send className="size-4" aria-hidden="true" />Send Confirmation</Button>}
              {order.status !== "cancelled" && order.status !== "closed" && detail.capabilities.checkAvailability && detail.lines.some((line) => line.is_stock_tracked) && (
                <Button variant="secondary" onPress={() => { setCheckAvailability(true); setTab("fulfillment"); }}>Check Availability</Button>
              )}
              {actions.reserve && <Button variant="secondary" isLoading={reserve.isPending} onPress={() => reserve.mutate()}>Reserve Stock</Button>}
              {actions.deliver && actions.invoice && <Button variant="secondary" onPress={() => setDialog("invoice")}><FileText className="size-4" aria-hidden="true" />Create Invoice</Button>}
              {actions.print && <LinkButton variant="secondary" href={orderPdfUrl(orderId)} download>{order.status === "draft" ? "Draft PDF" : "Download PDF"}</LinkButton>}
              {actions.reopen && <Button variant="ghost" onPress={() => setDialog("reopen")}>Reopen to Draft</Button>}
              {actions.cancelRemaining && <Button variant="ghost" onPress={() => setDialog("cancelRemaining")}>Cancel Remaining</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Order</Button>}
            </div>
          ),
        }}
      >
        {/* Where the order stands, always on top once it is confirmed: one service for this page, the list and the reports. */}
        {executing && tracking ? <OrderTrackingSummary tracking={tracking} onChanged={(message) => done(message)} /> : trackingMissing || (
        <MetricStrip
          metrics={[
            { label: "Subtotal", value: money(currency, order.subtotal) },
            { label: "Discount", value: money(currency, order.discount_total) },
            { label: "Tax", value: money(currency, order.tax_total) },
            { label: "Grand total", value: money(currency, order.grand_total) },
            ...(executing ? [{ label: "Invoiced", value: money(currency, detail.invoicing.invoicedValue) }] : []),
            ...(order.margin_percent !== undefined ? [{ label: "Margin", value: `${Number(order.margin_percent).toFixed(1)}%` }] : []),
          ]}
        />)}
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Sales order sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items ({detail.lines.length})</Tab>
            <Tab id="fulfillment">Fulfillment</Tab>
            <Tab id="invoices">Invoices ({detail.invoices.length})</Tab>
            <Tab id="confirmation">Confirmation</Tab>
            {executing && <Tab id="returns">Returns &amp; credits</Tab>}
            <Tab id="related">Related documents</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
                    <TabPanel id="overview"><Overview detail={detail} tracking={executing ? tracking : undefined} /></TabPanel>
          <TabPanel id="items"><Items detail={detail} /></TabPanel>
          <TabPanel id="fulfillment">
            <Fulfillment detail={detail} orderId={orderId} autoCheck={checkAvailability} reserving={reserve.isPending} onReserve={() => reserve.mutate()}
              onDeliver={() => setDialog("delivery")} onChanged={(message?: string) => (message ? done(message) : refresh())} />
          </TabPanel>
          <TabPanel id="invoices"><Invoices detail={detail} onInvoice={() => setDialog("invoice")} /></TabPanel>
          <TabPanel id="confirmation">
            <Confirmation detail={detail} onSend={() => setDialog("email")} onMarkSent={() => setDialog("markSent")} onAcknowledge={() => setDialog("acknowledge")} />
          </TabPanel>
          {executing && <TabPanel id="returns">{tracking ? <OrderReturnsCredits tracking={tracking} /> : <div className="pt-4">{trackingMissing}</div>}</TabPanel>}
          <TabPanel id="related"><Related detail={detail} tracking={tracking} /></TabPanel>
          <TabPanel id="notes"><Notes detail={detail} orderId={orderId} canEdit={Boolean(detail.capabilities.create)} onChanged={refresh} /></TabPanel>
          <TabPanel id="history"><History detail={detail} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "confirm" && <ConfirmOrderDialog orderId={orderId} number={order.sales_order_number} versionNumber={order.version_number} onClose={() => setDialog(null)} onDone={confirmed} />}
      {dialog === "reopen" && <ReopenOrderDialog orderId={orderId} number={order.sales_order_number} onClose={() => setDialog(null)} onDone={() => done("The order is a draft again. Its Order Confirmation was superseded and the stock reserved for it was released.")} />}
      {dialog === "markSent" && <MarkConfirmationSentDialog orderId={orderId} number={order.sales_order_number} contactName={personName(order.contact_snapshot)} onClose={() => setDialog(null)} onDone={() => done("The confirmation is marked as sent.")} />}
      {dialog === "acknowledge" && <AcknowledgeConfirmationDialog orderId={orderId} number={order.sales_order_number} onClose={() => setDialog(null)} onDone={() => done("The customer's acknowledgement is recorded.")} />}
      {dialog === "cancel" && (
        <CancelOrderDialog orderId={orderId} number={order.sales_order_number} reasons={detail.cancelReasons} reasonRequired={order.status === "confirmed"}
          onClose={() => setDialog(null)} onDone={() => done()} />
      )}
      {dialog === "cancelRemaining" && <CancelRemainingDialog orderId={orderId} detail={detail} onClose={() => setDialog(null)} onDone={() => done("The remaining quantity was cancelled.")} />}
      {dialog === "delivery" && <CreateDeliveryDialog orderId={orderId} number={order.sales_order_number} onClose={() => setDialog(null)} onDone={(deliveryId) => { refresh(); router.push(`/sales/deliveries/${deliveryId}`); }} />}
      {dialog === "invoice" && (
        <CreateInvoiceDialog orderId={orderId} number={order.sales_order_number} onClose={() => setDialog(null)}
          onDone={(invoiceId) => { refresh(); router.push(`/sales/invoices/${invoiceId}`); }} />
      )}

      {dialog === "email" && (
        <SendConfirmationDialog orderId={orderId} number={order.sales_order_number} version={order.confirmation_version} contactName={personName(order.contact_snapshot)}
          contactEmail={order.contact_snapshot?.email ?? null} customerPo={order.customer_po_number} onClose={() => setDialog(null)} onDone={(sentTo) => done(`The Order Confirmation was sent to ${sentTo}.`)} />
      )}
    </div>
  );
}

function Overview({ detail, tracking }: { detail: SalesOrderDetail; tracking?: OrderTracking }) {
  const order = detail.order;
  return (
    <div className="flex flex-col gap-4 pt-4">
      {tracking && <OrderProgress tracking={tracking} />}
      <Panel title="Customer">
        <Facts items={[
          { label: "Customer", value: order.customer_snapshot?.displayName ?? "—" },
          { label: "Customer number", value: order.customer_snapshot?.customerNumber ?? order.customer_number ?? "—" },
          { label: "GSTIN", value: order.customer_snapshot?.gstin ?? "—" },
          { label: "Contact", value: [personName(order.contact_snapshot), order.contact_snapshot?.designation, order.contact_snapshot?.email, order.contact_snapshot?.phone ?? order.contact_snapshot?.mobile].filter(Boolean).join(" · ") || "—" },
          { label: "Bill to", value: <span className="whitespace-pre-line">{addressText(order.billing_address_snapshot)}</span> },
          { label: "Ship to", value: <span className="whitespace-pre-line">{addressText(order.shipping_address_snapshot)}</span> },
        ]} />
      </Panel>
      <Panel title="Order">
        <Facts items={[
          { label: "Order date", value: calendarDate(order.order_date) },
          { label: "Customer PO", value: [order.customer_po_number, order.customer_po_date && `dated ${calendarDate(order.customer_po_date)}`].filter(Boolean).join(" ") || "—" },
          { label: "Customer reference", value: order.customer_reference ?? "—" },
          { label: "Requested delivery", value: calendarDate(order.requested_delivery_date) },
          { label: "Default warehouse", value: order.default_warehouse_name ?? "—" },
          { label: "Salesperson", value: order.owner_name ?? "—" },
        ]} />
      </Panel>
      <Panel title="Commercial terms" description={order.source_quotation_id ? "Carried from the accepted quotation; quoted prices, discounts and tax are executed as agreed." : undefined}>
        <Facts items={[
          { label: "Currency", value: order.currency_code },
          { label: "Price list", value: order.price_list_name ? `${order.price_list_name} (${order.price_list_tax_inclusive ? "tax inclusive" : "tax exclusive"})` : "None" },
          { label: "Payment terms", value: order.payment_term_snapshot?.name
            ? <span className="flex flex-col"><span>{order.payment_term_snapshot.name}</span>
                {[order.payment_term_snapshot.description, order.payment_term_snapshot.note].filter(Boolean).map((line, index) => <span key={index} className="text-xs text-text-muted">{line}</span>)}</span>
            : "—" },
          { label: "Issued by", value: order.seller_snapshot?.name ? `${order.seller_snapshot.name}${order.seller_snapshot.gstin ? ` · GSTIN ${order.seller_snapshot.gstin}` : ""}` : "—" },
          { label: "Place of supply", value: order.place_of_supply
            ? `${order.place_of_supply_name ?? order.place_of_supply} (${order.place_of_supply})${order.place_of_supply_source === "override" ? ` · changed: ${order.place_of_supply_reason ?? ""}` : ""}`
            : "—" },
          { label: "GST", value: order.tax_treatment !== "taxable" ? "No tax charged" : ({ intra_state: "Within the state: CGST + SGST", inter_state: "Between states: IGST" } as Record<string, string>)[order.supply_nature ?? ""] ?? "—" },
          { label: "Additional discount", value: !Number(order.document_discount_amount) ? "None" : order.document_discount_type === "percent"
            ? `${Number(order.document_discount_value)}% (${money(order.currency_code, order.document_discount_amount)})` : money(order.currency_code, order.document_discount_amount) },
          { label: "Discount reason", value: discountReasonLabel(order.discount_reason_code, order.discount_reason_text) ?? "—" },
        ]} />
      </Panel>
      <Panel title="Status history">
        <Facts items={[
          { label: "Created", value: `${dateTime(order.created_at)}${order.created_by_name ? ` by ${order.created_by_name}` : ""}` },
          { label: "Confirmed", value: order.confirmed_at ? `${dateTime(order.confirmed_at)}${order.confirmed_by_name ? ` by ${order.confirmed_by_name}` : ""}` : "—" },
          { label: "Confirmation", value: order.confirmation === "none" ? "—" : `${order.confirmationLabel}${order.confirmation_version > 1 ? ` (revision ${order.confirmation_version})` : ""}` },
          { label: "Closed", value: order.closed_at ? dateTime(order.closed_at) : "—" },
          { label: "Cancelled", value: order.cancelled_at ? `${dateTime(order.cancelled_at)}${order.cancelled_by_name ? ` by ${order.cancelled_by_name}` : ""}` : "—" },
        ]} />
      </Panel>
    </div>
  );
}

function Items({ detail }: { detail: SalesOrderDetail }) {
  const order = detail.order;
  const currency = order.currency_code;
  const columns: ColumnDef<SalesOrderLine, unknown>[] = [
    { id: "seq", header: "#", cell: ({ row }) => row.original.sequence },
    {
      id: "item", header: "Product / service",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className="font-medium">{row.original.item_name_snapshot}</span>
          <span className="text-xs text-text-muted">{[row.original.item_code_snapshot, row.original.hsn_sac_snapshot && `${row.original.hsn_sac_kind === "sac" ? "SAC" : "HSN"} ${row.original.hsn_sac_snapshot}`, row.original.is_service && "Service"].filter(Boolean).join(" · ")}</span>
          {row.original.description_snapshot && row.original.description_snapshot !== row.original.item_name_snapshot && <span className="text-xs text-text-secondary">{row.original.description_snapshot}</span>}
        </span>
      ),
    },
    { id: "qty", header: "Quantity", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{withUnit(row.original.quantity, row.original.uom_snapshot)}</span> },
    { id: "warehouse", header: "Warehouse", cell: ({ row }) => row.original.is_service ? "" : row.original.warehouse_name ?? "—" },
    {
      id: "price", header: "Unit price",
      cell: ({ row }) => (
        <span className="flex flex-col tabular-nums">
          {money(currency, row.original.unit_price)}
          {row.original.is_quoted ? <span className="text-xs text-text-muted">As quoted</span>
            : row.original.manual_price_override ? <span className="text-xs text-warning" title={row.original.manual_price_reason ?? undefined}>Overridden{row.original.manual_price_reason ? `: ${row.original.manual_price_reason}` : ""}</span>
              : null}
        </span>
      ),
    },
    {
      id: "discount", header: "Discount",
      cell: ({ row }) => Number(row.original.discount_amount)
        ? <span className="tabular-nums">{row.original.discount_type === "amount" ? money(currency, row.original.discount_amount) : `${Number(row.original.discount_value)}% (${money(currency, row.original.discount_amount)})`}</span>
        : "",
    },
    { id: "taxable", header: "Taxable", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums">
        {money(currency, row.original.taxable_amount)}
        {Number(row.original.document_discount_amount) > 0 && <span className="text-xs text-text-muted">after {money(currency, row.original.document_discount_amount)} additional discount</span>}
      </span>
    ) },
    { id: "tax", header: "Tax", cell: ({ row }) => (
      <span className="flex flex-col tabular-nums">
        {money(currency, row.original.tax_amount)}
        <span className="text-xs text-text-muted">{row.original.tax_treatment && row.original.tax_treatment !== "taxable" ? row.original.tax_treatment.replace(/_/g, " ") : `${Number(row.original.tax_rate)}%`}</span>
      </span>
    ) },
    { id: "total", header: "Amount", cell: ({ row }) => <span className="font-medium tabular-nums">{money(currency, row.original.line_total)}</span> },
  ];
  return (
    <div className="flex flex-col gap-4 pt-4">
      <EnterpriseDataGrid<SalesOrderLine> aria-label="Order lines" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Tax breakdown">
          {detail.taxLines.length ? (
            <Facts columns={2} items={detail.taxLines.map((tax) => ({ label: `${tax.label ?? tax.tax_type.toUpperCase()} ${Number(tax.rate)}% on ${money(currency, tax.taxable_amount)}`, value: money(currency, tax.tax_amount) }))} />
          ) : <p className="text-sm text-text-muted">No tax on this order.</p>}
        </Panel>
        <Panel title="Totals" description="Calculated by the server when the order was saved. Tax is posted by the invoice, not by the order.">
          <StoredTotals currencyCode={currency} document={order} taxLines={detail.taxLines} />
        </Panel>
      </div>
    </div>
  );
}

function Fulfillment({ detail, orderId, autoCheck, reserving, onReserve, onDeliver, onChanged }: {
  detail: SalesOrderDetail; orderId: string; autoCheck: boolean; reserving: boolean; onReserve: () => void; onDeliver: () => void; onChanged: (message?: string) => void;
}) {
  const order = detail.order;
  const actions = detail.actions;
  const goods = detail.lines.filter((line) => !line.is_service);
  return (
    <div className="flex flex-col gap-4 pt-4">
      {detail.capabilities.checkAvailability && goods.some((line) => line.is_stock_tracked) && order.status !== "cancelled" && order.status !== "closed" && (
        <AvailabilityPanel key={autoCheck ? "checked" : "idle"} orderId={orderId} autoCheck={autoCheck} canReserve={actions.reserve} reserving={reserving} onReserve={onReserve}
          canChangeWarehouse={order.status === "confirmed" && Boolean(detail.capabilities.changeWarehouse)} onChanged={onChanged} />
      )}
      {detail.delivery.deliverable && order.status !== "draft" && <DeliveryProgress detail={detail} canDeliver={actions.deliver} onDeliver={onDeliver} />}
      <ReservationPanel orderId={orderId} detail={detail} reserving={reserving} onReserveRemaining={onReserve} onDeliver={onDeliver} onChanged={onChanged} />
      <Panel title="Deliveries" description="An order can be delivered in several parts, each from one warehouse. Stock is issued when a delivery is dispatched.">
        {!detail.deliveries.length ? <p className="text-sm text-text-muted">No deliveries yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-3">
                  <Link className="font-medium text-brand tabular-nums hover:underline" href={`/sales/deliveries/${delivery.id}`}>{delivery.delivery_number}</Link>
                  <DeliveryStatusBadge status={delivery.delivery_status} label={delivery.statusLabel} />
                  <span className="text-text-muted">
                    {[delivery.warehouse_name, delivery.dispatch_date && `dispatched ${calendarDate(delivery.dispatch_date)}`,
                      !delivery.dispatch_date && delivery.expected_delivery_date && `expected ${calendarDate(delivery.expected_delivery_date)}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-text-secondary">{delivery.lines.map((line) => `${line.item_name_snapshot} × ${withUnit(line.quantity, line.uom_snapshot)}`).join(", ")}</span>
                {(delivery.carrier || delivery.delivered_at) && (
                  <span className="text-xs text-text-muted">
                    {[delivery.carrier && `Carrier ${delivery.carrier}${delivery.tracking_number ? ` · ${delivery.tracking_number}` : ""}`,
                      delivery.delivered_at && `Delivered ${dateTime(delivery.delivered_at)}${delivery.received_by ? ` · received by ${delivery.received_by}` : ""}`].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// What has gone out against what is still ordered, line by line. Remaining = ordered − dispatched − cancelled, from the deliveries and
// cancellations themselves; a partial delivery leaves the rest open until it is delivered or cancelled.
function DeliveryProgress({ detail, canDeliver, onDeliver }: { detail: SalesOrderDetail; canDeliver: boolean; onDeliver: () => void }) {
  const progress = detail.delivery;
  const goods = detail.lines.filter((line) => !line.is_service);
  const returns = goods.some((line) => Number(line.returned_quantity) > 0);
  const requested = detail.order.requested_delivery_date;
  return (
    <Panel title="Delivery progress"
      description={`${quantity(progress.delivered)} of ${quantity(progress.ordered - progress.cancelled)} delivered${progress.cancelled ? ` (${quantity(progress.cancelled)} cancelled)` : ""}${progress.remaining ? ` · ${quantity(progress.remaining)} left to deliver` : ""}${requested ? ` · requested by ${calendarDate(requested)}` : ""}`}
      actions={(
        <span className="flex flex-wrap items-center gap-2">
          {progress.overdue && <OverdueDeliveryBadge />}
          {canDeliver && <Button variant="primary" size="compact" onPress={onDeliver}>{detail.deliveries.some((delivery) => delivery.delivery_status !== "cancelled") ? "Create Next Delivery" : "Create Delivery"}</Button>}
        </span>
      )}>
      <ProgressBar label="Delivered" value={progress.percent} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-surface-muted text-left text-text-secondary">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Product</th>
              <th className="py-2 pr-3 text-right font-medium">Ordered</th>
              <th className="py-2 pr-3 text-right font-medium">Reserved</th>
              <th className="py-2 pr-3 text-right font-medium">Dispatched</th>
              <th className="py-2 pr-3 text-right font-medium">Cancelled</th>
              {returns && <th className="py-2 pr-3 text-right font-medium">Returned</th>}
              {returns && <th className="py-2 pr-3 text-right font-medium">Net with customer</th>}
              <th className="py-2 text-right font-medium">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {goods.map((line) => (
              <tr key={line.id} className="border-b border-border">
                <td className="py-2 pr-3 font-medium">{line.item_name_snapshot}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{withUnit(line.ordered_quantity, line.uom_snapshot)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{line.is_stock_tracked ? quantity(line.reserved_quantity) : "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{quantity(line.delivered_quantity)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{Number(line.cancelled_quantity) ? quantity(line.cancelled_quantity) : ""}</td>
                {returns && <td className="py-2 pr-3 text-right tabular-nums">{Number(line.returned_quantity) ? quantity(line.returned_quantity) : ""}</td>}
                {returns && <td className="py-2 pr-3 text-right tabular-nums">{quantity(Number(line.delivered_quantity) - Number(line.returned_quantity))}</td>}
                <td className="py-2 text-right font-medium tabular-nums">{Number(line.remaining_to_deliver) ? quantity(line.remaining_to_deliver) : "Complete"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Invoices({ detail, onInvoice }: { detail: SalesOrderDetail; onInvoice: () => void }) {
  const order = detail.order;
  const currency = order.currency_code;
  const columns: ColumnDef<SalesOrderLine, unknown>[] = [
    { id: "item", header: "Product / service", cell: ({ row }) => <span className="font-medium">{row.original.item_name_snapshot}</span> },
    { id: "ordered", header: "Ordered", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{withUnit(row.original.ordered_quantity, row.original.uom_snapshot)}</span> },
    { id: "delivered", header: "Delivered", cell: ({ row }) => <span className="tabular-nums">{row.original.is_service ? "—" : quantity(row.original.delivered_quantity)}</span> },
    { id: "cancelled", header: "Cancelled", cell: ({ row }) => <span className="tabular-nums">{row.original.cancelled_quantity ? quantity(row.original.cancelled_quantity) : ""}</span> },
    { id: "invoiced", header: "Invoiced", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.invoiced_quantity)}</span> },
    { id: "drafts", header: "On drafts", cell: ({ row }) => <span className="tabular-nums text-text-muted">{row.original.on_draft_invoices ? quantity(row.original.on_draft_invoices) : ""}</span> },
    { id: "now", header: "Invoiceable now", cell: ({ row }) => <span className="font-medium tabular-nums">{quantity(row.original.invoiceable_now)}</span> },
    ...(detail.invoicing.basis === "delivered"
      ? [{ id: "pending", header: "Pending delivery", cell: ({ row }: { row: { original: SalesOrderLine } }) => <span className="tabular-nums">{row.original.is_service ? "—" : quantity(row.original.pending_delivery_to_invoice)}</span> } as ColumnDef<SalesOrderLine, unknown>]
      : []),
    { id: "remaining", header: "Remaining to invoice", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.remaining_to_invoice)}</span> },
  ];
  const onDrafts = detail.lines.some((line) => line.on_draft_invoices > 0);
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Invoicing progress"
        description={`Invoiced on ${detail.invoicing.basis === "delivered" ? "delivered" : "ordered"} quantities (Sales settings). Only posted invoices count as invoiced; payment is recorded against each invoice by Finance.`}
        actions={(
          <span className="flex flex-wrap items-center gap-2">
            {order.status !== "draft" && <InvoicingStatusBadge status={order.invoicing} label={order.invoicingLabel} />}
            {detail.actions.invoice && <Button variant="primary" size="compact" onPress={onInvoice}>Create Invoice</Button>}
          </span>
        )}>
        <Facts columns={4} items={[
          { label: "Order value", value: money(currency, detail.invoicing.orderedValue) },
          { label: "Invoiced", value: money(currency, detail.invoicing.invoicedValue) },
          { label: "Credited", value: money(currency, detail.invoicing.creditedValue) },
          { label: "Net billed", value: money(currency, detail.invoicing.netBilledValue) },
          { label: "Remaining to invoice", value: money(currency, detail.invoicing.remainingValue) },
          { label: "Invoiceable now", value: money(currency, detail.invoicing.invoiceableNowValue) },
        ]} />
        {onDrafts && <Notice tone="info">Draft invoices bill part of what is left. They are not invoiced until posted, and only what is left at posting can be posted.</Notice>}
      </Panel>
      <Panel title="Invoices" description="An order can be invoiced in several parts. Each invoice bills its quantity with the discount and tax in proportion; only posted invoices count as invoiced.">
        {!detail.invoices.length ? <p className="text-sm text-text-muted">No invoices yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-3 py-2">
                {invoice.invoice_type === "invoice"
                  ? <Link className="font-medium text-brand tabular-nums hover:underline" href={`/sales/invoices/${invoice.id}`}>{invoice.invoice_number}</Link>
                  : <span className="font-medium tabular-nums">{invoice.invoice_number}</span>}
                {invoice.invoice_type !== "invoice" && <StatusBadge tone="neutral">{statusLabel(invoice.invoice_type)}</StatusBadge>}
                <StatusBadge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</StatusBadge>
                <span className="text-text-muted">{calendarDate(invoice.invoice_date)}</span>
                <span className="tabular-nums">{money(invoice.currency_code, invoice.grand_total)}</span>
                {Number(invoice.outstanding_amount) > 0 && <span className="text-text-muted tabular-nums">Outstanding {money(invoice.currency_code, invoice.outstanding_amount)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Credit notes" description="Credits against the order's posted invoices: returned goods, price adjustments and corrections. Invoices keep their totals; posted credit notes reduce what was billed.">
        {!detail.creditNotes.length ? <p className="text-sm text-text-muted">No credit notes.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.creditNotes.map((credit) => (
              <li key={credit.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link className="font-medium text-brand tabular-nums hover:underline" href={`/sales/credit-notes/${credit.id}`}>{credit.invoice_number}</Link>
                <StatusBadge tone={statusTone(credit.status)}>{statusLabel(credit.status)}</StatusBadge>
                <span className="text-text-muted">{calendarDate(credit.invoice_date)}</span>
                <span className="tabular-nums">{money(credit.currency_code, credit.grand_total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Invoiced by line">
        <EnterpriseDataGrid<SalesOrderLine> aria-label="Invoicing by line" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready" />
      </Panel>
    </div>
  );
}

function Confirmation({ detail, onSend, onMarkSent, onAcknowledge }: {
  detail: SalesOrderDetail; onSend: () => void; onMarkSent: () => void; onAcknowledge: () => void;
}) {
  const order = detail.order;
  const actions = detail.actions;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Order Confirmation"
        description="The Order Confirmation is this order's own number, as confirmed. Each confirmation is kept unchanged; reopening the order supersedes it and confirming again makes the next revision. Sending it never changes the order's status, and delivery and invoicing never wait for an acknowledgement."
        actions={(
          <div className="flex flex-wrap gap-2">
            {actions.sendConfirmation && <Button variant="primary" size="compact" onPress={onSend}>Send Confirmation</Button>}
            {actions.markConfirmationSent && <Button variant="secondary" size="compact" onPress={onMarkSent}>Mark as Sent</Button>}
            {actions.acknowledgeConfirmation && <Button variant="secondary" size="compact" onPress={onAcknowledge}>Record Acknowledgement</Button>}
          </div>
        )}>
        {order.status === "draft" && <Notice tone="info">{detail.confirmations.length ? "The order was reopened: its earlier confirmation is superseded. Confirm the order again to issue the next revision." : "The order is a draft: it has no Order Confirmation until it is confirmed."}</Notice>}
        {!detail.confirmations.length ? <p className="text-sm text-text-muted">Not confirmed yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.confirmations.map((confirmation) => (
              <li key={confirmation.id} className="flex flex-col gap-1.5 py-3">
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">Revision {confirmation.version}{confirmation.current ? " — Current" : ""}</span>
                  <StatusBadge tone={confirmation.status === "acknowledged" ? "success" : confirmation.status === "sent" ? "info" : confirmation.status === "not_sent" ? "warning" : "neutral"}>{confirmation.statusLabel}</StatusBadge>
                  {confirmation.grand_total && <span className="tabular-nums text-text-secondary">{money(order.currency_code, confirmation.grand_total)}</span>}
                  {actions.print && (
                    <>
                      <a className="text-brand hover:underline" href={confirmationPdfUrl(confirmation.id, true)} target="_blank" rel="noreferrer">View PDF</a>
                      <a className="text-brand hover:underline" href={confirmationPdfUrl(confirmation.id)} download>Download</a>
                    </>
                  )}
                </span>
                <span className="text-text-secondary">Confirmed {dateTime(confirmation.confirmed_at)}{confirmation.confirmed_by_name ? ` by ${confirmation.confirmed_by_name}` : ""}</span>
                {confirmation.variance_reason && <span className="text-text-secondary">Differs from quotation {confirmation.quotation_variance?.quotationNumber ?? ""}: {confirmation.variance_reason}</span>}
                {confirmation.sends.map((send) => (
                  <span key={send.id} className="text-text-secondary">
                    Sent {dateTime(send.sent_at)} · {send.channelLabel}{send.recipients ? ` to ${send.recipients}` : ""}{send.sent_by_name ? ` · by ${send.sent_by_name}` : ""}{send.note ? ` · ${send.note}` : ""}
                  </span>
                ))}
                {confirmation.acknowledged_at && (
                  <span className="text-success">Acknowledged {dateTime(confirmation.acknowledged_at)}{confirmation.acknowledgement_reference ? ` · ${confirmation.acknowledgement_reference}` : ""}{confirmation.acknowledged_by_name ? ` · recorded by ${confirmation.acknowledged_by_name}` : ""}</span>
                )}
                {confirmation.superseded_at && (
                  <span className="text-text-muted">Superseded {dateTime(confirmation.superseded_at)}{confirmation.superseded_by_name ? ` by ${confirmation.superseded_by_name}` : ""}{confirmation.superseded_reason ? `: ${confirmation.superseded_reason}` : ""}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Related documents">
        <Facts items={[
          { label: "Quotation", value: order.source_quotation_id ? <Link className="text-brand hover:underline" href={`/sales/quotations/${order.source_quotation_id}`}>{order.source_quotation_number}</Link> : "None (direct order)" },
          { label: "Deliveries", value: detail.deliveries.length ? detail.deliveries.map((delivery) => delivery.delivery_number).join(", ") : "None" },
          { label: "Returns", value: detail.returns.length ? <span className="flex flex-wrap gap-2">{detail.returns.map((item) => <Link key={item.id} className="text-brand hover:underline" href={`/sales/returns/${item.id}`}>{item.return_number}</Link>)}</span> : "None" },
          { label: "Invoices", value: detail.invoices.length ? detail.invoices.map((invoice) => invoice.invoice_number).join(", ") : "None" },
          { label: "Credit notes", value: detail.creditNotes.length ? <span className="flex flex-wrap gap-2">{detail.creditNotes.map((credit) => <Link key={credit.id} className="text-brand hover:underline" href={`/sales/credit-notes/${credit.id}`}>{credit.invoice_number}</Link>)}</span> : "None" },
        ]} />
      </Panel>
    </div>
  );
}

function Related({ detail, tracking }: { detail: SalesOrderDetail; tracking?: OrderTracking }) {
  const order = detail.order;
  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* The documents the order led to come from the order tracking service: one source for this page, the list and the reports. */}
      {tracking && <RelatedDocuments tracking={tracking} />}
      <Panel title="Where it came from">
        <Facts items={[
          { label: "Customer", value: <Link className="text-brand hover:underline" href={`/sales/customers/${order.party_id}`}>{order.customer_snapshot?.displayName ?? "Open customer"}</Link> },
          { label: "Quotation", value: order.source_quotation_id ? <Link className="text-brand hover:underline" href={`/sales/quotations/${order.source_quotation_id}`}>{order.source_quotation_number}</Link> : "None (direct order)" },
          { label: "Opportunity", value: order.source_opportunity_id ? <Link className="text-brand hover:underline" href={`/crm/opportunities/${order.source_opportunity_id}`}>{[order.source_opportunity_code, order.source_opportunity_name].filter(Boolean).join(" · ")}</Link> : "None" },
        ]} />
      </Panel>
      <Panel title="Saved versions" description="Each save of the draft is kept.">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {detail.versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-2">
              <StatusBadge tone="neutral">{`v${version.version_number}`}</StatusBadge>
              <span className="tabular-nums">{money(version.currency_code?.trim(), version.grand_total)}</span>
              <span className="text-text-muted">{dateTime(version.created_at)}{version.created_by_name ? ` · ${version.created_by_name}` : ""}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Notes({ detail, orderId, canEdit, onChanged }: { detail: SalesOrderDetail; orderId: string; canEdit: boolean; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const order = detail.order;
  const key = scopedQueryKey(workspace, "sales", "order", orderId, "files");
  const query = useQuery({ queryKey: key, queryFn: () => listSalesOrderFiles(orderId).then((r) => r.files) });
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const filesChanged = () => { void queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadSalesOrderFile(orderId, file), onSuccess: filesChanged });
  const remove = useMutation({ mutationFn: (fileId: string) => removeSalesOrderFile(orderId, fileId), onSuccess: filesChanged });
  const save = useMutation({ mutationFn: () => addSalesOrderNote(orderId, note.trim()), onSuccess: () => { setNote(""); onChanged(); } });
  const notes = detail.events.filter((event) => event.event_type === "sales_order.note_added");
  return (
    <div className="flex flex-col gap-4 pt-4">
      <Panel title="Notes for the customer" description="Printed on the order confirmation."><p className="whitespace-pre-line text-sm">{order.customer_notes || "—"}</p></Panel>
      <Panel title="Terms and conditions" description="Printed on the order confirmation."><p className="whitespace-pre-line text-sm">{order.terms_and_conditions || "—"}</p></Panel>
      <Panel title="Internal notes" description="Never printed or sent to the customer.">
        {order.internal_notes && <p className="whitespace-pre-line text-sm">{order.internal_notes}</p>}
        {notes.length > 0 && (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {notes.map((event, index) => (
              <li key={event.id ?? index} className="flex flex-col gap-0.5 py-2">
                <span className="whitespace-pre-line">{String((event.metadata as Record<string, unknown> | null)?.note ?? "")}</span>
                <span className="text-xs text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {save.isError && <Notice>{failureText(save.error, "The note could not be saved.")}</Notice>}
        <TextArea aria-label="Note" placeholder="Add an internal note" value={note} onChange={setNote} />
        <div><Button variant="secondary" size="compact" isDisabled={!note.trim()} isLoading={save.isPending} onPress={() => save.mutate()}>Add note</Button></div>
      </Panel>
      <Panel title="Attachments" description="The customer's purchase order, an agreement or a drawing. Files are internal and never added to the order PDF."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-3.5" aria-hidden="true" />Add file</Button>
          </>
        ) : undefined}>
        {(upload.isError || remove.isError) && <Notice>{failureText(upload.error ?? remove.error, "The file could not be saved.")}</Notice>}
        {query.isLoading ? <p className="text-sm text-text-muted">Loading…</p> : !query.data?.length ? <p className="text-sm text-text-muted">No files.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {query.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={`/api/sales/orders/${orderId}/files/${file.id}`}>{file.fileName}</a>
                <span className="text-text-muted">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB · {dateTime(file.uploadedAt)}</span>
                {canEdit && <Button variant="ghost" size="compact" isLoading={remove.isPending && remove.variables === file.id} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function History({ detail }: { detail: SalesOrderDetail }) {
  return (
    <div className="flex flex-col gap-3 pt-4">
      <Panel title="History" description="Who did what, and when. Entries are never edited or removed.">
        <ol className="flex flex-col divide-y divide-border text-sm">
          {detail.events.map((event, index) => (
            <li key={event.id ?? index} className="flex flex-col gap-0.5 py-2">
              <span className="font-medium">{EVENT_LABELS[event.event_type] ?? statusLabel(event.event_type.replace("sales_order.", ""))}</span>
              {eventDetail(event) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event)}</span>}
              <span className="text-xs text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
