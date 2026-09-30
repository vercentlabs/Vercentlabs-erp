"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  ErrorState,
  NumberField,
  PageHeader,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { SALES_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import {
  getSalesOrder,
  type SalesOrderLine,
} from "@/features/sales/orders/api/orders-api";
import type { SalesOptions } from "@/features/sales/quotations/api/quotations-api";
import {
  dateTime,
  money,
  statusLabel,
  statusTone,
} from "@/features/sales/shared/format";
import { SalesAlert } from "@/features/sales/shared/SalesUi";
import {
  decideAdjustment,
  requestAdjustment,
  type AdjustmentRow,
  completeDelivery,
  type PricingRuleRow,
  type FulfillmentRegisterRow,
  type InvoiceRegisterRow,
} from "@/features/sales/operations/api/operations-api";
import { SalesRegisterPage } from "@/features/sales/operations/screens/SalesRegisterPage";

type OrderOption = {
  id: string;
  sales_order_number: string;
  lifecycle_status: string;
  currency_code: string;
  grand_total: string;
  current_version_id: string;
};
type LineOption = {
  id: string;
  sales_order_version_id: string;
  item_name_snapshot: string;
  item_code_snapshot: string;
  quantity: string;
};
type Options = {
  orders: OrderOption[];
  lines: LineOption[];
  commissionRules: Array<{
    id: string;
    name: string;
    rate_percent: string;
    basis: string;
  }>;
  suppliers: Array<{ id: string; code: string; display_name: string }>;
  users: Array<{ id: string; name: string }>;
};

function useOperationOptions() {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "operation-options"),
    queryFn: () =>
      request<{ options: Options }>("/operations/options").then(
        (r) => r.options,
      ),
  });
  const orderNumber = (id: string) =>
    query.data?.orders.find((order) => order.id === id)?.sales_order_number ??
    "—";
  return { options: query.data, orderNumber };
}

const badge = (value: string) => (
  <StatusBadge tone={statusTone(value)}>{statusLabel(value)}</StatusBadge>
);
const OrderLink = ({ id, label }: { id: string; label: string }) => (
  <Link
    href={`/sales/orders/${id}`}
    className="font-medium text-brand hover:underline"
    onClick={(event) => event.stopPropagation()}
  >
    {label}
  </Link>
);

// Shared shell for the create dialogs: one place for the error banner, the
// pending state and the button row, so every dialog behaves the same way.
// F052–F057: one prompt for every after-sales decision — the fields it
// needs, then the call. Errors from the server (caps, self-approval, wrong
// state) show in the dialog.
type PromptField = {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  options?: Array<{ value: string; label: string }>;
};
type Prompt = {
  title: string;
  confirmLabel: string;
  fields: PromptField[];
  intro?: string;
  submit: (values: Record<string, string>) => Promise<unknown>;
  refresh: () => void;
};
function PromptDialog({
  prompt,
  onClose,
}: {
  prompt: Prompt;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      prompt.fields.map((field) => [
        field.key,
        field.options?.[0]?.value ?? "",
      ]),
    ),
  );
  const mutation = useMutation({
    mutationFn: () => prompt.submit(values),
    onSuccess: () => {
      prompt.refresh();
      onClose();
    },
  });
  const missing = prompt.fields.some(
    (field) =>
      field.required &&
      (values[field.key] ?? "").trim().length < (field.multiline ? 5 : 1),
  );
  return (
    <OperationDialog
      title={prompt.title}
      confirmLabel={prompt.confirmLabel}
      disabled={missing}
      mutation={mutation}
      onClose={onClose}
    >
      {prompt.intro && (
        <p className="text-sm text-text-secondary">{prompt.intro}</p>
      )}
      {prompt.fields.map((field) =>
        field.options ? (
          <Select
            key={field.key}
            label={field.label}
            options={field.options}
            selectedKey={values[field.key]}
            onSelectionChange={(key) =>
              setValues((current) => ({
                ...current,
                [field.key]: String(key ?? ""),
              }))
            }
          />
        ) : field.multiline ? (
          <TextArea
            key={field.key}
            label={field.label}
            isRequired={field.required}
            value={values[field.key]}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.key]: value }))
            }
          />
        ) : (
          <TextField
            key={field.key}
            label={field.label}
            isRequired={field.required}
            value={values[field.key]}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.key]: value }))
            }
          />
        ),
      )}
    </OperationDialog>
  );
}
function usePrompt() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  return {
    open: setPrompt,
    dialog: prompt ? (
      <PromptDialog prompt={prompt} onClose={() => setPrompt(null)} />
    ) : null,
  };
}
const actionButton = (label: string, onPress: () => void) => (
  <Button key={label} variant="ghost" size="compact" onPress={onPress}>
    {label}
  </Button>
);

function OperationDialog({
  title,
  confirmLabel,
  disabled,
  mutation,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  disabled?: boolean;
  mutation: { isPending: boolean; error: unknown; mutate: () => void };
  onClose: () => void;
  children: ReactNode;
}) {
  const message = mutation.error
    ? mutation.error instanceof SalesApiError
      ? mutation.error.message
      : "This could not be saved."
    : null;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title={title}>
      <div className="flex flex-col gap-4">
        {message && <SalesAlert>{message}</SalesAlert>}
        {children}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onPress={() => mutation.mutate()}
            isLoading={mutation.isPending}
            isDisabled={disabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const orderSelectOptions = (
  orders: OrderOption[] = [],
  allowed: string[],
): SelectOption[] =>
  orders
    .filter((order) => allowed.includes(order.lifecycle_status))
    .map((order) => ({
      value: order.id,
      label: `${order.sales_order_number} — ${money(order.currency_code, order.grand_total)}`,
    }));

// ---------------------------------------------------------------- deliveries
function CompleteDeliveryDialog({
  row,
  onClose,
  onDone,
}: {
  row: FulfillmentRegisterRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const workspace = useWorkspaceContext();
  const order = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "order", row.sales_order_id),
    queryFn: () => getSalesOrder(row.sales_order_id).then((r) => r.detail),
  });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const lines: SalesOrderLine[] = (order.data?.lines ?? []).filter(
    (line) => Number(line.remaining_to_fulfill) > 0,
  );
  const chosen = lines
    .map((line) => ({
      salesOrderLineId: line.id,
      fulfilledQuantity:
        quantities[line.id] ?? Number(line.remaining_to_fulfill),
    }))
    .filter((line) => line.fulfilledQuantity > 0);
  const mutation = useMutation({
    mutationFn: () => completeDelivery(row.id, chosen),
    onSuccess: onDone,
  });
  return (
    <OperationDialog
      title={`Complete delivery ${row.request_number}`}
      confirmLabel="Complete delivery"
      disabled={chosen.length === 0}
      mutation={mutation}
      onClose={onClose}
    >
      <p className="text-sm text-text-secondary">
        Enter what actually shipped. Stock is issued for every line with a
        warehouse; a shortfall stays open as a backorder.
      </p>
      {order.isLoading && (
        <p className="text-sm text-text-muted">Loading order lines…</p>
      )}
      {lines.map((line) => (
        <NumberField
          key={line.id}
          label={`${line.item_name_snapshot} — ${Number(line.remaining_to_fulfill)} remaining`}
          value={quantities[line.id] ?? Number(line.remaining_to_fulfill)}
          onChange={(value) =>
            setQuantities((current) => ({ ...current, [line.id]: value }))
          }
          minValue={0}
          maxValue={Number(line.remaining_to_fulfill)}
          step={1}
        />
      ))}
      {order.data && lines.length === 0 && (
        <p className="text-sm text-text-muted">
          Everything on this order has already shipped.
        </p>
      )}
    </OperationDialog>
  );
}

export function SalesDeliveriesScreen() {
  const router = useRouter();
  const [completing, setCompleting] = useState<{
    row: FulfillmentRegisterRow;
    refresh: () => void;
  } | null>(null);
  const columns: ColumnDef<FulfillmentRegisterRow, unknown>[] = useMemo(
    () => [
      {
        id: "request",
        header: "Request",
        accessorKey: "request_number",
        cell: ({ row }) => (
          <span className="font-medium text-text">
            {row.original.request_number}
          </span>
        ),
      },
      { id: "order", header: "Order", accessorKey: "sales_order_number" },
      {
        id: "customer",
        header: "Customer",
        accessorFn: (row) => row.customer_name ?? "—",
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => badge(row.original.status),
      },
      {
        id: "requested",
        header: "Requested",
        accessorFn: (row) => dateTime(row.requested_at),
      },
      {
        id: "completed",
        header: "Completed",
        accessorFn: (row) => dateTime(row.completed_at),
      },
      {
        id: "shipment",
        header: "Shipment",
        accessorFn: (row) =>
          row.shipped_at
            ? `${row.carrier ?? ""}${row.tracking_number ? ` · ${row.tracking_number}` : ""}`
            : "—",
      },
      {
        id: "delivered",
        header: "Delivered",
        accessorFn: (row) =>
          row.delivered_at
            ? `${dateTime(row.delivered_at)} · ${row.received_by ?? ""}`
            : "—",
      },
      {
        id: "error",
        header: "Last error",
        accessorFn: (row) => row.last_error ?? "—",
      },
    ],
    [],
  );
  return (
    <>
      <SalesRegisterPage<FulfillmentRegisterRow>
        config={{
          kind: "fulfillment-requests",
          title: "Deliveries",
          description:
            "Fulfilment requests handed to the warehouse, with their progress.",
          searchLabel: "Search deliveries",
          columns,
          searchText: (row) =>
            `${row.request_number} ${row.sales_order_number} ${row.customer_name ?? ""} ${row.status}`,
          emptyTitle: "No fulfilment requests yet",
          emptyDescription: "Request fulfilment from a confirmed sales order.",
          onRowClick: (row) =>
            router.push(`/sales/orders/${row.sales_order_id}`),
          rowActions: (row, refresh) =>
            ["pending", "processing", "failed"].includes(row.status) ? (
              <Button
                variant="ghost"
                size="compact"
                onPress={() => setCompleting({ row, refresh })}
              >
                Complete delivery
              </Button>
            ) : null,
        }}
      />
      {completing && (
        <CompleteDeliveryDialog
          row={completing.row}
          onClose={() => setCompleting(null)}
          onDone={() => {
            completing.refresh();
            setCompleting(null);
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ invoices
export function SalesInvoicesScreen() {
  const router = useRouter();
  const columns: ColumnDef<InvoiceRegisterRow, unknown>[] = useMemo(
    () => [
      {
        id: "request",
        header: "Request",
        accessorKey: "request_number",
        cell: ({ row }) => (
          <span className="font-medium text-text">
            {row.original.request_number}
          </span>
        ),
      },
      { id: "order", header: "Order", accessorKey: "sales_order_number" },
      {
        id: "customer",
        header: "Customer",
        accessorFn: (row) => row.customer_name ?? "—",
      },
      {
        id: "basis",
        header: "Quantities",
        accessorFn: (row) => statusLabel(row.quantity_basis),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => badge(row.original.status),
      },
      {
        id: "total",
        header: "Order total",
        accessorFn: (row) => money(row.currency_code, row.grand_total),
      },
      {
        id: "requested",
        header: "Requested",
        accessorFn: (row) => dateTime(row.requested_at),
      },
    ],
    [],
  );
  return (
    <SalesRegisterPage<InvoiceRegisterRow>
      config={{
        kind: "invoice-requests",
        title: "Invoices",
        description:
          "Invoice requests raised from sales orders and handed to Accounting.",
        searchLabel: "Search invoice requests",
        columns,
        searchText: (row) =>
          `${row.request_number} ${row.sales_order_number} ${row.customer_name ?? ""} ${row.status}`,
        emptyTitle: "No invoice requests yet",
        emptyDescription: "Request an invoice from a confirmed sales order.",
        onRowClick: (row) => router.push(`/sales/orders/${row.sales_order_id}`),
      }}
    />
  );
}

// --------------------------------------------------------------- adjustments
function AdjustmentDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const { options } = useOperationOptions();
  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState<"credit_note" | "refund">("credit_note");
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      requestAdjustment({
        salesOrderId: orderId,
        adjustmentType: type,
        amount,
        reason,
      }),
    onSuccess: onDone,
  });
  return (
    <OperationDialog
      title="Request credit adjustment"
      confirmLabel="Request adjustment"
      disabled={!orderId || amount <= 0 || !reason.trim()}
      mutation={mutation}
      onClose={onClose}
    >
      <Select
        label="Sales order"
        isRequired
        options={orderSelectOptions(options?.orders, [
          "confirmed",
          "on_hold",
          "closed",
        ])}
        selectedKey={orderId || null}
        onSelectionChange={(key) => setOrderId(String(key ?? ""))}
        placeholder="Select an order"
      />
      <Select
        label="Type"
        options={[
          { value: "credit_note", label: "Credit note" },
          { value: "refund", label: "Refund" },
        ]}
        selectedKey={type}
        onSelectionChange={(key) =>
          setType(key === "refund" ? "refund" : "credit_note")
        }
      />
      <NumberField
        label="Amount"
        isRequired
        value={amount}
        onChange={setAmount}
        minValue={0}
        step={0.01}
      />
      <TextArea label="Reason" isRequired value={reason} onChange={setReason} />
    </OperationDialog>
  );
}

export function SalesAdjustmentsScreen() {
  const { orderNumber } = useOperationOptions();
  const prompt = usePrompt();
  const columns: ColumnDef<AdjustmentRow, unknown>[] = useMemo(
    () => [
      {
        id: "order",
        header: "Order",
        cell: ({ row }) => (
          <OrderLink
            id={row.original.sales_order_id}
            label={orderNumber(row.original.sales_order_id)}
          />
        ),
      },
      {
        id: "type",
        header: "Type",
        accessorFn: (row) => statusLabel(row.adjustment_type),
      },
      {
        id: "amount",
        header: "Amount",
        accessorFn: (row) => money(row.currency_code, row.amount),
      },
      { id: "reason", header: "Reason", accessorKey: "reason" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => badge(row.original.status),
      },
      {
        id: "created",
        header: "Requested",
        accessorFn: (row) => dateTime(row.created_at),
      },
      {
        id: "decision",
        header: "Decision note",
        accessorFn: (row) => row.decision_note ?? "—",
      },
    ],
    [orderNumber],
  );
  return (
    <>
      {prompt.dialog}
      <SalesRegisterPage<AdjustmentRow>
        config={{
          kind: "adjustments",
          title: "Credit / Adjustments",
          description:
            "Credit notes (at most what was invoiced) and refunds (at most what was paid) requested against orders. Someone other than the requester approves; Accounting then posts them.",
          searchLabel: "Search adjustments",
          createLabel: "Request adjustment",
          createPermission: SALES_PERMISSIONS.invoiceRequest,
          columns,
          searchText: (row) =>
            `${orderNumber(row.sales_order_id)} ${row.adjustment_type} ${row.reason} ${row.status}`,
          emptyTitle: "No adjustments requested",
          emptyDescription: "Request a credit note or refund against an order.",
          renderCreate: (props) => <AdjustmentDialog {...props} />,
          rowActions: (row, refresh) =>
            row.status === "pending" ? (
              <span className="flex gap-1">
                {actionButton("Approve", () =>
                  prompt.open({
                    title: `Approve ${statusLabel(row.adjustment_type).toLowerCase()} of ${money(row.currency_code, row.amount)}`,
                    confirmLabel: "Approve",
                    fields: [{ key: "note", label: "Note (optional)" }],
                    submit: (values) =>
                      decideAdjustment(row.id, "approved", values.note),
                    refresh,
                  }),
                )}
                {actionButton("Reject", () =>
                  prompt.open({
                    title: `Reject ${statusLabel(row.adjustment_type).toLowerCase()}`,
                    confirmLabel: "Reject",
                    fields: [
                      {
                        key: "note",
                        label: "Why is it rejected?",
                        required: true,
                        multiline: true,
                      },
                    ],
                    submit: (values) =>
                      decideAdjustment(row.id, "rejected", values.note),
                    refresh,
                  }),
                )}
              </span>
            ) : null,
        }}
      />
    </>
  );
}

// ----------------------------------------------------------------- discounts
export function SalesDiscountsScreen() {
  const workspace = useWorkspaceContext();
  const options = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options"),
    queryFn: () =>
      request<{ options: SalesOptions }>("/options").then((r) => r.options),
  });
  const party = (id: string | null) =>
    id
      ? (options.data?.parties.find((p) => p.id === id)?.display_name ?? "—")
      : "All customers";
  const item = (id: string | null) =>
    id
      ? (options.data?.items.find((i) => i.id === id)?.name ?? "—")
      : "All items";
  const columns: ColumnDef<PricingRuleRow, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Rule",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="font-medium text-text">{row.original.name}</span>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        accessorFn: (row) => party(row.party_id),
      },
      { id: "item", header: "Item", accessorFn: (row) => item(row.item_id) },
      {
        id: "type",
        header: "Adjustment",
        accessorFn: (row) => statusLabel(row.adjustment_type),
      },
      {
        id: "value",
        header: "Value",
        accessorFn: (row) =>
          Number(row.adjustment_value).toLocaleString(undefined, {
            maximumFractionDigits: 4,
          }),
      },
      {
        id: "min",
        header: "From quantity",
        accessorFn: (row) => Number(row.minimum_quantity),
      },
      {
        id: "valid",
        header: "Valid",
        accessorFn: (row) =>
          `${row.valid_from?.slice(0, 10) ?? "any time"} → ${row.valid_to?.slice(0, 10) ?? "open"}`,
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ row }) => badge(row.original.status),
      },
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
          description:
            "Customer-specific price and discount rules applied automatically when documents are priced.",
          searchLabel: "Search discount rules",
          columns,
          searchText: (row) =>
            `${row.name} ${party(row.party_id)} ${item(row.item_id)} ${row.adjustment_type}`,
          emptyTitle: "No discount rules yet",
          emptyDescription:
            "Customer prices are created on the Price Lists page and appear here.",
        }}
      />
      <p className="px-1 pt-3 text-sm text-text-secondary">
        Create or change customer prices in{" "}
        <Link href="/sales/price-lists" className="text-brand hover:underline">
          Price Lists
        </Link>
        .
      </p>
    </>
  );
}

// --------------------------------------------------------------------- terms
type TermRow = {
  id: string;
  code: string;
  name: string;
  default_due_days: number;
  customers: number;
};
export function SalesTermsScreen() {
  const workspace = useWorkspaceContext();
  const options = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "options"),
    queryFn: () =>
      request<{ options: SalesOptions }>("/options").then((r) => r.options),
  });
  const rows: TermRow[] = useMemo(
    () =>
      (options.data?.paymentTerms ?? []).map((term) => ({
        ...term,
        customers:
          options.data?.parties.filter(
            (party) => party.payment_term_id === term.id,
          ).length ?? 0,
      })),
    [options.data],
  );
  const columns: ColumnDef<TermRow, unknown>[] = useMemo(
    () => [
      { id: "code", header: "Code", accessorKey: "code" },
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        cell: ({ row }) => (
          <span className="font-medium text-text">{row.original.name}</span>
        ),
      },
      {
        id: "days",
        header: "Due in",
        accessorFn: (row) => `${row.default_due_days} days`,
      },
      {
        id: "customers",
        header: "Customers using it as default",
        accessorFn: (row) => row.customers,
      },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Terms"
        description="Payment terms available on quotations and orders. The term chosen on a document is snapshotted onto it, so later changes never rewrite history."
      />
      <EnterpriseDataGrid<TermRow>
        aria-label="Payment terms"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        state={
          options.isLoading
            ? "loading"
            : options.isError
              ? "error"
              : rows.length === 0
                ? "empty"
                : "ready"
        }
        loadingContent={
          <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>
        }
        emptyContent={
          <p className="px-4 py-8 text-sm text-text-muted">
            No payment terms are configured. An administrator can add them in
            Settings.
          </p>
        }
        errorContent={
          <ErrorState
            title="Could not load payment terms"
            action={{ label: "Retry", onPress: () => options.refetch() }}
          />
        }
      />
    </div>
  );
}
