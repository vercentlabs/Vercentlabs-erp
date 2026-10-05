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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Check, Eye, FileText, Pencil, Send, Truck, Upload } from "lucide-react";
import {
  Button, EnterpriseDataGrid, ErrorState, LinkButton, MetricStrip, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, buttonVariants,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { StoredTotals, discountReasonLabel } from "@/features/sales/shared/DocumentDiscounts";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

import {
  addSalesOrderNote, confirmationPdfUrl, getSalesOrderAvailability, listSalesOrderFiles, getSalesOrder, orderPdfUrl, removeSalesOrderFile, reserveSalesOrderStock, uploadSalesOrderFile,
  type ConfirmResult, type ReservationOutcome, type SalesOrderDelivery, type SalesOrderDetail, type SalesOrderLine,
} from "../api/orders-api";
import { AcknowledgeConfirmationDialog, ConfirmOrderDialog, MarkConfirmationSentDialog, SendConfirmationDialog } from "../components/ConfirmationDialogs";
import {
  CancelOrderDialog, CancelRemainingDialog, CreateDeliveryDialog, CreateInvoiceDialog, DeliveryReceiptDialog, DeliveryShipmentDialog, ReleaseReservationDialog, ReopenOrderDialog,
  failureText,
} from "../components/OrderDialogs";
import { ConfirmationStatusBadge, FulfillmentStatusBadge, InvoicingStatusBadge, OrderStatusBadge } from "../components/OrderStatusBadges";

type Snapshot = Record<string, string | null | undefined> | null;
const addressText = (snapshot: Snapshot) =>
  snapshot ? [snapshot.label, snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postal_code].filter(Boolean).join(", "), snapshot.gstin ? `GSTIN ${snapshot.gstin}` : null]
    .filter(Boolean).join("\n") || "—" : "—";
const personName = (snapshot: Snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;
const quantity = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const withUnit = (value: number | string | null | undefined, unit: string | null) => `${quantity(value)}${unit ? ` ${unit}` : ""}`;

type DialogKind = "confirm" | "reopen" | "cancel" | "cancelRemaining" | "delivery" | "invoice" | "release" | "email" | "markSent" | "acknowledge" | null;

const EVENT_LABELS: Record<string, string> = {
  "sales_order.created": "Created", "sales_order.updated": "Draft saved", "sales_order.confirmed": "Confirmed", "sales_order.reconfirmed": "Reconfirmed", "sales_order.reopened": "Reopened to draft",
  "sales_order.confirmation_refused": "Confirmation refused", "sales_order.confirmation_created": "Order Confirmation recorded", "sales_order.confirmation_superseded": "Order Confirmation superseded",
  "sales_order.confirmation_marked_sent": "Order Confirmation marked as sent", "sales_order.confirmation_acknowledged": "Customer acknowledged the confirmation",
  "sales_order.cancelled": "Cancelled", "sales_order.quantity_cancelled": "Remaining quantity cancelled", "sales_order.stock_reserved": "Stock reserved",
  "sales_order.stock_released": "Reservation released", "sales_order.delivery_created": "Delivery created", "sales_order.shipped": "Shipment recorded",
  "sales_order.delivery_received": "Received by the customer", "sales_order.invoice_created": "Invoice created", "sales_order.confirmation_sent": "Order Confirmation sent",
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
  const queryClient = useQueryClient();
  const key = scopedQueryKey(workspace, "sales", "order", orderId);
  const query = useQuery({ queryKey: key, queryFn: () => getSalesOrder(orderId).then((r) => r.order) });
  const [tab, setTab] = useState("overview");
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
    mutationFn: () => reserveSalesOrderStock(orderId),
    onSuccess: ({ result }) => {
      const short = shortOf(result.lines);
      done(short.length ? `Reserved what is available.\n${short.join("\n")}` : result.reservedLines ? "Stock is reserved." : "There was nothing more to reserve.");
    },
    onError: fail("The stock could not be reserved."),
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

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/orders" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All sales orders
      </Link>
      {error && <SalesAlert>{error}</SalesAlert>}
      {notice && <SalesAlert tone="info" className="whitespace-pre-line">{notice}</SalesAlert>}
      {order.status === "cancelled" && (
        <SalesAlert tone="warning">
          This order was cancelled{order.cancelled_at ? ` on ${dateTime(order.cancelled_at)}` : ""}{order.cancelled_by_name ? ` by ${order.cancelled_by_name}` : ""}.
          {" "}{[detail.cancelReasons.find((reason) => reason.code === order.cancel_reason_code)?.label, order.cancel_reason].filter(Boolean).join(": ")}
        </SalesAlert>
      )}
      {detail.duplicatePurchaseOrders.length > 0 && order.status !== "cancelled" && (
        <SalesAlert tone="warning">
          Customer PO {order.customer_po_number} is also on{" "}
          {detail.duplicatePurchaseOrders.map((other, index) => (
            <span key={other.id}>{index > 0 ? ", " : ""}<Link className="underline" href={`/sales/orders/${other.id}`}>{other.number}</Link></span>
          ))}. Check that this is not a duplicate order.
        </SalesAlert>
      )}

      <RecordDetailsPage
        header={{
          title: order.sales_order_number,
          status: (
            <span className="flex flex-wrap items-center gap-1.5">
              <OrderStatusBadge status={order.status} label={order.statusLabel} />
              {executing && order.confirmation !== "none" && <ConfirmationStatusBadge status={order.confirmation} label={order.confirmationLabel} />}
              {executing && <FulfillmentStatusBadge status={order.fulfillment} label={order.fulfillmentLabel} />}
              {executing && order.status !== "cancelled" && <InvoicingStatusBadge status={order.invoicing} label={order.invoicingLabel} />}
            </span>
          ),
          fields: [
            { label: "Customer", value: order.party_id ? <Link className="hover:underline" href={`/sales/customers/${order.party_id}`}>{order.customer_snapshot?.displayName ?? "—"}</Link> : "—" },
            { label: "Order date", value: calendarDate(order.order_date) },
            { label: "Customer PO", value: order.customer_po_number ?? "—" },
            { label: "Requested delivery", value: calendarDate(order.requested_delivery_date) },
            { label: "Total", value: money(currency, order.grand_total) },
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
              {executing && order.status !== "cancelled" && <Button variant="secondary" onPress={() => setTab("fulfillment")}>Check Availability</Button>}
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
        <MetricStrip
          metrics={[
            { label: "Subtotal", value: money(currency, order.subtotal) },
            { label: "Discount", value: money(currency, order.discount_total) },
            { label: "Tax", value: money(currency, order.tax_total) },
            { label: "Grand total", value: money(currency, order.grand_total) },
            ...(executing ? [{ label: "Invoiced", value: money(currency, detail.invoicing.invoicedValue) }] : []),
            ...(order.margin_percent !== undefined ? [{ label: "Margin", value: `${Number(order.margin_percent).toFixed(1)}%` }] : []),
          ]}
        />
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Sales order sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items ({detail.lines.length})</Tab>
            <Tab id="fulfillment">Fulfillment</Tab>
            <Tab id="invoices">Invoices ({detail.invoices.length})</Tab>
            <Tab id="confirmation">Confirmation</Tab>
            <Tab id="related">Related documents</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><Overview detail={detail} /></TabPanel>
          <TabPanel id="items"><Items detail={detail} /></TabPanel>
          <TabPanel id="fulfillment">
            <Fulfillment detail={detail} orderId={orderId} reserving={reserve.isPending} onReserve={() => reserve.mutate()} onRelease={() => setDialog("release")}
              onDeliver={() => setDialog("delivery")} onChanged={refresh} />
          </TabPanel>
          <TabPanel id="invoices"><Invoices detail={detail} onInvoice={() => setDialog("invoice")} /></TabPanel>
          <TabPanel id="confirmation">
            <Confirmation detail={detail} onSend={() => setDialog("email")} onMarkSent={() => setDialog("markSent")} onAcknowledge={() => setDialog("acknowledge")} />
          </TabPanel>
          <TabPanel id="related"><Related detail={detail} /></TabPanel>
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
      {dialog === "delivery" && <CreateDeliveryDialog orderId={orderId} number={order.sales_order_number} onClose={() => setDialog(null)} onDone={(number) => { setTab("fulfillment"); done(`Delivery ${number} was created.`); }} />}
      {dialog === "invoice" && (
        <CreateInvoiceDialog orderId={orderId} number={order.sales_order_number} currencyCode={currency} lines={detail.lines} onClose={() => setDialog(null)}
          onDone={(number) => { setTab("invoices"); done(`Invoice ${number} was created as a draft for Finance to post.`); }} />
      )}
      {dialog === "release" && <ReleaseReservationDialog orderId={orderId} onClose={() => setDialog(null)} onDone={() => done("The reserved stock was released.")} />}
      {dialog === "email" && (
        <SendConfirmationDialog orderId={orderId} number={order.sales_order_number} version={order.confirmation_version} contactName={personName(order.contact_snapshot)}
          contactEmail={order.contact_snapshot?.email ?? null} customerPo={order.customer_po_number} onClose={() => setDialog(null)} onDone={(sentTo) => done(`The Order Confirmation was sent to ${sentTo}.`)} />
      )}
    </div>
  );
}

function Overview({ detail }: { detail: SalesOrderDetail }) {
  const order = detail.order;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Customer">
        <SalesFacts items={[
          { label: "Customer", value: order.customer_snapshot?.displayName ?? "—" },
          { label: "Customer number", value: order.customer_snapshot?.customerNumber ?? order.customer_number ?? "—" },
          { label: "GSTIN", value: order.customer_snapshot?.gstin ?? "—" },
          { label: "Contact", value: [personName(order.contact_snapshot), order.contact_snapshot?.designation, order.contact_snapshot?.email, order.contact_snapshot?.phone ?? order.contact_snapshot?.mobile].filter(Boolean).join(" · ") || "—" },
          { label: "Bill to", value: <span className="whitespace-pre-line">{addressText(order.billing_address_snapshot)}</span> },
          { label: "Ship to", value: <span className="whitespace-pre-line">{addressText(order.shipping_address_snapshot)}</span> },
        ]} />
      </SalesPanel>
      <SalesPanel title="Order">
        <SalesFacts items={[
          { label: "Order date", value: calendarDate(order.order_date) },
          { label: "Customer PO", value: [order.customer_po_number, order.customer_po_date && `dated ${calendarDate(order.customer_po_date)}`].filter(Boolean).join(" ") || "—" },
          { label: "Customer reference", value: order.customer_reference ?? "—" },
          { label: "Requested delivery", value: calendarDate(order.requested_delivery_date) },
          { label: "Default warehouse", value: order.default_warehouse_name ?? "—" },
          { label: "Salesperson", value: order.owner_name ?? "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Commercial terms" description={order.source_quotation_id ? "Carried from the accepted quotation; quoted prices, discounts and tax are executed as agreed." : undefined}>
        <SalesFacts items={[
          { label: "Currency", value: order.currency_code },
          { label: "Price list", value: order.price_list_name ? `${order.price_list_name} (${order.price_list_tax_inclusive ? "tax inclusive" : "tax exclusive"})` : "None" },
          { label: "Payment terms", value: order.payment_term_snapshot?.name ?? "—" },
          { label: "Issued by", value: order.seller_snapshot?.name ? `${order.seller_snapshot.name}${order.seller_snapshot.gstin ? ` · GSTIN ${order.seller_snapshot.gstin}` : ""}` : "—" },
          { label: "Place of supply", value: order.place_of_supply
            ? `${order.place_of_supply_name ?? order.place_of_supply} (${order.place_of_supply})${order.place_of_supply_source === "override" ? ` · changed: ${order.place_of_supply_reason ?? ""}` : ""}`
            : "—" },
          { label: "GST", value: order.tax_treatment !== "taxable" ? "No tax charged" : ({ intra_state: "Within the state: CGST + SGST", inter_state: "Between states: IGST" } as Record<string, string>)[order.supply_nature ?? ""] ?? "—" },
          { label: "Additional discount", value: !Number(order.document_discount_amount) ? "None" : order.document_discount_type === "percent"
            ? `${Number(order.document_discount_value)}% (${money(order.currency_code, order.document_discount_amount)})` : money(order.currency_code, order.document_discount_amount) },
          { label: "Discount reason", value: discountReasonLabel(order.discount_reason_code, order.discount_reason_text) ?? "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Status history">
        <SalesFacts items={[
          { label: "Created", value: `${dateTime(order.created_at)}${order.created_by_name ? ` by ${order.created_by_name}` : ""}` },
          { label: "Confirmed", value: order.confirmed_at ? `${dateTime(order.confirmed_at)}${order.confirmed_by_name ? ` by ${order.confirmed_by_name}` : ""}` : "—" },
          { label: "Confirmation", value: order.confirmation === "none" ? "—" : `${order.confirmationLabel}${order.confirmation_version > 1 ? ` (revision ${order.confirmation_version})` : ""}` },
          { label: "Closed", value: order.closed_at ? dateTime(order.closed_at) : "—" },
          { label: "Cancelled", value: order.cancelled_at ? `${dateTime(order.cancelled_at)}${order.cancelled_by_name ? ` by ${order.cancelled_by_name}` : ""}` : "—" },
        ]} />
      </SalesPanel>
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
        <SalesPanel title="Tax breakdown">
          {detail.taxLines.length ? (
            <SalesFacts columns={2} items={detail.taxLines.map((tax) => ({ label: `${tax.label ?? tax.tax_type.toUpperCase()} ${Number(tax.rate)}% on ${money(currency, tax.taxable_amount)}`, value: money(currency, tax.tax_amount) }))} />
          ) : <p className="text-sm text-text-muted">No tax on this order.</p>}
        </SalesPanel>
        <SalesPanel title="Totals" description="Calculated by the server when the order was saved. Tax is posted by the invoice, not by the order.">
          <StoredTotals currencyCode={currency} document={order} taxLines={detail.taxLines} />
        </SalesPanel>
      </div>
    </div>
  );
}

function Fulfillment({ detail, orderId, reserving, onReserve, onRelease, onDeliver, onChanged }: {
  detail: SalesOrderDetail; orderId: string; reserving: boolean; onReserve: () => void; onRelease: () => void; onDeliver: () => void; onChanged: () => void;
}) {
  const workspace = useWorkspaceContext();
  const order = detail.order;
  const actions = detail.actions;
  const goods = detail.lines.filter((line) => !line.is_service);
  const [shipping, setShipping] = useState<SalesOrderDelivery | null>(null);
  const [receiving, setReceiving] = useState<SalesOrderDelivery | null>(null);
  // Stock on hand is read when asked for: it changes with every other order.
  const [checked, setChecked] = useState(false);
  const availability = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "availability"),
    queryFn: () => getSalesOrderAvailability(orderId).then((r) => r.availability),
    enabled: checked,
    staleTime: 0,
  });
  const stock = new Map((availability.data?.lines ?? []).map((line) => [line.lineId, line]));
  const columns: ColumnDef<SalesOrderLine, unknown>[] = [
    {
      id: "item", header: "Product",
      cell: ({ row }) => <span className="flex min-w-40 flex-col"><span className="font-medium">{row.original.item_name_snapshot}</span><span className="text-xs text-text-muted">{row.original.warehouse_name ?? (row.original.is_stock_tracked ? "No warehouse" : "Not stock tracked")}</span></span>,
    },
    { id: "ordered", header: "Ordered", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{withUnit(row.original.ordered_quantity, row.original.uom_snapshot)}</span> },
    { id: "reserved", header: "Reserved", cell: ({ row }) => <span className="tabular-nums">{row.original.is_stock_tracked ? quantity(row.original.reserved_quantity) : "—"}</span> },
    { id: "delivered", header: "Delivered", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.delivered_quantity)}</span> },
    { id: "cancelled", header: "Cancelled", cell: ({ row }) => <span className="tabular-nums">{row.original.cancelled_quantity ? quantity(row.original.cancelled_quantity) : ""}</span> },
    { id: "remaining", header: "Remaining", cell: ({ row }) => <span className="font-medium tabular-nums">{quantity(row.original.remaining_to_deliver)}</span> },
    ...(availability.data ? [
      { id: "onHand", header: "On hand", cell: ({ row }: { row: { original: SalesOrderLine } }) => <span className="tabular-nums">{stock.get(row.original.id)?.onHand != null ? quantity(stock.get(row.original.id)!.onHand) : "—"}</span> },
      { id: "elsewhere", header: "Reserved elsewhere", cell: ({ row }: { row: { original: SalesOrderLine } }) => <span className="tabular-nums">{stock.get(row.original.id)?.reservedElsewhere != null ? quantity(stock.get(row.original.id)!.reservedElsewhere) : "—"}</span> },
      { id: "available", header: "Available", cell: ({ row }: { row: { original: SalesOrderLine } }) => <span className="tabular-nums">{stock.get(row.original.id)?.available != null ? quantity(stock.get(row.original.id)!.available) : "—"}</span> },
      {
        id: "shortage", header: "Shortage",
        cell: ({ row }: { row: { original: SalesOrderLine } }) => {
          const line = stock.get(row.original.id);
          if (!line) return "";
          if (line.problem) return <span className="text-xs text-warning">{line.problem}</span>;
          return Number(line.shortage) > 0 ? <StatusBadge tone="danger">{`Short ${quantity(line.shortage)}`}</StatusBadge> : <StatusBadge tone="success">Available</StatusBadge>;
        },
      },
    ] as ColumnDef<SalesOrderLine, unknown>[] : []),
  ];
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Ordered, reserved and delivered"
        description={order.status === "draft" ? "Stock is reserved and delivered once the order is confirmed." : "Worked out from the reservations and deliveries themselves. Services are not delivered and are not listed here."}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="compact" isLoading={availability.isFetching} onPress={() => (checked ? void availability.refetch() : setChecked(true))}>Check Availability</Button>
            {actions.reserve && <Button variant="secondary" size="compact" isLoading={reserving} onPress={onReserve}>Reserve Stock</Button>}
            {actions.release && <Button variant="ghost" size="compact" onPress={onRelease}>Release Reservation</Button>}
            {actions.deliver && <Button variant="primary" size="compact" onPress={onDeliver}>Create Delivery</Button>}
          </div>
        )}>
        {availability.isError && <SalesAlert>{failureText(availability.error, "Availability could not be checked.")}</SalesAlert>}
        {availability.data && availability.data.shortages > 0 && <SalesAlert tone="warning">Stock is short on {availability.data.shortages} line(s). The order can still be confirmed and delivered in parts.</SalesAlert>}
        {goods.length ? <EnterpriseDataGrid<SalesOrderLine> aria-label="Fulfillment by line" columns={columns} data={goods} getRowId={(row) => row.id} state="ready" />
          : <p className="text-sm text-text-muted">This order has only services: there is nothing to reserve or deliver.</p>}
      </SalesPanel>
      <SalesPanel title="Deliveries" description="An order can be delivered in several parts. Stock is issued when a delivery is created.">
        {!detail.deliveries.length ? <p className="text-sm text-text-muted">No deliveries yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-col gap-1 py-2">
                <span className="flex flex-wrap items-center gap-3">
                  <span className="font-medium tabular-nums">{delivery.delivery_number}</span>
                  <span className="text-text-muted">{calendarDate(delivery.delivery_date)}{delivery.created_by_name ? ` · ${delivery.created_by_name}` : ""}</span>
                  {delivery.delivered_at ? <StatusBadge tone="success">Received</StatusBadge> : delivery.carrier ? <StatusBadge tone="info">Shipped</StatusBadge> : <StatusBadge tone="neutral">Delivered from stock</StatusBadge>}
                  {detail.capabilities.deliver && !delivery.delivered_at && (
                    <>
                      <Button variant="ghost" size="compact" onPress={() => setShipping(delivery)}>{delivery.carrier ? "Change shipment" : "Record shipment"}</Button>
                      <Button variant="ghost" size="compact" onPress={() => setReceiving(delivery)}>Mark received</Button>
                    </>
                  )}
                </span>
                <span className="text-text-secondary">{delivery.lines.map((line) => `${line.item_name_snapshot} × ${withUnit(line.quantity, line.uom_snapshot)}`).join(", ")}</span>
                {(delivery.carrier || delivery.delivered_at || delivery.notes) && (
                  <span className="text-xs text-text-muted">
                    {[delivery.carrier && `Carrier ${delivery.carrier}${delivery.tracking_number ? ` · ${delivery.tracking_number}` : ""}`,
                      delivery.delivered_at && `Received ${dateTime(delivery.delivered_at)}${delivery.received_by ? ` by ${delivery.received_by}` : ""}`, delivery.notes].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
      {shipping && <DeliveryShipmentDialog delivery={shipping} onClose={() => setShipping(null)} onDone={() => { setShipping(null); onChanged(); }} />}
      {receiving && <DeliveryReceiptDialog delivery={receiving} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); onChanged(); }} />}
    </div>
  );
}

function Invoices({ detail, onInvoice }: { detail: SalesOrderDetail; onInvoice: () => void }) {
  const order = detail.order;
  const currency = order.currency_code;
  const columns: ColumnDef<SalesOrderLine, unknown>[] = [
    { id: "item", header: "Product / service", cell: ({ row }) => <span className="font-medium">{row.original.item_name_snapshot}</span> },
    { id: "ordered", header: "Ordered", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{withUnit(row.original.ordered_quantity, row.original.uom_snapshot)}</span> },
    { id: "delivered", header: "Delivered", cell: ({ row }) => <span className="tabular-nums">{row.original.is_service ? "—" : quantity(row.original.delivered_quantity)}</span> },
    { id: "invoiced", header: "Invoiced", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.invoiced_quantity)}</span> },
    { id: "cancelled", header: "Cancelled", cell: ({ row }) => <span className="tabular-nums">{row.original.cancelled_quantity ? quantity(row.original.cancelled_quantity) : ""}</span> },
    { id: "remaining", header: "Remaining to invoice", cell: ({ row }) => <span className="font-medium tabular-nums">{quantity(row.original.remaining_to_invoice)}</span> },
  ];
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Invoiced value" description="Payment is recorded against each invoice by Finance, not against the order."
        actions={detail.actions.invoice ? <Button variant="primary" size="compact" onPress={onInvoice}>Create Invoice</Button> : undefined}>
        <SalesFacts items={[
          { label: "Ordered value", value: money(currency, detail.invoicing.orderedValue) },
          { label: "Invoiced value", value: money(currency, detail.invoicing.invoicedValue) },
          { label: "Remaining to invoice", value: money(currency, detail.invoicing.remainingValue) },
        ]} />
      </SalesPanel>
      <SalesPanel title="Invoices" description="An order can be invoiced in several parts. Each invoice bills its quantity with the discount and tax in proportion.">
        {!detail.invoices.length ? <p className="text-sm text-text-muted">No invoices yet.</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-3 py-2">
                {detail.capabilities.invoice
                  ? <Link className="font-medium text-brand tabular-nums hover:underline" href="/accounting/customer-invoices">{invoice.invoice_number}</Link>
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
      </SalesPanel>
      <SalesPanel title="Invoiced by line">
        <EnterpriseDataGrid<SalesOrderLine> aria-label="Invoicing by line" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready" />
      </SalesPanel>
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
      <SalesPanel title="Order Confirmation"
        description="The Order Confirmation is this order's own number, as confirmed. Each confirmation is kept unchanged; reopening the order supersedes it and confirming again makes the next revision. Sending it never changes the order's status, and delivery and invoicing never wait for an acknowledgement."
        actions={(
          <div className="flex flex-wrap gap-2">
            {actions.sendConfirmation && <Button variant="primary" size="compact" onPress={onSend}>Send Confirmation</Button>}
            {actions.markConfirmationSent && <Button variant="secondary" size="compact" onPress={onMarkSent}>Mark as Sent</Button>}
            {actions.acknowledgeConfirmation && <Button variant="secondary" size="compact" onPress={onAcknowledge}>Record Acknowledgement</Button>}
          </div>
        )}>
        {order.status === "draft" && <SalesAlert tone="info">{detail.confirmations.length ? "The order was reopened: its earlier confirmation is superseded. Confirm the order again to issue the next revision." : "The order is a draft: it has no Order Confirmation until it is confirmed."}</SalesAlert>}
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
      </SalesPanel>
      <SalesPanel title="Related documents">
        <SalesFacts items={[
          { label: "Quotation", value: order.source_quotation_id ? <Link className="text-brand hover:underline" href={`/sales/quotations/${order.source_quotation_id}`}>{order.source_quotation_number}</Link> : "None (direct order)" },
          { label: "Deliveries", value: detail.deliveries.length ? detail.deliveries.map((delivery) => delivery.delivery_number).join(", ") : "None" },
          { label: "Invoices", value: detail.invoices.length ? detail.invoices.map((invoice) => invoice.invoice_number).join(", ") : "None" },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Related({ detail }: { detail: SalesOrderDetail }) {
  const order = detail.order;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Related documents">
        <SalesFacts items={[
          { label: "Customer", value: <Link className="text-brand hover:underline" href={`/sales/customers/${order.party_id}`}>{order.customer_snapshot?.displayName ?? "Open customer"}</Link> },
          { label: "Quotation", value: order.source_quotation_id ? <Link className="text-brand hover:underline" href={`/sales/quotations/${order.source_quotation_id}`}>{order.source_quotation_number}</Link> : "None (direct order)" },
          { label: "Opportunity", value: order.source_opportunity_id ? <Link className="text-brand hover:underline" href={`/crm/opportunities/${order.source_opportunity_id}`}>{[order.source_opportunity_code, order.source_opportunity_name].filter(Boolean).join(" · ")}</Link> : "None" },
          { label: "Deliveries", value: detail.deliveries.length ? detail.deliveries.map((delivery) => delivery.delivery_number).join(", ") : "None" },
          { label: "Invoices", value: detail.invoices.length ? detail.invoices.map((invoice) => invoice.invoice_number).join(", ") : "None" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Saved versions" description="Each save of the draft is kept.">
        <ul className="flex flex-col divide-y divide-border text-sm">
          {detail.versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-2">
              <StatusBadge tone="neutral">{`v${version.version_number}`}</StatusBadge>
              <span className="tabular-nums">{money(version.currency_code?.trim(), version.grand_total)}</span>
              <span className="text-text-muted">{dateTime(version.created_at)}{version.created_by_name ? ` · ${version.created_by_name}` : ""}</span>
            </li>
          ))}
        </ul>
      </SalesPanel>
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
      <SalesPanel title="Notes for the customer" description="Printed on the order confirmation."><p className="whitespace-pre-line text-sm">{order.customer_notes || "—"}</p></SalesPanel>
      <SalesPanel title="Terms and conditions" description="Printed on the order confirmation."><p className="whitespace-pre-line text-sm">{order.terms_and_conditions || "—"}</p></SalesPanel>
      <SalesPanel title="Internal notes" description="Never printed or sent to the customer.">
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
        {save.isError && <SalesAlert>{failureText(save.error, "The note could not be saved.")}</SalesAlert>}
        <TextArea aria-label="Note" placeholder="Add an internal note" value={note} onChange={setNote} />
        <div><Button variant="secondary" size="compact" isDisabled={!note.trim()} isLoading={save.isPending} onPress={() => save.mutate()}>Add note</Button></div>
      </SalesPanel>
      <SalesPanel title="Attachments" description="The customer's purchase order, an agreement or a drawing. Files are internal and never added to the order PDF."
        actions={canEdit ? (
          <>
            <input ref={input} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-3.5" aria-hidden="true" />Add file</Button>
          </>
        ) : undefined}>
        {(upload.isError || remove.isError) && <SalesAlert>{failureText(upload.error ?? remove.error, "The file could not be saved.")}</SalesAlert>}
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
      </SalesPanel>
    </div>
  );
}

function History({ detail }: { detail: SalesOrderDetail }) {
  return (
    <div className="flex flex-col gap-3 pt-4">
      <SalesPanel title="History" description="Who did what, and when. Entries are never edited or removed.">
        <ol className="flex flex-col divide-y divide-border text-sm">
          {detail.events.map((event, index) => (
            <li key={event.id ?? index} className="flex flex-col gap-0.5 py-2">
              <span className="font-medium">{EVENT_LABELS[event.event_type] ?? statusLabel(event.event_type.replace("sales_order.", ""))}</span>
              {eventDetail(event) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event)}</span>}
              <span className="text-xs text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
            </li>
          ))}
        </ol>
      </SalesPanel>
    </div>
  );
}
