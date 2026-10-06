import Link from "next/link";

import {
  boldCol,
  col,
  dateCol,
  lineColumns,
  statusCol,
} from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { FieldValue } from "@/features/procurement/shared/FieldInput";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { calendarDate, quantity } from "@/features/procurement/shared/format";

type Line = Record<string, unknown>;
const sum = (lines: unknown, key: string) =>
  (Array.isArray(lines) ? (lines as Line[]) : []).reduce(
    (total, line) => total + Number(line[key] ?? 0),
    0,
  );
const STATUSES = ["draft", "submitted", "approved", "rejected", "reversed"];

export const receiptsList: ListConfig = {
  resource: "receipts",
  title: "Goods receipts",
  description:
    "Goods received against purchase orders. Approving a receipt puts the accepted quantity into stock.",
  searchLabel: "Search receipts",
  statuses: STATUSES,
  columns: (lookup) => [
    boldCol("number", "Receipt", (r) => String(r.receiptNumber ?? "—")),
    col("po", "Purchase order", (r) => lookup.order(r.purchaseOrderId)),
    statusCol(),
    dateCol("date", "Received", "receiptDate"),
    col("acc", "Accepted", (r) => quantity(sum(r.lines, "acceptedQuantity"))),
    col("rej", "Rejected", (r) => quantity(sum(r.lines, "rejectedQuantity"))),
  ],
  detailHref: (r) => `/procurement/receipts/${r.id}`,
  newHref: "/procurement/receipts/new",
  newLabel: "New goods receipt",
  createPermission: "procurement.receipts.manage",
  emptyTitle: "No receipts yet",
  emptyDescription: "Receive goods from an approved purchase order.",
};

export const rejectionsList: ListConfig = {
  resource: "receipts",
  title: "Rejections",
  description:
    "Receipts where some or all of the goods were rejected, and why.",
  searchLabel: "Search rejections",
  statuses: STATUSES,
  baseFilter: (r) =>
    sum(r.lines, "rejectedQuantity") > 0 || r.status === "rejected",
  columns: (lookup) => [
    boldCol("number", "Receipt", (r) => String(r.receiptNumber ?? "—")),
    col("po", "Purchase order", (r) => lookup.order(r.purchaseOrderId)),
    statusCol(),
    col("rej", "Rejected qty", (r) =>
      quantity(sum(r.lines, "rejectedQuantity")),
    ),
    col(
      "why",
      "Reasons",
      (r) =>
        (Array.isArray(r.lines) ? (r.lines as Line[]) : [])
          .map((line) => line.rejectionReason)
          .filter(Boolean)
          .join("; ") || "—",
    ),
    dateCol("date", "Received", "receiptDate"),
  ],
  detailHref: (r) => `/procurement/receipts/${r.id}`,
  emptyTitle: "No rejections",
  emptyDescription: "Nothing received has been rejected.",
};

const receiptLineFields = [
  {
    name: "description",
    label: "Description",
    kind: "text" as const,
    required: true,
  },
  {
    name: "acceptedQuantity",
    label: "Accepted",
    kind: "number" as const,
    defaultValue: 0,
    step: 1,
  },
  {
    name: "rejectedQuantity",
    label: "Rejected",
    kind: "number" as const,
    defaultValue: 0,
    step: 1,
  },
  { name: "rejectionReason", label: "Rejection reason", kind: "text" as const },
  {
    name: "warehouseId",
    label: "Warehouse",
    kind: "select" as const,
    options: "warehouses" as const,
    placeholder: "Warehouse",
  },
];

export const receiptForm: FormConfig = {
  resource: "receipts",
  noun: "goods receipt",
  backHref: "/procurement/receipts",
  detailHref: (id) => `/procurement/receipts/${id}`,
  fields: [
    {
      name: "purchaseOrderId",
      label: "Purchase order",
      kind: "select",
      options: "purchaseOrders",
      required: true,
    },
    { name: "receiptDate", label: "Received on", kind: "date", required: true },
    { name: "deliveryNote", label: "Supplier delivery note", kind: "text" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  lines: {
    key: "lines",
    label: "Goods received",
    addLabel: "Add line",
    fields: receiptLineFields,
  },
  fromSources: {
    order: {
      resource: "purchase-orders",
      map: (po) => ({
        values: { purchaseOrderId: po.id },
        // one line per PO line still to receive, defaulted to the outstanding quantity
        lines: (Array.isArray(po.lines) ? (po.lines as Line[]) : [])
          .map((line) => ({
            line,
            remaining:
              Number(line.quantity ?? 0) - Number(line.receivedQuantity ?? 0),
          }))
          .filter(({ remaining }) => remaining > 0)
          .map(({ line, remaining }) => {
            const out: Record<string, FieldValue> = {
              purchaseOrderLineId: String(line.id),
              description: String(line.description ?? ""),
              acceptedQuantity: remaining,
              rejectedQuantity: 0,
            };
            if (line.itemId) out.itemId = String(line.itemId);
            if (line.warehouseId) out.warehouseId = String(line.warehouseId);
            return out;
          }),
      }),
    },
  },
};

export const receiptDetail: DetailConfig = {
  resource: "receipts",
  backHref: "/procurement/receipts",
  backLabel: "All receipts",
  noun: "goods receipt",
  title: (r) => String(r.receiptNumber ?? "Goods receipt"),
  fields: (r, lookup) => [
    {
      label: "Purchase order",
      value: r.purchaseOrderId ? (
        <Link
          className="text-brand hover:underline"
          href={`/procurement/orders/${r.purchaseOrderId}`}
        >
          {lookup.order(r.purchaseOrderId)}
        </Link>
      ) : (
        "—"
      ),
    },
    { label: "Received on", value: calendarDate(r.receiptDate) },
    ...(r.supplierShipFrom ? [{ label: "Supplier ship-from", value: [r.supplierShipFrom.label, r.supplierShipFrom.city, r.supplierShipFrom.state].filter(Boolean).join(", ") }] : []),
    { label: "Delivery note", value: String(r.deliveryNote ?? "—") },
    { label: "Notes", value: String(r.notes ?? "—") },
  ],
  metrics: (r) => [
    { label: "Accepted", value: quantity(sum(r.lines, "acceptedQuantity")) },
    { label: "Rejected", value: quantity(sum(r.lines, "rejectedQuantity")) },
    {
      label: "Lines",
      value: String(Array.isArray(r.lines) ? r.lines.length : 0),
    },
  ],
  actions: [
    {
      action: "submit",
      label: "Submit for approval",
      from: ["draft"],
      permission: "procurement.receipts.manage",
      primary: true,
    },
    {
      action: "approve",
      label: "Approve and post to stock",
      from: ["submitted"],
      permission: "procurement.receipts.approve",
      primary: true,
      hint: "Approving puts the accepted quantities into stock.",
    },
    {
      action: "reject",
      label: "Reject receipt",
      from: ["submitted"],
      permission: "procurement.receipts.approve",
      reason: "required",
    },
    {
      action: "reverse",
      label: "Reverse",
      from: ["approved"],
      permission: "procurement.receipts.approve",
      reason: "required",
      hint: "Reversing takes the accepted quantities back out of stock and reopens the order quantity.",
    },
  ],
  editHref: (r) => `/procurement/receipts/${r.id}/edit`,
  editPermission: "procurement.receipts.manage",
  lineGrids: [
    {
      title: "Goods received",
      key: "lines",
      columns: (lookup) => [
        ...lineColumns(lookup, { accepted: true }),
        {
          id: "why",
          header: "Rejection reason",
          accessorFn: (line: Record<string, unknown>) =>
            String(line.rejectionReason ?? "—"),
        },
      ],
    },
  ],
};

// ------------------------------------------------------------------ match exceptions
export const exceptionsList: ListConfig = {
  resource: "match-exceptions",
  title: "Three-way match",
  description:
    "Supplier invoices that did not match the order and receipt within tolerance. Resolve them, or override with a reason.",
  searchLabel: "Search exceptions",
  statuses: ["open", "resolved", "overridden"],
  columns: (lookup) => [
    boldCol("number", "Exception", (r) => String(r.exceptionNumber ?? "—")),
    col("inv", "Invoice", (r) => String(r.invoiceNumber ?? "—")),
    col("po", "Purchase order", (r) => lookup.order(r.purchaseOrderId)),
    col("supplier", "Supplier", (r) => lookup.supplier(r.supplierId)),
    statusCol(),
    col("var", "Variance", (r) =>
      r.varianceAmount
        ? Number(r.varianceAmount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
          })
        : "—",
    ),
  ],
  detailHref: (r) => `/procurement/three-way-match/${r.id}`,
  emptyTitle: "No match exceptions",
  emptyDescription: "Invoices that match cleanly never appear here.",
};

export const exceptionDetail: DetailConfig = {
  resource: "match-exceptions",
  backHref: "/procurement/three-way-match",
  backLabel: "All match exceptions",
  noun: "match exception",
  title: (r) => String(r.exceptionNumber ?? r.title ?? "Match exception"),
  fields: (r, lookup) => [
    { label: "Invoice", value: String(r.invoiceNumber ?? "—") },
    {
      label: "Purchase order",
      value: r.purchaseOrderId ? (
        <Link
          className="text-brand hover:underline"
          href={`/procurement/orders/${r.purchaseOrderId}`}
        >
          {lookup.order(r.purchaseOrderId)}
        </Link>
      ) : (
        "—"
      ),
    },
    { label: "Supplier", value: lookup.supplier(r.supplierId) },
    {
      label: "Variance",
      value: r.varianceAmount
        ? Number(r.varianceAmount).toLocaleString(undefined, {
            minimumFractionDigits: 2,
          })
        : "—",
    },
  ],
  actions: [
    {
      action: "resolve",
      label: "Mark resolved",
      from: ["open"],
      permission: "procurement.matching.manage",
      primary: true,
      reason: "optional",
      hint: "Use once the cause is fixed (credit note received, order corrected, ...).",
    },
    {
      action: "override",
      label: "Override",
      from: ["open", "resolved"],
      permission: "procurement.matching.override",
      reason: "required",
      hint: "Accepts the variance as it is. Recorded with your reason.",
    },
    {
      action: "reopen",
      label: "Reopen",
      from: ["resolved", "overridden"],
      permission: "procurement.matching.manage",
      reason: "optional",
    },
  ],
  lineGrids: [
    {
      title: "Why it did not match",
      key: "issues",
      columns: () => [
        {
          id: "type",
          header: "Issue",
          accessorFn: (issue: Record<string, unknown>) =>
            String(issue.type ?? "—").replace(/-/g, " "),
        },
        {
          id: "line",
          header: "Line",
          accessorFn: (issue: Record<string, unknown>) =>
            String(issue.line ?? "—"),
        },
        {
          id: "detail",
          header: "Detail",
          accessorFn: (issue: Record<string, unknown>) =>
            [
              issue.variance && `variance ${issue.variance}`,
              issue.attemptedCumulativeQuantity &&
                `invoiced ${issue.attemptedCumulativeQuantity}`,
              issue.eligibleQuantity && `eligible ${issue.eligibleQuantity}`,
              issue.tolerancePercent !== undefined &&
                `tolerance ${issue.tolerancePercent}%`,
            ]
              .filter(Boolean)
              .join(" · ") || "—",
        },
      ],
    },
  ],
};
