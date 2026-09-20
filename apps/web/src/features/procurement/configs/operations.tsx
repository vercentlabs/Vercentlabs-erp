import type { OperationConfig } from "@/features/procurement/shared/OperationRegister";
import { calendarDate, dateTime, money, statusLabel } from "@/features/procurement/shared/format";

const numberText = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }));

export const invoicesRegister: OperationConfig = {
  kind: "invoice-matches",
  title: "Supplier invoices",
  description: "Every supplier invoice matched against its purchase order (and receipts). Clean matches can be handed to Accounting as vendor bills.",
  searchLabel: "Search invoices",
  createLabel: "Record supplier invoice",
  createPermission: "procurement.matching.manage",
  newHref: "/procurement/invoices/new",
  columns: (lookup) => [
    { id: "inv", header: "Invoice", accessorFn: (r) => String(r.invoice_number ?? "—"), cell: ({ row }) => <span className="font-medium text-text">{String(row.original.invoice_number ?? "—")}</span> },
    { id: "po", header: "Purchase order", accessorFn: (r) => lookup.order(r.purchase_order_id) },
    { id: "supplier", header: "Supplier", accessorFn: (r) => lookup.supplier(r.supplier_id) },
    { id: "mode", header: "Match", accessorFn: (r) => statusLabel(r.match_mode) },
    { id: "status", header: "Result", accessorFn: (r) => statusLabel(r.status) },
    { id: "total", header: "Invoice total", accessorFn: (r) => money(r.currency_code, r.invoice_total) },
    { id: "variance", header: "Variance", accessorFn: (r) => numberText(r.variance_amount) },
    { id: "when", header: "Matched", accessorFn: (r) => dateTime(r.created_at) },
  ],
  searchText: (r) => `${r.invoice_number} ${r.status} ${r.match_mode}`,
  emptyTitle: "No invoices matched yet",
  emptyDescription: "Record a supplier invoice to match it against the order and receipts.",
};

export const landedCostRegister: OperationConfig = {
  kind: "landed-costs",
  createPath: "landed-costs",
  title: "Landed cost",
  description: "Freight, duty and other costs on top of the purchase price, tied to an order or receipt.",
  searchLabel: "Search landed costs",
  createLabel: "Add landed cost",
  createPermission: "procurement.matching.manage",
  fields: [
    { name: "purchaseOrderId", label: "Purchase order", kind: "select", options: "purchaseOrders" },
    { name: "receiptId", label: "Goods receipt", kind: "select", options: "receipts" },
    { name: "costType", label: "Cost type", kind: "text", required: true, placeholder: "e.g. Freight, Customs duty" },
    { name: "amount", label: "Amount", kind: "number", required: true },
    { name: "currencyCode", label: "Currency", kind: "text", required: true, defaultValue: "INR" },
    { name: "allocationMethod", label: "Spread across lines by", kind: "select", options: ["value", "quantity", "weight", "manual"].map((value) => ({ value, label: statusLabel(value) })), defaultValue: "value" },
    { name: "note", label: "Note", kind: "textarea" },
  ],
  columns: (lookup) => [
    { id: "type", header: "Cost", accessorFn: (r) => String(r.cost_type ?? "—") },
    { id: "amount", header: "Amount", accessorFn: (r) => money(r.currency_code, r.amount) },
    { id: "po", header: "Purchase order", accessorFn: (r) => (r.purchase_order_id ? lookup.order(r.purchase_order_id) : "—") },
    { id: "receipt", header: "Receipt", accessorFn: (r) => (r.receipt_id ? lookup.receipt(r.receipt_id) : "—") },
    { id: "method", header: "Allocated by", accessorFn: (r) => statusLabel(r.allocation_method) },
    { id: "note", header: "Note", accessorFn: (r) => String(r.note ?? "—") },
  ],
  searchText: (r) => `${r.cost_type} ${r.note ?? ""} ${r.allocation_method}`,
  emptyTitle: "No landed costs recorded",
  emptyDescription: "Add freight, duty or handling against an order or receipt.",
};

export const supplierPricesRegister: OperationConfig = {
  kind: "supplier-prices",
  createPath: "supplier-prices",
  title: "Supplier price lists",
  description: "Agreed purchase prices per supplier and item, with quantity breaks and validity.",
  searchLabel: "Search supplier prices",
  createLabel: "Add price",
  createPermission: "procurement.catalog.manage",
  fields: [
    { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", required: true },
    { name: "itemId", label: "Item", kind: "select", options: "items", required: true },
    { name: "uomId", label: "Unit of measure", kind: "select", options: "uoms" },
    { name: "minimumQuantity", label: "From quantity", kind: "number", defaultValue: 1, step: 1 },
    { name: "rate", label: "Price", kind: "number", required: true },
    { name: "currencyCode", label: "Currency", kind: "text", defaultValue: "INR" },
    { name: "validFrom", label: "Valid from", kind: "date" },
    { name: "validTo", label: "Valid to", kind: "date" },
  ],
  columns: (lookup) => [
    { id: "supplier", header: "Supplier", accessorFn: (r) => lookup.supplier(r.supplier_id) },
    { id: "item", header: "Item", accessorFn: (r) => lookup.item(r.item_id) },
    { id: "min", header: "From qty", accessorFn: (r) => Number(r.minimum_quantity ?? 1) },
    { id: "rate", header: "Price", accessorFn: (r) => money(r.currency_code, r.rate) },
    { id: "valid", header: "Valid", accessorFn: (r) => `${calendarDate(r.valid_from)} → ${r.valid_to ? calendarDate(r.valid_to) : "open"}` },
    { id: "status", header: "Status", accessorFn: (r) => statusLabel(r.status) },
  ],
  searchText: (r) => `${r.status} ${r.currency_code}`,
  emptyTitle: "No supplier prices yet",
  emptyDescription: "Record the price a supplier has agreed for an item.",
};

export const leadTimesRegister: OperationConfig = {
  kind: "supplier-lead-times",
  createPath: "lead-times",
  title: "Supplier lead times",
  description: "How long each supplier takes to deliver, overall or per item — used when planning purchases.",
  searchLabel: "Search lead times",
  createLabel: "Add lead time",
  createPermission: "procurement.suppliers.manage",
  fields: [
    { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", required: true },
    { name: "itemId", label: "Item (blank = all items)", kind: "select", options: "items" },
    { name: "leadTimeDays", label: "Lead time (days)", kind: "number", required: true, defaultValue: 7, step: 1 },
    { name: "effectiveFrom", label: "Effective from", kind: "date" },
    { name: "effectiveTo", label: "Effective to", kind: "date" },
  ],
  columns: (lookup) => [
    { id: "supplier", header: "Supplier", accessorFn: (r) => lookup.supplier(r.supplier_id) },
    { id: "item", header: "Item", accessorFn: (r) => (r.item_id ? lookup.item(r.item_id) : "All items") },
    { id: "days", header: "Lead time", accessorFn: (r) => `${r.lead_time_days} days` },
    { id: "from", header: "Effective from", accessorFn: (r) => calendarDate(r.effective_from) },
    { id: "to", header: "Effective to", accessorFn: (r) => (r.effective_to ? calendarDate(r.effective_to) : "open") },
  ],
  searchText: (r) => `${r.lead_time_days}`,
  emptyTitle: "No lead times recorded",
  emptyDescription: "Record how long a supplier normally takes to deliver.",
};

export const subcontractRegister: OperationConfig = {
  kind: "subcontract-orders",
  createPath: "subcontract-orders",
  title: "Subcontract orders",
  description: "Work sent to a supplier to process materials and return them.",
  searchLabel: "Search subcontract orders",
  createLabel: "New subcontract order",
  createPermission: "procurement.po.create",
  fields: [
    { name: "supplierId", label: "Subcontractor", kind: "select", options: "suppliers", required: true },
    { name: "purchaseOrderId", label: "Linked purchase order", kind: "select", options: "purchaseOrders" },
    { name: "itemId", label: "Item", kind: "select", options: "items" },
    { name: "quantity", label: "Quantity", kind: "number", step: 1 },
    { name: "expectedReturnDate", label: "Expected back", kind: "date" },
    { name: "note", label: "Note", kind: "textarea" },
  ],
  columns: (lookup) => [
    { id: "supplier", header: "Subcontractor", accessorFn: (r) => lookup.supplier(r.supplier_id) },
    { id: "item", header: "Item", accessorFn: (r) => (r.item_id ? lookup.item(r.item_id) : "—") },
    { id: "qty", header: "Quantity", accessorFn: (r) => numberText(r.quantity) },
    { id: "po", header: "Purchase order", accessorFn: (r) => (r.purchase_order_id ? lookup.order(r.purchase_order_id) : "—") },
    { id: "back", header: "Expected back", accessorFn: (r) => calendarDate(r.expected_return_date) },
    { id: "status", header: "Status", accessorFn: (r) => statusLabel(r.status) },
  ],
  searchText: (r) => `${r.status} ${r.note ?? ""}`,
  emptyTitle: "No subcontract orders",
  emptyDescription: "Create one to send materials to a subcontractor.",
};
