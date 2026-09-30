import type { OperationConfig } from "@/features/procurement/shared/OperationRegister";
import {
  dateTime,
  money,
  statusLabel,
} from "@/features/procurement/shared/format";

const numberText = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "—"
    : Number(value).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });

export const invoicesRegister: OperationConfig = {
  kind: "invoice-matches",
  title: "Supplier invoices",
  description:
    "Every supplier invoice matched against its purchase order (and receipts). Clean matches can be handed to Accounting as vendor bills.",
  searchLabel: "Search invoices",
  createLabel: "Record supplier invoice",
  createPermission: "procurement.matching.manage",
  newHref: "/procurement/invoices/new",
  columns: (lookup) => [
    {
      id: "inv",
      header: "Invoice",
      accessorFn: (r) => String(r.invoice_number ?? "—"),
      cell: ({ row }) => (
        <span className="font-medium text-text">
          {String(row.original.invoice_number ?? "—")}
        </span>
      ),
    },
    {
      id: "po",
      header: "Purchase order",
      accessorFn: (r) => lookup.order(r.purchase_order_id),
    },
    {
      id: "supplier",
      header: "Supplier",
      accessorFn: (r) => lookup.supplier(r.supplier_id),
    },
    {
      id: "mode",
      header: "Match",
      accessorFn: (r) => statusLabel(r.match_mode),
    },
    {
      id: "status",
      header: "Result",
      accessorFn: (r) => statusLabel(r.status),
    },
    {
      id: "total",
      header: "Invoice total",
      accessorFn: (r) => money(r.currency_code, r.invoice_total),
    },
    {
      id: "variance",
      header: "Variance",
      accessorFn: (r) => numberText(r.variance_amount),
    },
    {
      id: "when",
      header: "Matched",
      accessorFn: (r) => dateTime(r.created_at),
    },
  ],
  searchText: (r) => `${r.invoice_number} ${r.status} ${r.match_mode}`,
  emptyTitle: "No invoices matched yet",
  emptyDescription:
    "Record a supplier invoice to match it against the order and receipts.",
};
