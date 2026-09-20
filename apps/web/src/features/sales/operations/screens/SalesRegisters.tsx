"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Dialog, EnterpriseDataGrid, ErrorState, NumberField, PageHeader, Select, StatusBadge, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import { getSalesOrder, type SalesOrderLine } from "@/features/sales/orders/api/orders-api";
import type { SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import { dateTime, money, statusLabel, statusTone } from "@/features/sales/shared/format";
import { SalesAlert } from "@/features/sales/shared/SalesUi";
import {
  accrueCommission,
  createCommissionRule,
  createDropShip,
  createReturn,
  recordAdvance,
  requestAdjustment,
  type AdjustmentRow,
  completeDelivery,
  type AdvanceRow,
  type BackorderRow,
  type PricingRuleRow,
  type CommissionRow,
  type CommissionRuleRow,
  type DropShipRow,
  type FulfillmentRegisterRow,
  type InvoiceRegisterRow,
  type ReturnRow,
} from "@/features/sales/operations/api/operations-api";
import { SalesRegisterPage } from "@/features/sales/operations/screens/SalesRegisterPage";

type OrderOption = { id: string; sales_order_number: string; lifecycle_status: string; currency_code: string; grand_total: string; current_version_id: string };
type LineOption = { id: string; sales_order_version_id: string; item_name_snapshot: string; item_code_snapshot: string; quantity: string };
type Options = {
  orders: OrderOption[];
  lines: LineOption[];
  commissionRules: Array<{ id: string; name: string; rate_percent: string; basis: string }>;
  suppliers: Array<{ id: string; code: string; display_name: string }>;
  users: Array<{ id: string; name: string }>;
};

function useOperationOptions() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "operation-options"), queryFn: () => request<{ options: Options }>("/operations/options").then((r) => r.options) });
  const orderNumber = (id: string) => query.data?.orders.find((order) => order.id === id)?.sales_order_number ?? "—";
  return { options: query.data, orderNumber };
}

const badge = (value: string) => <StatusBadge tone={statusTone(value)}>{statusLabel(value)}</StatusBadge>;
const OrderLink = ({ id, label }: { id: string; label: string }) => (
  <Link href={`/sales/orders/${id}`} className="font-medium text-brand hover:underline" onClick={(event) => event.stopPropagation()}>
    {label}
  </Link>
);

// Shared shell for the create dialogs: one place for the error banner, the
// pending state and the button row, so every dialog behaves the same way.
function OperationDialog({ title, confirmLabel, disabled, mutation, onClose, children }: { title: string; confirmLabel: string; disabled?: boolean; mutation: { isPending: boolean; error: unknown; mutate: () => void }; onClose: () => void; children: ReactNode }) {
  const message = mutation.error ? (mutation.error instanceof SalesApiError ? mutation.error.message : "This could not be saved.") : null;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {message && <SalesAlert>{message}</SalesAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={disabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const orderSelectOptions = (orders: OrderOption[] = [], allowed: string[]): SelectOption[] =>
  orders.filter((order) => allowed.includes(order.lifecycle_status)).map((order) => ({ value: order.id, label: `${order.sales_order_number} — ${money(order.currency_code, order.grand_total)}` }));

// ---------------------------------------------------------------- deliveries
function CompleteDeliveryDialog({ row, onClose, onDone }: { row: FulfillmentRegisterRow; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const order = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "order", row.sales_order_id), queryFn: () => getSalesOrder(row.sales_order_id).then((r) => r.detail) });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const lines: SalesOrderLine[] = (order.data?.lines ?? []).filter((line) => Number(line.remaining_to_fulfill) > 0);
  const chosen = lines.map((line) => ({ salesOrderLineId: line.id, fulfilledQuantity: quantities[line.id] ?? Number(line.remaining_to_fulfill) })).filter((line) => line.fulfilledQuantity > 0);
  const mutation = useMutation({ mutationFn: () => completeDelivery(row.id, chosen), onSuccess: onDone });
  return (
    <OperationDialog title={`Complete delivery ${row.request_number}`} confirmLabel="Complete delivery" disabled={chosen.length === 0} mutation={mutation} onClose={onClose}>
      <p className="text-sm text-text-secondary">Enter what actually shipped. Stock is issued for every line with a warehouse; a shortfall stays open as a backorder.</p>
      {order.isLoading && <p className="text-sm text-text-muted">Loading order lines…</p>}
      {lines.map((line) => (
        <NumberField key={line.id} label={`${line.item_name_snapshot} — ${Number(line.remaining_to_fulfill)} remaining`} value={quantities[line.id] ?? Number(line.remaining_to_fulfill)} onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))} minValue={0} maxValue={Number(line.remaining_to_fulfill)} step={1} />
      ))}
      {order.data && lines.length === 0 && <p className="text-sm text-text-muted">Everything on this order has already shipped.</p>}
    </OperationDialog>
  );
}

export function SalesDeliveriesScreen() {
  const router = useRouter();
  const [completing, setCompleting] = useState<{ row: FulfillmentRegisterRow; refresh: () => void } | null>(null);
  const columns: ColumnDef<FulfillmentRegisterRow, unknown>[] = useMemo(
    () => [
      { id: "request", header: "Request", accessorKey: "request_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.request_number}</span> },
      { id: "order", header: "Order", accessorKey: "sales_order_number" },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
      { id: "requested", header: "Requested", accessorFn: (row) => dateTime(row.requested_at) },
      { id: "completed", header: "Completed", accessorFn: (row) => dateTime(row.completed_at) },
      { id: "error", header: "Last error", accessorFn: (row) => row.last_error ?? "—" },
    ],
    [],
  );
  return (
    <>
    <SalesRegisterPage<FulfillmentRegisterRow>
      config={{
        kind: "fulfillment-requests",
        title: "Deliveries",
        description: "Fulfilment requests handed to the warehouse, with their progress.",
        searchLabel: "Search deliveries",
        columns,
        searchText: (row) => `${row.request_number} ${row.sales_order_number} ${row.customer_name ?? ""} ${row.status}`,
        emptyTitle: "No fulfilment requests yet",
        emptyDescription: "Request fulfilment from a confirmed sales order.",
        onRowClick: (row) => router.push(`/sales/orders/${row.sales_order_id}`),
        rowActions: (row, refresh) =>
          ["pending", "processing", "failed"].includes(row.status) ? (
            <Button variant="ghost" size="compact" onPress={() => setCompleting({ row, refresh })}>
              Complete delivery
            </Button>
          ) : null,
      }}
    />
      {completing && <CompleteDeliveryDialog row={completing.row} onClose={() => setCompleting(null)} onDone={() => { completing.refresh(); setCompleting(null); }} />}
    </>
  );
}

// ------------------------------------------------------------------ invoices
export function SalesInvoicesScreen() {
  const router = useRouter();
  const columns: ColumnDef<InvoiceRegisterRow, unknown>[] = useMemo(
    () => [
      { id: "request", header: "Request", accessorKey: "request_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.request_number}</span> },
      { id: "order", header: "Order", accessorKey: "sales_order_number" },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "basis", header: "Quantities", accessorFn: (row) => statusLabel(row.quantity_basis) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
      { id: "total", header: "Order total", accessorFn: (row) => money(row.currency_code, row.grand_total) },
      { id: "requested", header: "Requested", accessorFn: (row) => dateTime(row.requested_at) },
    ],
    [],
  );
  return (
    <SalesRegisterPage<InvoiceRegisterRow>
      config={{
        kind: "invoice-requests",
        title: "Invoices",
        description: "Invoice requests raised from sales orders and handed to Accounting.",
        searchLabel: "Search invoice requests",
        columns,
        searchText: (row) => `${row.request_number} ${row.sales_order_number} ${row.customer_name ?? ""} ${row.status}`,
        emptyTitle: "No invoice requests yet",
        emptyDescription: "Request an invoice from a confirmed sales order.",
        onRowClick: (row) => router.push(`/sales/orders/${row.sales_order_id}`),
      }}
    />
  );
}

// ------------------------------------------------------------------ advances
function AdvanceDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { options } = useOperationOptions();
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState(0);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const mutation = useMutation({ mutationFn: () => recordAdvance({ salesOrderId: orderId, amount, paymentReference: reference, note: note || undefined }), onSuccess: onDone });
  return (
    <OperationDialog title="Record advance payment" confirmLabel="Record advance" disabled={!orderId || amount <= 0 || !reference.trim()} mutation={mutation} onClose={onClose}>
      <Select label="Sales order" isRequired options={orderSelectOptions(options?.orders, ["draft", "pending_approval", "approved", "confirmed", "on_hold"])} selectedKey={orderId || null} onSelectionChange={(key) => setOrderId(String(key ?? ""))} placeholder="Select an order" />
      <NumberField label="Amount" isRequired value={amount} onChange={setAmount} minValue={0} step={0.01} />
      <TextField label="Payment reference" isRequired value={reference} onChange={setReference} />
      <TextArea label="Note (optional)" value={note} onChange={setNote} />
    </OperationDialog>
  );
}

export function SalesAdvancesScreen() {
  const { orderNumber } = useOperationOptions();
  const columns: ColumnDef<AdvanceRow, unknown>[] = useMemo(
    () => [
      { id: "order", header: "Order", cell: ({ row }) => <OrderLink id={row.original.sales_order_id} label={orderNumber(row.original.sales_order_id)} /> },
      { id: "amount", header: "Amount", accessorFn: (row) => money(row.currency_code, row.amount) },
      { id: "reference", header: "Reference", accessorKey: "payment_reference" },
      { id: "received", header: "Received", accessorFn: (row) => dateTime(row.received_at) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
      { id: "note", header: "Note", accessorFn: (row) => row.note ?? "—" },
    ],
    [orderNumber],
  );
  return (
    <SalesRegisterPage<AdvanceRow>
      config={{
        kind: "advances",
        title: "Advances",
        description: "Payments received before invoicing. Their total can never exceed the order's total.",
        searchLabel: "Search advances",
        createLabel: "Record advance",
        createPermission: SALES_PERMISSIONS.invoiceRequest,
        columns,
        searchText: (row) => `${orderNumber(row.sales_order_id)} ${row.payment_reference} ${row.status}`,
        emptyTitle: "No advance payments yet",
        emptyDescription: "Record a payment received against an order.",
        renderCreate: (props) => <AdvanceDialog {...props} />,
      }}
    />
  );
}

// --------------------------------------------------------------- adjustments
function AdjustmentDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { options } = useOperationOptions();
  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState<"credit_note" | "refund">("credit_note");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => requestAdjustment({ salesOrderId: orderId, adjustmentType: type, amount, reason }), onSuccess: onDone });
  return (
    <OperationDialog title="Request credit adjustment" confirmLabel="Request adjustment" disabled={!orderId || amount <= 0 || !reason.trim()} mutation={mutation} onClose={onClose}>
      <Select label="Sales order" isRequired options={orderSelectOptions(options?.orders, ["confirmed", "on_hold", "closed"])} selectedKey={orderId || null} onSelectionChange={(key) => setOrderId(String(key ?? ""))} placeholder="Select an order" />
      <Select
        label="Type"
        options={[
          { value: "credit_note", label: "Credit note" },
          { value: "refund", label: "Refund" },
        ]}
        selectedKey={type}
        onSelectionChange={(key) => setType(key === "refund" ? "refund" : "credit_note")}
      />
      <NumberField label="Amount" isRequired value={amount} onChange={setAmount} minValue={0} step={0.01} />
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </OperationDialog>
  );
}

export function SalesAdjustmentsScreen() {
  const { orderNumber } = useOperationOptions();
  const columns: ColumnDef<AdjustmentRow, unknown>[] = useMemo(
    () => [
      { id: "order", header: "Order", cell: ({ row }) => <OrderLink id={row.original.sales_order_id} label={orderNumber(row.original.sales_order_id)} /> },
      { id: "type", header: "Type", accessorFn: (row) => statusLabel(row.adjustment_type) },
      { id: "amount", header: "Amount", accessorFn: (row) => money(row.currency_code, row.amount) },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
      { id: "created", header: "Requested", accessorFn: (row) => dateTime(row.created_at) },
    ],
    [orderNumber],
  );
  return (
    <SalesRegisterPage<AdjustmentRow>
      config={{
        kind: "adjustments",
        title: "Credit / Adjustments",
        description: "Credit notes and refunds requested against orders, pending Accounting.",
        searchLabel: "Search adjustments",
        createLabel: "Request adjustment",
        createPermission: SALES_PERMISSIONS.invoiceRequest,
        columns,
        searchText: (row) => `${orderNumber(row.sales_order_id)} ${row.adjustment_type} ${row.reason} ${row.status}`,
        emptyTitle: "No adjustments requested",
        emptyDescription: "Request a credit note or refund against an order.",
        renderCreate: (props) => <AdjustmentDialog {...props} />,
      }}
    />
  );
}

// ------------------------------------------------------------------- returns
function ReturnDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { options } = useOperationOptions();
  const [orderId, setOrderId] = useState("");
  const [lineId, setLineId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const order = options?.orders.find((candidate) => candidate.id === orderId);
  const lineOptions: SelectOption[] = (options?.lines ?? []).filter((line) => line.sales_order_version_id === order?.current_version_id).map((line) => ({ value: line.id, label: `${line.item_name_snapshot} (${line.item_code_snapshot}) — ordered ${Number(line.quantity)}` }));
  const mutation = useMutation({ mutationFn: () => createReturn(orderId, { idempotencyKey, reason, lines: [{ salesOrderLineId: lineId, quantity }] }), onSuccess: onDone });
  return (
    <OperationDialog title="New customer return" confirmLabel="Create return" disabled={!orderId || !lineId || quantity <= 0 || !reason.trim()} mutation={mutation} onClose={onClose}>
      <p className="text-sm text-text-secondary">Only quantities already fulfilled can be returned. The server rejects anything above what was shipped.</p>
      <Select label="Sales order" isRequired options={orderSelectOptions(options?.orders, ["confirmed", "on_hold", "closed"])} selectedKey={orderId || null} onSelectionChange={(key) => { setOrderId(String(key ?? "")); setLineId(""); }} placeholder="Select an order" />
      <Select label="Line" isRequired options={lineOptions} selectedKey={lineId || null} onSelectionChange={(key) => setLineId(String(key ?? ""))} placeholder="Select a line" isDisabled={!orderId} />
      <NumberField label="Quantity to return" isRequired value={quantity} onChange={setQuantity} minValue={0} step={1} />
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </OperationDialog>
  );
}

export function SalesReturnsScreen() {
  const router = useRouter();
  const columns: ColumnDef<ReturnRow, unknown>[] = useMemo(
    () => [
      { id: "request", header: "Return", accessorKey: "request_number", cell: ({ row }) => <span className="font-medium text-text">{row.original.request_number}</span> },
      { id: "order", header: "Order", accessorKey: "sales_order_number" },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "items", header: "Items", accessorFn: (row) => row.lines.map((line) => `${line.itemCode} × ${Number(line.quantity)}`).join(", ") },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
      { id: "requested", header: "Requested", accessorFn: (row) => dateTime(row.requested_at) },
    ],
    [],
  );
  return (
    <SalesRegisterPage<ReturnRow>
      config={{
        kind: "returns",
        title: "Returns",
        description: "Customer return requests against fulfilled order quantities.",
        searchLabel: "Search returns",
        createLabel: "New return",
        createPermission: SALES_PERMISSIONS.orderAmend,
        columns,
        searchText: (row) => `${row.request_number} ${row.sales_order_number} ${row.customer_name ?? ""} ${row.reason} ${row.status}`,
        emptyTitle: "No returns yet",
        emptyDescription: "Create a return for goods a customer sends back.",
        onRowClick: (row) => router.push(`/sales/orders/${row.sales_order_id}`),
        renderCreate: (props) => <ReturnDialog {...props} />,
      }}
    />
  );
}

// ---------------------------------------------------------------- drop-ships
function DropShipDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { options } = useOperationOptions();
  const [orderId, setOrderId] = useState("");
  const [lineId, setLineId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const order = options?.orders.find((candidate) => candidate.id === orderId);
  const lineOptions: SelectOption[] = (options?.lines ?? []).filter((line) => line.sales_order_version_id === order?.current_version_id).map((line) => ({ value: line.id, label: `${line.item_name_snapshot} — ordered ${Number(line.quantity)}` }));
  const supplierOptions: SelectOption[] = (options?.suppliers ?? []).map((supplier) => ({ value: supplier.id, label: `${supplier.display_name} (${supplier.code})` }));
  const mutation = useMutation({ mutationFn: () => createDropShip({ salesOrderId: orderId, salesOrderLineId: lineId, supplierId, quantity, idempotencyKey }), onSuccess: onDone });
  return (
    <OperationDialog title="New drop-ship request" confirmLabel="Create request" disabled={!orderId || !lineId || !supplierId || quantity <= 0} mutation={mutation} onClose={onClose}>
      <Select label="Sales order" isRequired options={orderSelectOptions(options?.orders, ["confirmed", "on_hold"])} selectedKey={orderId || null} onSelectionChange={(key) => { setOrderId(String(key ?? "")); setLineId(""); }} placeholder="Select an order" />
      <Select label="Line" isRequired options={lineOptions} selectedKey={lineId || null} onSelectionChange={(key) => setLineId(String(key ?? ""))} placeholder="Select a line" isDisabled={!orderId} />
      <Select label="Supplier" isRequired options={supplierOptions} selectedKey={supplierId || null} onSelectionChange={(key) => setSupplierId(String(key ?? ""))} placeholder="Select a supplier" />
      <NumberField label="Quantity" isRequired value={quantity} onChange={setQuantity} minValue={0} step={1} />
    </OperationDialog>
  );
}

export function SalesDropShipsScreen() {
  const { options, orderNumber } = useOperationOptions();
  const columns: ColumnDef<DropShipRow, unknown>[] = useMemo(
    () => [
      { id: "order", header: "Order", cell: ({ row }) => <OrderLink id={row.original.sales_order_id} label={orderNumber(row.original.sales_order_id)} /> },
      { id: "supplier", header: "Supplier", accessorFn: (row) => options?.suppliers.find((supplier) => supplier.id === row.supplier_id)?.display_name ?? "—" },
      { id: "quantity", header: "Quantity", accessorFn: (row) => Number(row.quantity) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
      { id: "reference", header: "Procurement ref", accessorFn: (row) => row.procurement_reference ?? "—" },
      { id: "created", header: "Created", accessorFn: (row) => dateTime(row.created_at) },
    ],
    [orderNumber, options],
  );
  return (
    <SalesRegisterPage<DropShipRow>
      config={{
        kind: "drop-ships",
        title: "Drop shipments",
        description: "Order lines fulfilled directly by a supplier to the customer.",
        searchLabel: "Search drop shipments",
        createLabel: "New drop-ship",
        createPermission: SALES_PERMISSIONS.fulfillmentRequest,
        columns,
        searchText: (row) => `${orderNumber(row.sales_order_id)} ${row.status}`,
        emptyTitle: "No drop shipments",
        emptyDescription: "Create one for an order line a supplier ships directly.",
        renderCreate: (props) => <DropShipDialog {...props} />,
      }}
    />
  );
}

// --------------------------------------------------------------- commissions
function CommissionRuleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState(0);
  const [basis, setBasis] = useState<"net_sales" | "gross_margin">("net_sales");
  const mutation = useMutation({ mutationFn: () => createCommissionRule({ name, ratePercent: rate, basis }), onSuccess: onDone });
  return (
    <OperationDialog title="New commission rule" confirmLabel="Create rule" disabled={!name.trim() || rate < 0 || rate > 100} mutation={mutation} onClose={onClose}>
      <TextField label="Rule name" isRequired value={name} onChange={setName} />
      <NumberField label="Rate (%)" isRequired value={rate} onChange={setRate} minValue={0} maxValue={100} step={0.5} />
      <Select
        label="Calculated on"
        options={[
          { value: "net_sales", label: "Net sales (before tax)" },
          { value: "gross_margin", label: "Gross margin" },
        ]}
        selectedKey={basis}
        onSelectionChange={(key) => setBasis(key === "gross_margin" ? "gross_margin" : "net_sales")}
      />
    </OperationDialog>
  );
}

function AccrueDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { options } = useOperationOptions();
  const [orderId, setOrderId] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const mutation = useMutation({ mutationFn: () => accrueCommission({ salesOrderId: orderId, ruleId: ruleId || null, ownerUserId: ownerId || null }), onSuccess: onDone });
  return (
    <OperationDialog title="Accrue commission" confirmLabel="Accrue" disabled={!orderId} mutation={mutation} onClose={onClose}>
      <p className="text-sm text-text-secondary">Accruing again for the same order, salesperson and rule updates the existing entry — it never pays twice.</p>
      <Select label="Sales order" isRequired options={orderSelectOptions(options?.orders, ["confirmed", "on_hold", "closed"])} selectedKey={orderId || null} onSelectionChange={(key) => setOrderId(String(key ?? ""))} placeholder="Select an order" />
      <Select label="Rule (optional — the best match is used)" options={[{ value: "", label: "Best matching rule" }, ...(options?.commissionRules ?? []).map((rule) => ({ value: rule.id, label: `${rule.name} (${Number(rule.rate_percent)}%)` }))]} selectedKey={ruleId} onSelectionChange={(key) => setRuleId(String(key ?? ""))} />
      <Select label="Salesperson (optional — the order owner is used)" options={[{ value: "", label: "Order owner" }, ...(options?.users ?? []).map((user) => ({ value: user.id, label: user.name }))]} selectedKey={ownerId} onSelectionChange={(key) => setOwnerId(String(key ?? ""))} />
    </OperationDialog>
  );
}

export function SalesCommissionsScreen() {
  const { options, orderNumber } = useOperationOptions();
  const userName = (id: string) => options?.users.find((user) => user.id === id)?.name ?? "—";
  const columns: ColumnDef<CommissionRow, unknown>[] = useMemo(
    () => [
      { id: "order", header: "Order", cell: ({ row }) => <OrderLink id={row.original.sales_order_id} label={orderNumber(row.original.sales_order_id)} /> },
      { id: "owner", header: "Salesperson", accessorFn: (row) => userName(row.owner_user_id) },
      { id: "basis", header: "Basis amount", accessorFn: (row) => Number(row.basis_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      { id: "rate", header: "Rate", accessorFn: (row) => `${Number(row.rate_percent)}%` },
      { id: "commission", header: "Commission", accessorFn: (row) => Number(row.commission_amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderNumber, options],
  );
  const [ruleOpen, setRuleOpen] = useState(false);
  const workspace = useWorkspaceContext();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(SALES_PERMISSIONS.settingsManage);
  return (
    <>
      <SalesRegisterPage<CommissionRow>
        config={{
          kind: "commissions",
          title: "Commissions",
          description: "Accrued sales commission per order and salesperson.",
          searchLabel: "Search commissions",
          createLabel: "Accrue commission",
          createPermission: SALES_PERMISSIONS.settingsManage,
          columns,
          searchText: (row) => `${orderNumber(row.sales_order_id)} ${userName(row.owner_user_id)} ${row.status}`,
          emptyTitle: "No commission accrued",
          emptyDescription: "Commission accrues automatically when an order is confirmed and a rule applies, or accrue one here.",
          renderCreate: (props) => <AccrueDialog {...props} />,
        }}
      />
      {canManage && (
        <div className="px-1 pt-3">
          <Button variant="secondary" onPress={() => setRuleOpen(true)}>
            New commission rule
          </Button>
        </div>
      )}
      {ruleOpen && <CommissionRuleDialog onClose={() => setRuleOpen(false)} onDone={() => setRuleOpen(false)} />}
    </>
  );
}

export type { CommissionRuleRow };

// ---------------------------------------------------------------- backorders
export function SalesBackordersScreen() {
  const router = useRouter();
  const columns: ColumnDef<BackorderRow, unknown>[] = useMemo(
    () => [
      { id: "order", header: "Order", accessorKey: "sales_order_number", cell: ({ row }) => <OrderLink id={row.original.sales_order_id} label={row.original.sales_order_number} /> },
      { id: "customer", header: "Customer", accessorFn: (row) => row.customer_name ?? "—" },
      { id: "item", header: "Item", accessorFn: (row) => `${row.item_name_snapshot} (${row.item_code_snapshot})` },
      { id: "ordered", header: "Ordered", accessorFn: (row) => Number(row.quantity) },
      { id: "shipped", header: "Shipped", accessorFn: (row) => Number(row.fulfilled_quantity) },
      { id: "owed", header: "Still owed", accessorFn: (row) => Number(row.backordered_quantity) },
      { id: "due", header: "Delivery by", accessorFn: (row) => (row.requested_delivery_date ? row.requested_delivery_date.slice(0, 10) : "—") },
    ],
    [],
  );
  return (
    <SalesRegisterPage<BackorderRow>
      config={{
        kind: "backorders",
        title: "Backorders",
        description: "Lines that have partly shipped and still owe quantity to the customer.",
        searchLabel: "Search backorders",
        columns,
        searchText: (row) => `${row.sales_order_number} ${row.customer_name ?? ""} ${row.item_name_snapshot} ${row.item_code_snapshot}`,
        emptyTitle: "No backorders",
        emptyDescription: "Nothing is partly shipped and outstanding.",
        onRowClick: (row) => router.push(`/sales/orders/${row.sales_order_id}`),
      }}
    />
  );
}

// ----------------------------------------------------------------- discounts
export function SalesDiscountsScreen() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => request<{ options: SalesOptions }>("/options").then((r) => r.options) });
  const party = (id: string | null) => (id ? (options.data?.parties.find((p) => p.id === id)?.display_name ?? "—") : "All customers");
  const item = (id: string | null) => (id ? (options.data?.items.find((i) => i.id === id)?.name ?? "—") : "All items");
  const columns: ColumnDef<PricingRuleRow, unknown>[] = useMemo(
    () => [
      { id: "name", header: "Rule", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "customer", header: "Customer", accessorFn: (row) => party(row.party_id) },
      { id: "item", header: "Item", accessorFn: (row) => item(row.item_id) },
      { id: "type", header: "Adjustment", accessorFn: (row) => statusLabel(row.adjustment_type) },
      { id: "value", header: "Value", accessorFn: (row) => Number(row.adjustment_value).toLocaleString(undefined, { maximumFractionDigits: 4 }) },
      { id: "min", header: "From quantity", accessorFn: (row) => Number(row.minimum_quantity) },
      { id: "valid", header: "Valid", accessorFn: (row) => `${row.valid_from?.slice(0, 10) ?? "any time"} → ${row.valid_to?.slice(0, 10) ?? "open"}` },
      { id: "status", header: "Status", accessorKey: "status", cell: ({ row }) => badge(row.original.status) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options.data],
  );
  return (
    <>
      <SalesRegisterPage<PricingRuleRow>
        config={{
          kind: "pricing-rules",
          title: "Discounts",
          description: "Customer-specific price and discount rules applied automatically when documents are priced.",
          searchLabel: "Search discount rules",
          columns,
          searchText: (row) => `${row.name} ${party(row.party_id)} ${item(row.item_id)} ${row.adjustment_type}`,
          emptyTitle: "No discount rules yet",
          emptyDescription: "Customer prices are created on the Price Lists page and appear here.",
        }}
      />
      <p className="px-1 pt-3 text-sm text-text-secondary">
        Create or change customer prices in <Link href="/sales/price-lists" className="text-brand hover:underline">Price Lists</Link>.
      </p>
    </>
  );
}

// --------------------------------------------------------------------- terms
type TermRow = { id: string; code: string; name: string; default_due_days: number; customers: number };
export function SalesTermsScreen() {
  const workspace = useWorkspaceContext();
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "sales", "options"), queryFn: () => request<{ options: SalesOptions }>("/options").then((r) => r.options) });
  const rows: TermRow[] = useMemo(
    () => (options.data?.paymentTerms ?? []).map((term) => ({ ...term, customers: options.data?.parties.filter((party) => party.payment_term_id === term.id).length ?? 0 })),
    [options.data],
  );
  const columns: ColumnDef<TermRow, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      { id: "name", header: "Name", accessorKey: "name", cell: ({ row }) => <span className="font-medium text-text">{row.original.name}</span> },
      { id: "days", header: "Due in", accessorFn: (row) => `${row.default_due_days} days` },
      { id: "customers", header: "Customers using it as default", accessorFn: (row) => row.customers },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Terms" description="Payment terms available on quotations and orders. The term chosen on a document is snapshotted onto it, so later changes never rewrite history." />
      <EnterpriseDataGrid<TermRow>
        aria-label="Payment terms"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={options.isLoading ? "loading" : options.isError ? "error" : rows.length === 0 ? "empty" : "ready"}
        loadingContent={<p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>}
        emptyContent={<p className="px-4 py-8 text-sm text-text-muted">No payment terms are configured. An administrator can add them in Settings.</p>}
        errorContent={<ErrorState title="Could not load payment terms" action={{ label: "Retry", onPress: () => options.refetch() }} />}
      />
    </div>
  );
}
