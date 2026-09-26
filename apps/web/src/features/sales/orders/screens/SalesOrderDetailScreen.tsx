"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Ban, Check, Download, FileText, Pause, Pencil, PlayCircle, Truck, X } from "lucide-react";
import { Button, Dialog, LinkButton, EnterpriseDataGrid, ErrorState, MetricStrip, PermissionState, RecordDetailsPage, Select, StatusBadge, Tab, TabList, TabPanel, Tabs, TextArea, TextField, NumberField } from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { SalesApiError } from "@/features/sales/shared/http";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert, SalesFacts, SalesPanel } from "@/features/sales/shared/SalesUi";
import { getSalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { LineStockDialog } from "@/features/sales/orders/screens/LineStockDialog";
import { recordDelivery, recordShipment, releaseOrderReservations } from "@/features/sales/operations/api/operations-api";
import {
  approveSalesOrder,
  cancelSalesOrder,
  closeSalesOrder,
  confirmSalesOrder,
  getSalesOrder,
  getSalesOrderReadiness,
  placeSalesOrderHold,
  rejectSalesOrderApproval,
  releaseSalesOrderHold,
  requestSalesFulfillment,
  requestSalesInvoice,
  submitSalesOrder,
  type SalesHandoffRequest,
  type SalesOrderHold,
  type SalesOrderLine,
  type SalesOrderVersionSummary,
} from "@/features/sales/orders/api/orders-api";

type Dialogue = null | "hold" | "cancel" | "invoice" | "credit" | "reject" | "releaseStock" | { release: SalesOrderHold } | { ship: SalesHandoffRequest } | { deliver: SalesHandoffRequest };

const HOLD_TYPES = [
  { value: "credit", label: "Credit" },
  { value: "payment", label: "Awaiting payment" },
  { value: "customer_request", label: "Customer request" },
  { value: "stock", label: "Stock" },
  { value: "other", label: "Other" },
];

// F042-F050 -- the sales-order record. Which actions appear follows the order's
// real lifecycle state and the caller's permissions; the server re-checks both
// (and every business rule -- credit limit, approval separation, immutability of
// consumed orders), so hiding a button is convenience, never the control.
export function SalesOrderDetailScreen({ orderId }: { orderId: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = (permission: string) => workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission);

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue>(null);
  const [reason, setReason] = useState("");
  const [holdType, setHoldType] = useState("other");
  const [basis, setBasis] = useState<"default" | "ordered" | "fulfilled">("default");
  // F051: quantities to bill now per line (empty = everything that remains).
  const [invoiceQuantities, setInvoiceQuantities] = useState<Record<string, number>>({});
  const [stockLine, setStockLine] = useState<SalesOrderLine | null>(null);

  const key = scopedQueryKey(workspace, "sales", "order", orderId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => getSalesOrder(orderId).then((r) => r.detail),
    retry: (count, error) => !(error instanceof SalesApiError && [403, 404].includes(error.status)) && count < 2,
  });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => getSalesOptions().then((r) => r.options) });
  const readinessQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", orderId, "readiness"),
    queryFn: () => getSalesOrderReadiness(orderId).then((r) => r.readiness),
    enabled: query.isSuccess && ["confirmed", "on_hold"].includes(query.data?.order.lifecycle_status ?? ""),
    retry: false,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "sales", "orders") });
  }
  function closeDialogue() {
    setDialogue(null);
    setReason("");
    setCarrier("");
    setTrackingNumber("");
    setInvoiceQuantities({});
    setHoldType("other");
  }
  const onSuccess = (message?: string) => () => {
    setActionError(null);
    setNotice(message ?? null);
    closeDialogue();
    refresh();
  };
  const onError = (err: unknown) => {
    // A blocked credit check is a decision point, not a dead end: someone with
    // the override permission can proceed with a recorded reason.
    if (err instanceof SalesApiError && err.code === "SALES_CREDIT_BLOCK" && can(SALES_PERMISSIONS.creditOverride)) {
      setActionError(null);
      setDialogue("credit");
      return;
    }
    setActionError(err instanceof SalesApiError ? err.message : "This action could not be completed.");
  };

  const versionId = query.data?.order.current_version_id ?? "";
  const submitMutation = useMutation({ mutationFn: () => submitSalesOrder(orderId), onSuccess: (data) => onSuccess(data.result.approvalRequired ? "Submitted for approval." : "Approved automatically — ready to confirm.")(), onError });
  const approveMutation = useMutation({ mutationFn: () => approveSalesOrder(orderId, versionId), onSuccess: onSuccess("Approved."), onError });
  const rejectMutation = useMutation({ mutationFn: () => rejectSalesOrderApproval(orderId, versionId, reason.trim()), onSuccess: onSuccess("Sent back with your reason."), onError });
  const releaseStockMutation = useMutation({ mutationFn: () => releaseOrderReservations(orderId, reason.trim()), onSuccess: onSuccess("Reserved stock released."), onError });
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const shipMutation = useMutation({ mutationFn: (requestId: string) => recordShipment(requestId, { carrier: carrier.trim(), trackingNumber: trackingNumber.trim() || undefined }), onSuccess: onSuccess("Shipment recorded."), onError });
  const deliverMutation = useMutation({ mutationFn: (requestId: string) => recordDelivery(requestId, { receivedBy: carrier.trim(), note: reason.trim() || undefined }), onSuccess: onSuccess("Delivery recorded."), onError });
  const confirmMutation = useMutation({
    mutationFn: (override?: string) => confirmSalesOrder(orderId, override ? { overrideCredit: true, creditOverrideReason: override } : {}),
    onSuccess: onSuccess("Order confirmed."),
    onError,
  });
  const holdMutation = useMutation({ mutationFn: () => placeSalesOrderHold(orderId, { holdType, reason }), onSuccess: onSuccess("Order placed on hold."), onError });
  const releaseMutation = useMutation({ mutationFn: (holdId: string) => releaseSalesOrderHold(orderId, { holdId, note: reason || undefined }), onSuccess: onSuccess("Hold released."), onError });
  const cancelMutation = useMutation({ mutationFn: () => cancelSalesOrder(orderId, reason), onSuccess: onSuccess("Order cancelled."), onError });
  const closeMutation = useMutation({ mutationFn: () => closeSalesOrder(orderId), onSuccess: onSuccess("Order closed."), onError });
  const fulfilMutation = useMutation({ mutationFn: () => requestSalesFulfillment(orderId, crypto.randomUUID()), onSuccess: onSuccess("Fulfilment requested."), onError });
  const invoiceMutation = useMutation({ mutationFn: () => {
      const chosen = Object.entries(invoiceQuantities).filter(([, quantity]) => quantity > 0).map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity }));
      return requestSalesInvoice(orderId, crypto.randomUUID(), basis === "default" ? undefined : basis, chosen.length ? chosen : undefined);
    }, onSuccess: onSuccess("Invoice requested."), onError });

  if (query.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading sales order…</p>;
  if (query.isError || !query.data) {
    if (query.error instanceof SalesApiError && query.error.status === 403) return <PermissionState title="You don't have access to this sales order" />;
    if (query.error instanceof SalesApiError && query.error.status === 404) return <ErrorState title="Sales order not found" action={{ label: "Back to sales orders", onPress: () => router.push("/sales/orders") }} />;
    return <ErrorState title="Could not load this sales order" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const detail = query.data;
  const order = detail.order;
  const currency = order.currency_code;
  const state = order.lifecycle_status;
  const isAmendment = state === "pending_approval" && order.version_number > 1;
  const activeHolds = detail.holds.filter((hold) => hold.status === "active");
  const showMargin = order.margin_percent !== undefined;
  const busy = confirmMutation.isPending || submitMutation.isPending || approveMutation.isPending;

  const lineColumns: ColumnDef<SalesOrderLine, unknown>[] = [
    { id: "item", header: "Item", accessorFn: (line) => `${line.item_name_snapshot} (${line.item_code_snapshot})` },
    { id: "qty", header: "Ordered", accessorFn: (line) => `${Number(line.quantity)}${line.uom_snapshot ? ` ${line.uom_snapshot}` : ""}` },
    { id: "reserved", header: "Reserved", accessorFn: (line) => Number(line.reserved_quantity) },
    { id: "fulfilled", header: "Fulfilled", accessorFn: (line) => Number(line.fulfilled_quantity) },
    { id: "invoiced", header: "Invoiced", accessorFn: (line) => Number(line.invoiced_quantity) },
    { id: "price", header: "Unit price", accessorFn: (line) => money(currency, line.unit_price) },
    { id: "total", header: "Line total", accessorFn: (line) => money(currency, line.line_total) },
  ];
  const requestColumns: ColumnDef<SalesHandoffRequest, unknown>[] = [
    { id: "number", header: "Request", accessorKey: "request_number" },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "when", header: "Requested", accessorFn: (request) => dateTime(request.requested_at) },
    { id: "error", header: "Last error", accessorFn: (request) => request.last_error ?? "—" },
  ];
  // F049: what the customer can track — carrier, tracking number, proof of delivery.
  const fulfilmentColumns: ColumnDef<SalesHandoffRequest, unknown>[] = [
    ...requestColumns.filter((column) => column.id !== "error"),
    { id: "shipment", header: "Shipment", accessorFn: (request) => (request.shipped_at ? `${request.carrier ?? ""}${request.tracking_number ? ` · ${request.tracking_number}` : ""} · ${dateTime(request.shipped_at)}` : "Not shipped") },
    { id: "delivery", header: "Delivered", accessorFn: (request) => (request.delivered_at ? `${dateTime(request.delivered_at)} · received by ${request.received_by}` : "—") },
  ];
  const hasReservedStock = detail.lines.some((line) => Number(line.reserved_quantity) > 0);
  const userName = (id: unknown) => optionsQuery.data?.users.find((user) => user.id === id)?.full_name ?? null;
  const holdColumns: ColumnDef<SalesOrderHold, unknown>[] = [
    { id: "type", header: "Type", accessorFn: (hold) => statusLabel(hold.hold_type) },
    { id: "reason", header: "Reason", accessorKey: "reason" },
    { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => <StatusBadge tone={row.original.status === "active" ? "warning" : "neutral"}>{statusLabel(row.original.status)}</StatusBadge> },
    { id: "placed", header: "Placed", accessorFn: (hold) => dateTime(hold.placed_at) },
    { id: "released", header: "Released", accessorFn: (hold) => (hold.released_at ? `${dateTime(hold.released_at)}${hold.release_note ? ` — ${hold.release_note}` : ""}` : "—") },
  ];
  const versionColumns: ColumnDef<SalesOrderVersionSummary, unknown>[] = [
    { id: "v", header: "Version", accessorFn: (version) => `v${version.version_number}${version.id === order.current_version_id ? " (current)" : ""}` },
    { id: "reason", header: "Reason", accessorFn: (version) => version.amendment_reason ?? "Original order" },
    { id: "total", header: "Total", accessorFn: (version) => money(version.currency_code, version.grand_total) },
    { id: "when", header: "Created", accessorFn: (version) => dateTime(version.created_at) },
  ];

  const primary =
    state === "draft" && can(SALES_PERMISSIONS.orderCreate) ? (
      <Button variant="primary" onPress={() => submitMutation.mutate()} isLoading={submitMutation.isPending}>
        Submit
      </Button>
    ) : state === "pending_approval" && can(SALES_PERMISSIONS.orderApprove) ? (
      <Button variant="primary" onPress={() => approveMutation.mutate()} isLoading={approveMutation.isPending}>
        <Check className="size-4" aria-hidden="true" />
        {isAmendment ? "Approve amendment" : "Approve"}
      </Button>
    ) : state === "approved" && can(SALES_PERMISSIONS.orderConfirm) ? (
      <Button variant="primary" onPress={() => confirmMutation.mutate(undefined)} isLoading={confirmMutation.isPending}>
        <Check className="size-4" aria-hidden="true" />
        Confirm order
      </Button>
    ) : state === "confirmed" && can(SALES_PERMISSIONS.fulfillmentRequest) ? (
      <Button variant="primary" onPress={() => fulfilMutation.mutate()} isLoading={fulfilMutation.isPending}>
        <Truck className="size-4" aria-hidden="true" />
        Request fulfilment
      </Button>
    ) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sales/orders" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text">
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        All sales orders
      </Link>

      <RecordDetailsPage
        header={{
          title: order.sales_order_number,
          status: <StatusBadge tone={statusTone(state)}>{statusLabel(state)}</StatusBadge>,
          fields: [
            { label: "Customer", value: order.customer_snapshot?.displayName ?? "—" },
            { label: "Version", value: `v${order.version_number}` },
            { label: "Delivery by", value: calendarDate(order.requested_delivery_date) },
            { label: "Customer PO", value: order.customer_po_number ?? "—" },
          ],
          primaryAction: primary,
          secondaryActions: (
            <div className="flex flex-wrap items-center gap-2">
              <LinkButton variant="secondary" href={`/api/documents/sales.order/${orderId}/pdf`} download>
                <Download className="size-4" aria-hidden="true" />
                Download PDF
              </LinkButton>
              {state === "pending_approval" && can(SALES_PERMISSIONS.orderApprove) && (
                <Button variant="secondary" onPress={() => setDialogue("reject")}>
                  <X className="size-4" aria-hidden="true" />
                  {isAmendment ? "Reject amendment" : "Send back to draft"}
                </Button>
              )}
              {state === "confirmed" && can(SALES_PERMISSIONS.invoiceRequest) && (
                <Button variant="secondary" onPress={() => setDialogue("invoice")}>
                  <FileText className="size-4" aria-hidden="true" />
                  Request invoice
                </Button>
              )}
              {["confirmed", "on_hold"].includes(state) && can(SALES_PERMISSIONS.orderAmend) && (
                <Button variant="secondary" onPress={() => router.push(`/sales/orders/${orderId}/amend`)}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Amend
                </Button>
              )}
              {["confirmed", "on_hold"].includes(state) && hasReservedStock && can(SALES_PERMISSIONS.fulfillmentRequest) && (
                <Button variant="secondary" onPress={() => setDialogue("releaseStock")}>
                  Release reserved stock
                </Button>
              )}
              {state === "confirmed" && can(SALES_PERMISSIONS.orderHold) && (
                <Button variant="secondary" onPress={() => setDialogue("hold")}>
                  <Pause className="size-4" aria-hidden="true" />
                  Place on hold
                </Button>
              )}
              {state === "confirmed" && can(SALES_PERMISSIONS.orderConfirm) && (
                <Button variant="secondary" onPress={() => closeMutation.mutate()} isLoading={closeMutation.isPending}>
                  Close order
                </Button>
              )}
              {["draft", "confirmed", "on_hold", "approved"].includes(state) && can(SALES_PERMISSIONS.orderCancel) && (
                <Button variant="secondary" onPress={() => setDialogue("cancel")}>
                  <Ban className="size-4" aria-hidden="true" />
                  Cancel order
                </Button>
              )}
            </div>
          ),
        }}
      >
        {actionError && <SalesAlert>{actionError}</SalesAlert>}
        {notice && !actionError && <SalesAlert tone="success">{notice}</SalesAlert>}
        {state === "pending_approval" && (
          <SalesAlert tone="info">{isAmendment ? "This amendment needs approval by someone other than its author. The order keeps its previous version until it is approved." : "This order needs approval by someone other than its author before it can be confirmed."}</SalesAlert>
        )}
        {state === "approved" && <SalesAlert tone="info">Approved. Confirming runs the customer credit check.</SalesAlert>}
        {state === "on_hold" && <SalesAlert tone="warning">On hold — fulfilment and invoicing are blocked until every hold is released ({activeHolds.length} active).</SalesAlert>}
        {order.credit_status === "overridden" && <SalesAlert tone="warning">Confirmed with a finance credit-limit override. See the Activity tab for the recorded reason.</SalesAlert>}

        <MetricStrip
          metrics={[
            { label: "Grand total", value: money(currency, order.grand_total) },
            { label: "Subtotal", value: money(currency, order.subtotal) },
            { label: "Tax", value: money(currency, order.tax_total) },
            { label: "Fulfilment", value: statusLabel(order.fulfillment_status) },
            { label: "Billing", value: statusLabel(order.billing_status) },
            ...(showMargin ? [{ label: "Margin", value: `${Number(order.margin_percent).toFixed(1)}%` }] : []),
          ]}
        />

        <Tabs>
          <TabList aria-label="Sales order sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="handoff">Fulfilment &amp; billing</Tab>
            <Tab id="holds">Holds ({activeHolds.length})</Tab>
            <Tab id="versions">Versions ({detail.versions.length})</Tab>
            <Tab id="activity">Activity</Tab>
          </TabList>

          <TabPanel id="overview" className="flex flex-col gap-4">
            <SalesPanel title="Items">
              <EnterpriseDataGrid<SalesOrderLine>
                aria-label="Order items"
                columns={lineColumns}
                data={detail.lines}
                getRowId={(line) => line.id}
                density="compact"
                rowActions={(line) =>
                  state === "confirmed" && line.warehouse_id && can(SALES_PERMISSIONS.fulfillmentRequest) ? (
                    <Button variant="ghost" size="compact" onPress={() => setStockLine(line)}>
                      Stock
                    </Button>
                  ) : null
                }
              />
            </SalesPanel>
            <SalesPanel title="Order details">
              <SalesFacts
                columns={3}
                items={[
                  { label: "Order date", value: calendarDate(order.order_date) },
                  { label: "Payment terms", value: order.payment_term_snapshot?.name ?? "—" },
                  { label: "Credit check", value: statusLabel(order.credit_status) },
                  { label: "Customer PO date", value: calendarDate(order.customer_po_date) },
                  { label: "Notes for the customer", value: order.customer_notes ?? "—" },
                  { label: "Terms and conditions", value: order.terms_and_conditions ?? "—" },
                  { label: "Internal notes", value: order.internal_notes ?? "—" },
                ]}
              />
            </SalesPanel>
            {readinessQuery.data?.health && (
              <SalesPanel title="Readiness" description="A read-only assessment of whether this order can move to fulfilment and billing.">
                <p className="text-sm text-text">
                  Status: <span className="font-medium">{statusLabel(String(readinessQuery.data.health.readiness ?? "unknown"))}</span>
                </p>
                {[...(readinessQuery.data.health.blockers ?? []), ...(readinessQuery.data.health.warnings ?? [])].length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-text-secondary">
                    {[...(readinessQuery.data.health.blockers ?? []), ...(readinessQuery.data.health.warnings ?? [])].map((item, index) => (
                      <li key={`${item.code ?? "issue"}-${index}`}>{item.message ?? item.code}</li>
                    ))}
                  </ul>
                )}
              </SalesPanel>
            )}
          </TabPanel>

          <TabPanel id="handoff" className="flex flex-col gap-4">
            <SalesPanel title="Fulfilment requests" description="Hand-offs to warehouse fulfilment. Repeating a request with the same key never creates a second one.">
              <EnterpriseDataGrid<SalesHandoffRequest>
                aria-label="Fulfilment requests"
                columns={fulfilmentColumns}
                data={detail.fulfillmentRequests}
                getRowId={(request) => request.id}
                density="compact"
                state={detail.fulfillmentRequests.length ? "ready" : "empty"}
                emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No fulfilment requested yet.</p>}
                rowActions={(request) =>
                  !can(SALES_PERMISSIONS.fulfillmentRequest) ? null : request.status === "completed" && !request.shipped_at ? (
                    <Button variant="ghost" size="compact" onPress={() => setDialogue({ ship: request })}>
                      Record shipment
                    </Button>
                  ) : request.shipped_at && !request.delivered_at ? (
                    <Button variant="ghost" size="compact" onPress={() => setDialogue({ deliver: request })}>
                      Record delivery
                    </Button>
                  ) : null
                }
              />
            </SalesPanel>
            <SalesPanel title="Invoice requests">
              <EnterpriseDataGrid<SalesHandoffRequest> aria-label="Invoice requests" columns={requestColumns} data={detail.invoiceRequests} getRowId={(request) => request.id} density="compact" state={detail.invoiceRequests.length ? "ready" : "empty"} emptyContent={<p className="px-4 py-6 text-sm text-text-muted">No invoice requested yet.</p>} />
            </SalesPanel>
          </TabPanel>

          <TabPanel id="holds">
            <SalesPanel title="Holds" description="An order on hold cannot be fulfilled or invoiced. It returns to confirmed when every active hold is released.">
              <EnterpriseDataGrid<SalesOrderHold>
                aria-label="Order holds"
                columns={holdColumns}
                data={detail.holds}
                getRowId={(hold) => hold.id}
                density="compact"
                state={detail.holds.length ? "ready" : "empty"}
                emptyContent={<p className="px-4 py-6 text-sm text-text-muted">This order has never been on hold.</p>}
                rowActions={(hold) =>
                  hold.status === "active" && can(SALES_PERMISSIONS.orderHold) ? (
                    <Button variant="ghost" size="compact" onPress={() => setDialogue({ release: hold })}>
                      <PlayCircle className="size-3.5" aria-hidden="true" />
                      Release
                    </Button>
                  ) : null
                }
              />
            </SalesPanel>
          </TabPanel>

          <TabPanel id="versions">
            <SalesPanel title="Version history" description="Every amendment creates a new version; earlier versions stay exactly as they were.">
              <EnterpriseDataGrid<SalesOrderVersionSummary> aria-label="Order versions" columns={versionColumns} data={detail.versions} getRowId={(version) => version.id} density="compact" />
            </SalesPanel>
          </TabPanel>

          <TabPanel id="activity">
            <SalesPanel title="Activity">
              {detail.events.length === 0 ? (
                <p className="text-sm text-text-muted">No activity recorded yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {detail.events.map((event, index) => {
                    const note = (event.metadata?.reason ?? event.metadata?.creditOverrideReason ?? event.metadata?.note) as string | undefined;
                    const details = eventDetails(event.metadata ?? {}, userName);
                    return (
                      <li key={`${event.occurred_at}-${index}`} className="flex flex-col gap-0.5 py-2 text-sm">
                        <span className="font-medium text-text">{statusLabel(event.event_type.replace(/^sales_order\./, ""))}</span>
                        <span className="text-xs text-text-muted">
                          {event.from_status && event.to_status && event.from_status !== event.to_status ? `${statusLabel(event.from_status)} → ${statusLabel(event.to_status)} · ` : ""}
                          {dateTime(event.occurred_at)}
                        </span>
                        {details.map((detail) => (
                          <span key={detail} className="text-xs text-text-secondary">{detail}</span>
                        ))}
                        {note && <span className="text-xs text-text-secondary">“{note}”</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </SalesPanel>
          </TabPanel>
        </Tabs>
      </RecordDetailsPage>

      {dialogue === "hold" && (
        <ActionDialog title="Place order on hold" confirmLabel="Place on hold" pending={holdMutation.isPending} disabled={!reason.trim()} error={actionError} onClose={closeDialogue} onConfirm={() => holdMutation.mutate()}>
          <Select label="Hold type" options={HOLD_TYPES} selectedKey={holdType} onSelectionChange={(key) => setHoldType(String(key ?? "other"))} />
          <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {dialogue === "cancel" && (
        <ActionDialog title="Cancel this order" confirmLabel="Cancel order" pending={cancelMutation.isPending} disabled={!reason.trim()} error={actionError} onClose={closeDialogue} onConfirm={() => cancelMutation.mutate()}>
          <p className="text-sm text-text-secondary">This cannot be undone. Orders that already have fulfilment or invoicing activity cannot be cancelled directly.</p>
          <TextArea label="Reason for cancelling" isRequired value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {dialogue === "credit" && (
        <ActionDialog title="Credit limit exceeded" confirmLabel="Override and confirm" pending={confirmMutation.isPending} disabled={!reason.trim()} error={actionError} onClose={closeDialogue} onConfirm={() => confirmMutation.mutate(reason.trim())}>
          <p className="text-sm text-text-secondary">Confirming this order takes the customer over their credit limit. As a finance approver you can override the check; your reason is recorded on the order.</p>
          <TextArea label="Override reason" isRequired value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {dialogue === "invoice" && (
        <ActionDialog title="Request invoice" confirmLabel="Request invoice" pending={invoiceMutation.isPending} error={actionError} onClose={closeDialogue} onConfirm={() => invoiceMutation.mutate()}>
          <Select
            label="Invoice quantities"
            options={[
              { value: "default", label: "Default (from Sales settings)" },
              { value: "ordered", label: "Ordered quantities" },
              { value: "fulfilled", label: "Fulfilled quantities only" },
            ]}
            selectedKey={basis}
            onSelectionChange={(key) => setBasis(key === "fulfilled" ? "fulfilled" : key === "ordered" ? "ordered" : "default")}
          />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-text">Quantities to invoice now</p>
            <p className="text-xs text-text-muted">Leave a line at 0 to skip it, or leave every line at 0 to invoice everything that remains. You can never invoice more than remains.</p>
            {detail.lines.filter((line) => Number(line.remaining_to_invoice) > 0).map((line) => (
              <NumberField
                key={line.id}
                label={`${line.item_name_snapshot} — ${Number(line.remaining_to_invoice)} ${line.uom_snapshot ?? ""} remaining`}
                value={invoiceQuantities[line.id] ?? 0}
                onChange={(value) => setInvoiceQuantities((current) => ({ ...current, [line.id]: Number.isFinite(value) ? value : 0 }))}
                minValue={0}
                maxValue={Number(line.remaining_to_invoice)}
              />
            ))}
          </div>
        </ActionDialog>
      )}
      {dialogue === "reject" && (
        <ActionDialog title={isAmendment ? "Reject amendment" : "Send back to draft"} confirmLabel={isAmendment ? "Reject amendment" : "Send back"} pending={rejectMutation.isPending} disabled={reason.trim().length < 5} error={actionError} onClose={closeDialogue} onConfirm={() => rejectMutation.mutate()}>
          <p className="text-sm text-text-secondary">The requester sees your reason on the order.</p>
          <TextArea label="Why is this rejected?" isRequired value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {dialogue === "releaseStock" && (
        <ActionDialog title="Release reserved stock" confirmLabel="Release stock" pending={releaseStockMutation.isPending} disabled={reason.trim().length < 5} error={actionError} onClose={closeDialogue} onConfirm={() => releaseStockMutation.mutate()}>
          <p className="text-sm text-text-secondary">Everything reserved for this order goes back to free stock. Reserve again from each line when needed.</p>
          <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {dialogue && typeof dialogue === "object" && "ship" in dialogue && (
        <ActionDialog title={`Record shipment for ${dialogue.ship.request_number}`} confirmLabel="Record shipment" pending={shipMutation.isPending} disabled={!carrier.trim()} error={actionError} onClose={closeDialogue} onConfirm={() => shipMutation.mutate(dialogue.ship.id)}>
          <TextField label="Carrier" isRequired value={carrier} onChange={setCarrier} />
          <TextField label="Tracking number" value={trackingNumber} onChange={setTrackingNumber} />
        </ActionDialog>
      )}
      {dialogue && typeof dialogue === "object" && "deliver" in dialogue && (
        <ActionDialog title={`Record delivery for ${dialogue.deliver.request_number}`} confirmLabel="Record delivery" pending={deliverMutation.isPending} disabled={!carrier.trim()} error={actionError} onClose={closeDialogue} onConfirm={() => deliverMutation.mutate(dialogue.deliver.id)}>
          <TextField label="Received by" isRequired value={carrier} onChange={setCarrier} />
          <TextArea label="Delivery note (optional)" value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {dialogue && typeof dialogue === "object" && "release" in dialogue && (
        <ActionDialog title="Release hold" confirmLabel="Release hold" pending={releaseMutation.isPending} error={actionError} onClose={closeDialogue} onConfirm={() => releaseMutation.mutate(dialogue.release.id)}>
          <p className="text-sm text-text-secondary">Hold reason: {dialogue.release.reason}</p>
          <TextArea label="Release note (optional)" value={reason} onChange={setReason} />
        </ActionDialog>
      )}
      {stockLine && (
        <LineStockDialog
          orderId={orderId}
          line={stockLine}
          onClose={() => setStockLine(null)}
          onReserved={() => {
            setStockLine(null);
            setNotice("Stock reserved.");
            refresh();
          }}
        />
      )}
      {busy && <span className="sr-only" role="status">Working…</span>}
    </div>
  );
}

function ActionDialog({
  title,
  confirmLabel,
  pending,
  disabled,
  error,
  onClose,
  onConfirm,
  children,
}: {
  title: string;
  confirmLabel: string;
  pending: boolean;
  disabled?: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {error && <SalesAlert>{error}</SalesAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={onConfirm} isLoading={pending} isDisabled={disabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const TRIGGER_LABELS: Record<string, string> = { amount: "amount above the approval limit", discount: "discount above the approval limit", margin: "margin below the minimum" };
// What an order event means beyond its title: why approval was needed, who it
// was routed to, shipment and delivery evidence, promise dates.
function eventDetails(metadata: Record<string, unknown>, userName: (id: unknown) => string | null) {
  const details: string[] = [];
  const triggers = Array.isArray(metadata.triggers) ? (metadata.triggers as string[]) : [];
  if (triggers.length) details.push(`Needs approval: ${triggers.map((trigger) => TRIGGER_LABELS[trigger] ?? trigger).join(", ")}`);
  if (metadata.delegatedFrom) details.push(`Routed to ${userName(metadata.assignedTo) ?? "the delegate"} while ${userName(metadata.delegatedFrom) ?? "the approver"} is away`);
  else if (metadata.assignedTo) details.push(`Assigned to ${userName(metadata.assignedTo) ?? "an approver"}`);
  if (metadata.carrier) details.push(`Carrier ${metadata.carrier}${metadata.trackingNumber ? `, tracking ${metadata.trackingNumber}` : ""}`);
  if (metadata.receivedBy) details.push(`Received by ${metadata.receivedBy}`);
  if (metadata.promisedDate) details.push(`Promised for ${String(metadata.promisedDate)} (${Number(metadata.openQuantity ?? 0)} still owed)`);
  if (metadata.requestNumber) details.push(`Request ${metadata.requestNumber}${metadata.quantityBasis ? ` — ${String(metadata.quantityBasis)} quantities` : ""}`);
  if (typeof metadata.released === "number") details.push(`${metadata.released} reservation(s) released`);
  return details;
}
