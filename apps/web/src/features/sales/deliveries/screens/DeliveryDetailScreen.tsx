"use client";

// One delivery: the header with its status and the actions open to the caller
// now (the server decides them and checks each again), then the customer and
// ship-to, the items, the shipment, its invoices, the documents it relates
// to, instructions, notes and proof of delivery, and the history. A Draft is
// edited; Ready waits for the warehouse; Dispatch issues the stock; a
// dispatched delivery is never cancelled (goods come back by a sales return).
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Check, FileText, MapPin, Pencil, Printer, Truck, Upload } from "lucide-react";
import {
  Button, EnterpriseDataGrid, ErrorState, PermissionState, RecordDetailsPage, StatusBadge, Tab, TabList, TabPanel, Tabs, buttonVariants,
} from "@vercentlabs/design-system";

import { useCreateRequest } from "@/features/sales/shared/use-create-request";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import type { SalesDocumentEvent } from "@/features/sales/quotations/api/quotations-api";

import {
  deliveryFileUrl, deliveryNotePdfUrl, getDelivery, listDeliveryFiles, markDeliveryReady, removeDeliveryFile, returnDeliveryToDraft, uploadDeliveryFile,
  type DeliveryDetail, type DeliveryLine,
} from "../api/deliveries-api";
import {
  CancelDeliveryDialog, ChangeAddressDialog, ChangeWarehouseDialog, DispatchDialog, EditDeliveryDialog, MarkDeliveredDialog, ShipmentDialog, failureText,
} from "../components/DeliveryDialogs";
import { DeliveryInvoicingBadge, DeliveryStatusBadge } from "../components/DeliveryStatusBadge";
import { DeliveryInvoiceDialog } from "@/features/sales/invoices/components/InvoiceDialogs";
import { CreateReturnDialog } from "@/features/sales/returns/components/ReturnDialogs";

type Snapshot = Record<string, string | null | undefined> | null;
const addressText = (snapshot: Snapshot) =>
  snapshot ? [snapshot.label, snapshot.line1, snapshot.line2, [snapshot.city, snapshot.state, snapshot.postal_code].filter(Boolean).join(", "), snapshot.gstin ? `GSTIN ${snapshot.gstin}` : null]
    .filter(Boolean).join("\n") || "—" : "—";
const personName = (snapshot: Snapshot) => [snapshot?.first_name, snapshot?.last_name].filter(Boolean).join(" ") || null;
const quantity = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const withUnit = (value: number | string | null | undefined, unit: string | null) => `${quantity(value)}${unit ? ` ${unit}` : ""}`;
const by = (at: string | null, name: string | null) => (at ? `${dateTime(at)}${name ? ` by ${name}` : ""}` : "—");

type DialogKind = "edit" | "address" | "warehouse" | "dispatch" | "delivered" | "cancel" | "shipment" | "invoice" | "return" | null;

const EVENT_LABELS: Record<string, string> = {
  "sales_delivery.created": "Created", "sales_delivery.updated": "Changed", "sales_delivery.ready": "Ready to dispatch", "sales_delivery.returned_to_draft": "Back to draft",
  "sales_delivery.dispatched": "Dispatched", "sales_delivery.delivered": "Delivered", "sales_delivery.cancelled": "Cancelled", "sales_delivery.shipment_updated": "Shipment updated",
  "sales_delivery.warehouse_changed": "Warehouse changed", "sales_delivery.invoiced": "Invoiced", "sales_delivery.file_added": "Proof of delivery added",
  "sales_delivery.file_removed": "File removed",
};
const FIELD_LABELS: Record<string, string> = {
  expectedDeliveryDate: "Expected delivery", deliveryInstructions: "Delivery instructions", internalNotes: "Internal notes", packageCount: "Packages", packageNotes: "Package details",
  carrier: "Carrier", trackingNumber: "Tracking number", trackingUrl: "Tracking link", vehicleReference: "Vehicle",
};
function eventDetail(event: SalesDocumentEvent) {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof m[key] === "string" && m[key] ? String(m[key]) : null);
  const lines = Array.isArray(m.lines)
    ? (m.lines as Array<Record<string, unknown>>).map((line) => `${line.item ?? ""} × ${quantity(line.quantity as number)}${line.unit ? ` ${line.unit}` : ""}`).join(", ")
    : null;
  const changes = Array.isArray(m.changes)
    ? (m.changes as Array<Record<string, unknown>>).map((change) =>
        `${FIELD_LABELS[String(change.what)] ?? change.what}: ${change.from ?? "none"} → ${change.to ?? "none"}${change.reason ? ` (${change.reason})` : ""}`).join("\n")
    : null;
  const stock = Array.isArray(m.stock)
    ? (m.stock as Array<Record<string, unknown>>).map((entry) => {
        const reservations = (entry.reservations as Array<Record<string, unknown>> | undefined) ?? [];
        const reserved = reservations.reduce((total, used) => total + Number(used.quantity ?? 0), 0);
        return `${entry.item}: ${quantity(reserved)} from reservations${Number(entry.fromFreeStock) ? `, ${quantity(entry.fromFreeStock as number)} from free stock` : ""}`;
      }).join("\n")
    : null;
  return [
    text("orderNumber"), lines, changes, stock, text("dispatchDate") && `Dispatch date ${calendarDate(text("dispatchDate"))}`,
    text("carrier") && `Carrier ${text("carrier")}${text("trackingNumber") ? ` · ${text("trackingNumber")}` : ""}`, text("receivedBy") && `Received by ${text("receivedBy")}`,
    text("from") && text("to") && `${text("from")} → ${text("to")}`, text("invoiceNumber"), text("fileName"), text("note"), text("reason"), m.automatic ? "With its order" : null,
  ].filter(Boolean).join(" · ");
}

export function DeliveryDetailScreen({ deliveryId }: { deliveryId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const key = scopedQueryKey(workspace, "sales", "delivery", deliveryId);
  const query = useQuery({ queryKey: key, queryFn: () => getDelivery(deliveryId).then((r) => r.delivery) });
  const [tab, setTab] = useState("overview");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "deliveries") });
    if (query.data) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "order", query.data.delivery.sales_order_id) });
  };
  const done = (message?: string) => { setDialog(null); setNotice(message ?? null); refresh(); };
  const fail = (fallback: string) => (failure: unknown) => setError(failureText(failure, fallback));
  const ready = useMutation({ mutationFn: () => markDeliveryReady(deliveryId, query.data?.delivery.version), onSuccess: () => done("The delivery is ready to dispatch."), onError: fail("The delivery could not be marked ready.") });
  const backToDraft = useMutation({ mutationFn: () => returnDeliveryToDraft(deliveryId, query.data?.delivery.version), onSuccess: () => done(), onError: fail("The delivery could not go back to draft.") });

  // From Sales → + Create: open the requested dialog when this delivery allows it.
  useCreateRequest(Boolean(query.data), (kind) => {
    const actions = query.data?.actions;
    if (kind === "return") { if (actions?.createReturn) setDialog("return"); else setNotice("Nothing more can be returned from this delivery."); }
    if (kind === "invoice") { if (actions?.createInvoice) setDialog("invoice"); else setNotice("Nothing on this delivery can be invoiced now."); }
  });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>;
  if (query.isError && query.error instanceof SalesApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to deliveries" description="Ask an administrator for the View deliveries permission." />;
  if (query.isError || !query.data)
    return <ErrorState title={query.error instanceof SalesApiError && query.error.status === 404 ? "Delivery not found" : "Could not load this delivery"}
      action={{ label: "Retry", onPress: () => query.refetch() }} />;

  const detail = query.data;
  const delivery = detail.delivery;
  const actions = detail.actions;
  const invoiceIsPrimary = !actions.markReady && !actions.dispatch && !actions.markDelivered;
  const primary = actions.markReady ? <Button variant="primary" isLoading={ready.isPending} onPress={() => ready.mutate()}><Check className="size-4" aria-hidden="true" />Mark Ready</Button>
    : actions.dispatch ? <Button variant="primary" onPress={() => setDialog("dispatch")}><Truck className="size-4" aria-hidden="true" />Dispatch</Button>
      : actions.markDelivered ? <Button variant="primary" onPress={() => setDialog("delivered")}><Check className="size-4" aria-hidden="true" />Mark Delivered</Button>
        : actions.createInvoice ? <Button variant="primary" onPress={() => setDialog("invoice")}><FileText className="size-4" aria-hidden="true" />Create Invoice</Button>
          : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/deliveries" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All deliveries
      </Link>
      {error && <SalesAlert>{error}</SalesAlert>}
      {notice && <SalesAlert tone="info" className="whitespace-pre-line">{notice}</SalesAlert>}
      {delivery.status === "cancelled" && (
        <SalesAlert tone="warning">
          This delivery was cancelled {by(delivery.cancelled_at, delivery.cancelled_by_name)}.{delivery.cancel_reason ? ` ${delivery.cancel_reason}` : ""}
        </SalesAlert>
      )}
      {["draft", "ready"].includes(delivery.status) && delivery.order_status !== "confirmed" && (
        <SalesAlert tone="warning">The order is no longer confirmed, so this delivery cannot be dispatched.</SalesAlert>
      )}

      <RecordDetailsPage
        header={{
          title: delivery.request_number,
          status: (
            <span className="flex flex-wrap items-center gap-1.5">
              <DeliveryStatusBadge status={delivery.status} label={delivery.statusLabel} />
              {["dispatched", "delivered"].includes(delivery.status) && <DeliveryInvoicingBadge status={delivery.invoicing} label={delivery.invoicingLabel} />}
            </span>
          ),
          fields: [
            { label: "Customer", value: delivery.party_id ? <Link className="hover:underline" href={`/sales/customers/${delivery.party_id}`}>{delivery.customer_snapshot?.displayName ?? "—"}</Link> : "—" },
            { label: "Sales order", value: <Link className="hover:underline" href={`/sales/orders/${delivery.sales_order_id}`}>{delivery.sales_order_number}</Link> },
            { label: "Warehouse", value: delivery.warehouse_name ?? "—" },
            { label: "Dispatch date", value: delivery.dispatch_date ? calendarDate(delivery.dispatch_date) : "—" },
            { label: "Expected delivery", value: delivery.expected_delivery_date ? calendarDate(delivery.expected_delivery_date) : "—" },
            { label: "Shipment", value: delivery.shipment },
          ],
          primaryAction: primary,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              {actions.edit && <Button variant="secondary" onPress={() => setDialog("edit")}><Pencil className="size-4" aria-hidden="true" />Edit</Button>}
              {actions.markReady && actions.dispatch && <Button variant="secondary" onPress={() => setDialog("dispatch")}><Truck className="size-4" aria-hidden="true" />Dispatch</Button>}
              {actions.changeAddress && <Button variant="secondary" onPress={() => setDialog("address")}><MapPin className="size-4" aria-hidden="true" />Change Address</Button>}
              {actions.changeWarehouse && <Button variant="secondary" onPress={() => setDialog("warehouse")}>Change Warehouse</Button>}
              {actions.editShipment && <Button variant="secondary" onPress={() => setDialog("shipment")}>Shipment Details</Button>}
              {actions.createInvoice && !invoiceIsPrimary && <Button variant="secondary" onPress={() => setDialog("invoice")}><FileText className="size-4" aria-hidden="true" />Create Invoice</Button>}
              {actions.createReturn && <Button variant="secondary" onPress={() => setDialog("return")}>Create Return</Button>}
              {actions.print && <a className={buttonVariants({ variant: "secondary" })} href={deliveryNotePdfUrl(deliveryId, true)} target="_blank" rel="noreferrer"><Printer className="size-4" aria-hidden="true" />Delivery Note</a>}
              {actions.backToDraft && <Button variant="ghost" isLoading={backToDraft.isPending} onPress={() => backToDraft.mutate()}>Back to Draft</Button>}
              {actions.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel Delivery</Button>}
            </div>
          ),
        }}
      >
        <Tabs selectedKey={tab} onSelectionChange={(selected) => setTab(String(selected))}>
          <TabList aria-label="Delivery sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="items">Items ({detail.lines.length})</Tab>
            <Tab id="shipment">Shipment</Tab>
            <Tab id="invoice">Invoice</Tab>
            <Tab id="related">Related</Tab>
            <Tab id="notes">Notes &amp; attachments</Tab>
            <Tab id="history">History</Tab>
          </TabList>
          <TabPanel id="overview"><Overview detail={detail} /></TabPanel>
          <TabPanel id="items"><Items detail={detail} /></TabPanel>
          <TabPanel id="shipment"><Shipment detail={detail} /></TabPanel>
          <TabPanel id="invoice"><Invoice detail={detail} onInvoice={() => setDialog("invoice")} /></TabPanel>
          <TabPanel id="related"><Related detail={detail} /></TabPanel>
          <TabPanel id="notes"><Notes detail={detail} onChanged={refresh} /></TabPanel>
          <TabPanel id="history"><History detail={detail} /></TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialog === "edit" && <EditDeliveryDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The delivery was saved.")} />}
      {dialog === "address" && <ChangeAddressDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The ship-to details were changed.")} />}
      {dialog === "warehouse" && <ChangeWarehouseDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The delivery now ships from the new warehouse.")} />}
      {dialog === "dispatch" && <DispatchDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The delivery was dispatched and its stock issued.")} />}
      {dialog === "delivered" && <MarkDeliveredDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The delivery is marked delivered.")} />}
      {dialog === "cancel" && <CancelDeliveryDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The delivery was cancelled.")} />}
      {dialog === "shipment" && <ShipmentDialog detail={detail} onClose={() => setDialog(null)} onDone={() => done("The shipment details were saved.")} />}
      {dialog === "return" && (
        <CreateReturnDialog deliveryId={deliveryId} number={delivery.request_number} onClose={() => setDialog(null)} onDone={(returnId) => { refresh(); router.push(`/sales/returns/${returnId}`); }} />
      )}
      {dialog === "invoice" && (
        <DeliveryInvoiceDialog deliveryId={deliveryId} number={delivery.request_number} lines={detail.lines} onClose={() => setDialog(null)}
          onDone={(invoiceId) => { refresh(); router.push(`/sales/invoices/${invoiceId}`); }} />
      )}
    </div>
  );
}

function Overview({ detail }: { detail: DeliveryDetail }) {
  const delivery = detail.delivery;
  const contact = delivery.contact_snapshot;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Customer and ship-to">
        <SalesFacts items={[
          { label: "Customer", value: delivery.customer_snapshot?.displayName ?? "—" },
          { label: "Customer number", value: delivery.customer_snapshot?.customerNumber ?? delivery.customer_number ?? "—" },
          { label: "Customer PO", value: delivery.customer_po_number ?? "—" },
          { label: "Ship to", value: <span className="whitespace-pre-line">{addressText(delivery.shipping_address_snapshot)}</span> },
          { label: "Contact", value: [personName(contact), contact?.phone ?? contact?.mobile, contact?.email].filter(Boolean).join(" · ") || "—" },
          { label: "Salesperson", value: delivery.owner_name ?? "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Delivery">
        <SalesFacts items={[
          { label: "Status", value: delivery.statusLabel },
          { label: "Warehouse", value: delivery.warehouse_name ?? "—" },
          { label: "Items", value: `${delivery.line_count} line(s) · ${quantity(delivery.total_quantity)} in all` },
          { label: "Requested by the customer", value: delivery.requested_delivery_date ? calendarDate(delivery.requested_delivery_date) : "—" },
          { label: "Expected delivery", value: delivery.expected_delivery_date ? calendarDate(delivery.expected_delivery_date) : "—" },
          { label: "Invoicing", value: ["dispatched", "delivered"].includes(delivery.status) ? delivery.invoicingLabel : "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Status history">
        <SalesFacts items={[
          { label: "Created", value: by(delivery.requested_at, delivery.created_by_name) },
          { label: "Ready to dispatch", value: by(delivery.ready_at, delivery.ready_by_name) },
          { label: "Dispatched", value: by(delivery.dispatched_at, delivery.dispatched_by_name) },
          { label: "Delivered", value: delivery.delivered_at ? `${dateTime(delivery.delivered_at)}${delivery.received_by ? ` · received by ${delivery.received_by}` : ""}` : "—" },
          { label: "Cancelled", value: by(delivery.cancelled_at, delivery.cancelled_by_name) },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Items({ detail }: { detail: DeliveryDetail }) {
  const shipped = ["dispatched", "delivered"].includes(detail.delivery.status);
  const columns: ColumnDef<DeliveryLine, unknown>[] = [
    { id: "seq", header: "#", cell: ({ row }) => row.original.sequence ?? "" },
    {
      id: "item", header: "Product",
      cell: ({ row }) => (
        <span className="flex min-w-48 flex-col">
          <span className="font-medium">{row.original.item_name_snapshot}</span>
          <span className="text-xs text-text-muted">{[row.original.item_code_snapshot, !row.original.warehouse_id && "Not stock tracked"].filter(Boolean).join(" · ")}</span>
        </span>
      ),
    },
    { id: "ordered", header: "Ordered", cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{withUnit(row.original.ordered_now, row.original.uom_snapshot)}</span> },
    { id: "quantity", header: "This delivery", cell: ({ row }) => <span className="font-medium whitespace-nowrap tabular-nums">{withUnit(row.original.quantity, row.original.uom_snapshot)}</span> },
    { id: "delivered", header: "Delivered on the order", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.delivered_now)}</span> },
    { id: "remaining", header: "Left to deliver", cell: ({ row }) => <span className="tabular-nums">{quantity(row.original.remaining_now)}</span> },
    {
      id: "stock", header: "Stock",
      cell: ({ row }) => !row.original.warehouse_id ? "" : shipped
        ? <span className="text-xs">{row.original.consumed_reservations.length ? `Issued from ${row.original.consumed_reservations.map((used) => used.reservation ?? "free stock").join(", ")}` : "Issued"}</span>
        : <span className="text-xs text-text-muted">Reserved {quantity(row.original.reserved_now)}</span>,
    },
    { id: "returned", header: "Returned", cell: ({ row }) => shipped && row.original.returned_quantity ? <span className="tabular-nums">{quantity(row.original.returned_quantity)}</span> : "" },
    { id: "invoiced", header: "Invoiced", cell: ({ row }) => shipped ? <span className="tabular-nums">{quantity(row.original.invoiced_quantity)}</span> : "" },
  ];
  return (
    <div className="pt-4">
      <EnterpriseDataGrid<DeliveryLine> aria-label="Delivery items" columns={columns} data={detail.lines} getRowId={(row) => row.id} state="ready"
        renderMobileCard={(line) => (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{line.item_name_snapshot}</span>
            <span className="text-sm tabular-nums">{withUnit(line.quantity, line.uom_snapshot)}</span>
          </div>
        )} />
    </div>
  );
}

function Shipment({ detail }: { detail: DeliveryDetail }) {
  const delivery = detail.delivery;
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Shipment">
        <SalesFacts items={[
          { label: "Carrier / transporter", value: delivery.carrier ?? "—" },
          {
            label: "Tracking", value: delivery.tracking_url
              ? <a className="text-brand hover:underline" href={delivery.tracking_url} target="_blank" rel="noreferrer noopener">{delivery.tracking_number ?? "Track the shipment"}</a>
              : delivery.tracking_number ?? "—",
          },
          { label: "Vehicle", value: delivery.vehicle_reference ?? "—" },
          { label: "Dispatch date", value: delivery.dispatch_date ? calendarDate(delivery.dispatch_date) : "—" },
          { label: "Expected delivery", value: delivery.expected_delivery_date ? calendarDate(delivery.expected_delivery_date) : "—" },
          { label: "Packages", value: [delivery.package_count != null ? String(delivery.package_count) : null, delivery.package_notes].filter(Boolean).join(" · ") || "—" },
          { label: "Received by", value: delivery.received_by ?? "—" },
          { label: "Delivery note", value: delivery.delivery_note ?? "—" },
        ]} />
      </SalesPanel>
      <SalesPanel title="Stock movements" description="Stock is issued when the delivery is dispatched, from what is reserved for the order first.">
        {!detail.stockMovements.length ? <p className="text-sm text-text-muted">{["draft", "ready"].includes(delivery.status) ? "No stock moves until the delivery is dispatched." : "No stock-tracked items on this delivery."}</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.stockMovements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium tabular-nums">{movement.movement_number ?? "Issue"}</span>
                <span>{movement.item_name} × {quantity(Math.abs(Number(movement.quantity)))}</span>
                <span className="text-text-muted">{[movement.warehouse_name, movement.location_code].filter(Boolean).join(" · ")} · {dateTime(movement.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
    </div>
  );
}

function Invoice({ detail, onInvoice }: { detail: DeliveryDetail; onInvoice: () => void }) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Invoices" description="Each invoice line records the delivery line it bills; a delivery is never invoiced beyond what it delivered."
        actions={detail.actions.createInvoice ? <Button variant="primary" size="compact" onPress={onInvoice}>Create Invoice</Button> : undefined}>
        {!detail.invoices.length ? <p className="text-sm text-text-muted">{["dispatched", "delivered"].includes(detail.delivery.status) ? "Not invoiced yet." : "A delivery is invoiced once it is dispatched."}</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {detail.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link className="font-medium text-brand tabular-nums hover:underline" href={`/sales/invoices/${invoice.id}`}>{invoice.invoice_number}</Link>
                <StatusBadge tone={statusTone(invoice.status)}>{statusLabel(invoice.status)}</StatusBadge>
                <span className="text-text-muted">{calendarDate(invoice.invoice_date)}</span>
                <span className="tabular-nums">{money(invoice.currency_code, invoice.grand_total)}</span>
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
    </div>
  );
}

function Related({ detail }: { detail: DeliveryDetail }) {
  const delivery = detail.delivery;
  return (
    <div className="pt-4">
      <SalesPanel title="Related documents">
        <SalesFacts items={[
          { label: "Sales order", value: <Link className="text-brand hover:underline" href={`/sales/orders/${delivery.sales_order_id}`}>{delivery.sales_order_number}</Link> },
          { label: "Quotation", value: delivery.source_quotation_id ? <Link className="text-brand hover:underline" href={`/sales/quotations/${delivery.source_quotation_id}`}>{delivery.source_quotation_number}</Link> : "—" },
          { label: "Customer", value: delivery.party_id ? <Link className="text-brand hover:underline" href={`/sales/customers/${delivery.party_id}`}>{delivery.customer_snapshot?.displayName ?? "Customer"}</Link> : "—" },
          { label: "Invoices", value: detail.invoices.length ? detail.invoices.map((invoice) => invoice.invoice_number).join(", ") : "None" },
          { label: "Returns", value: detail.returns.length ? <span className="flex flex-wrap gap-2">{detail.returns.map((item) => <Link key={item.id} className="text-brand hover:underline" href={`/sales/returns/${item.id}`}>{item.return_number}</Link>)}</span> : "None" },
          { label: "Stock movements", value: detail.stockMovements.length ? detail.stockMovements.map((movement) => movement.movement_number ?? "Issue").join(", ") : "None" },
        ]} />
      </SalesPanel>
    </div>
  );
}

function Notes({ detail, onChanged }: { detail: DeliveryDetail; onChanged: () => void }) {
  const workspace = useWorkspaceContext();
  const delivery = detail.delivery;
  const filesKey = scopedQueryKey(workspace, "sales", "delivery", delivery.id, "files");
  const files = useQuery({ queryKey: filesKey, queryFn: () => listDeliveryFiles(delivery.id).then((r) => r.files) });
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const after = () => { setError(null); void queryClient.invalidateQueries({ queryKey: filesKey }); onChanged(); };
  const upload = useMutation({ mutationFn: (file: File) => uploadDeliveryFile(delivery.id, file), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be uploaded.")) });
  const remove = useMutation({ mutationFn: (fileId: string) => removeDeliveryFile(delivery.id, fileId), onSuccess: after, onError: (failure) => setError(failureText(failure, "The file could not be removed.")) });
  return (
    <div className="flex flex-col gap-4 pt-4">
      <SalesPanel title="Delivery instructions" description="Printed on the delivery note.">
        <p className="text-sm whitespace-pre-line">{delivery.delivery_instructions ?? "None"}</p>
      </SalesPanel>
      <SalesPanel title="Internal notes" description="Never printed or shown to the customer.">
        <p className="text-sm whitespace-pre-line">{delivery.internal_notes ?? "None"}</p>
      </SalesPanel>
      <SalesPanel title="Proof of delivery" description="The signed delivery note, a photo of the goods received, or the customer's acknowledgement (PDF or image, up to 10 MB)."
        actions={detail.actions.uploadProof ? (
          <>
            <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} />
            <Button variant="secondary" size="compact" isLoading={upload.isPending} onPress={() => input.current?.click()}><Upload className="size-4" aria-hidden="true" />Upload</Button>
          </>
        ) : undefined}>
        {error && <SalesAlert>{error}</SalesAlert>}
        {!files.data?.length ? <p className="text-sm text-text-muted">{["draft", "ready"].includes(delivery.status) ? "Proof is added once the delivery is dispatched." : "No files yet."}</p> : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {files.data.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-3 py-2">
                <a className="font-medium text-brand hover:underline" href={deliveryFileUrl(delivery.id, file.id)}>{file.fileName}</a>
                <span className="text-text-muted">{dateTime(file.uploadedAt)} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB</span>
                {detail.actions.uploadProof && <Button variant="ghost" size="compact" isLoading={remove.isPending} onPress={() => remove.mutate(file.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      </SalesPanel>
    </div>
  );
}

function History({ detail }: { detail: DeliveryDetail }) {
  return (
    <div className="pt-4">
      <SalesPanel title="History">
        {!detail.events.length ? <p className="text-sm text-text-muted">No history yet.</p> : (
          <ol className="flex flex-col divide-y divide-border text-sm">
            {detail.events.map((event) => (
              <li key={event.id} className="flex flex-col gap-0.5 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{EVENT_LABELS[event.event_type] ?? statusLabel(event.event_type.split(".").pop())}</span>
                  <span className="text-text-muted">{dateTime(event.occurred_at)}{event.actor_name ? ` · ${event.actor_name}` : ""}</span>
                </span>
                {eventDetail(event) && <span className="whitespace-pre-line text-text-secondary">{eventDetail(event)}</span>}
              </li>
            ))}
          </ol>
        )}
      </SalesPanel>
    </div>
  );
}

