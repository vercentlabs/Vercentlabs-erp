import { boldCol, col, dateCol, lineColumns, statusCol, total } from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import type { FieldValue } from "@/features/procurement/shared/FieldInput";
import { calendarDate, money, quantity } from "@/features/procurement/shared/format";

const STATUSES = ["draft", "submitted", "pending_approval", "approved", "dispatched", "acknowledged", "partially_received", "received", "closed", "pending_amendment_approval", "rejected", "cancelled"];
const ISSUED = ["approved", "dispatched", "acknowledged", "partially_received"];

export const ordersList: ListConfig = {
  resource: "purchase-orders",
  title: "Purchase orders",
  description: "Commitments to suppliers — approval, dispatch, amendment and receipt.",
  searchLabel: "Search purchase orders",
  statuses: STATUSES,
  columns: (lookup) => [boldCol("number", "Purchase order", (r) => String(r.purchaseOrderNumber ?? "—")), col("title", "Title", (r) => String(r.title ?? "—")), col("supplier", "Supplier", (r) => lookup.supplier(r.supplierId)), statusCol(), dateCol("due", "Expected", "expectedDeliveryDate"), col("total", "Total", total)],
  detailHref: (r) => `/procurement/orders/${r.id}`,
  newHref: "/procurement/orders/new",
  newLabel: "New purchase order",
  createPermission: "procurement.po.create",
  emptyTitle: "No purchase orders yet",
  emptyDescription: "Create one directly, from an approved requisition, or by awarding an RFQ.",
};

const lineFields = [
  { name: "itemId", label: "Item", kind: "select" as const, options: "items" as const, placeholder: "Select an item" },
  { name: "description", label: "Description", kind: "text" as const, required: true },
  { name: "quantity", label: "Quantity", kind: "number" as const, defaultValue: 1, step: 1 },
  { name: "unitPrice", label: "Unit price", kind: "number" as const },
  { name: "taxAmount", label: "Tax", kind: "number" as const },
  { name: "warehouseId", label: "Deliver to", kind: "select" as const, options: "warehouses" as const, placeholder: "Warehouse" },
];

export const orderForm: FormConfig = {
  resource: "purchase-orders",
  noun: "purchase order",
  backHref: "/procurement/orders",
  detailHref: (id) => `/procurement/orders/${id}`,
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true, defaultValue: "Purchase order" },
    { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", required: true },
    { name: "expectedDeliveryDate", label: "Expected delivery", kind: "date", required: true },
    { name: "currencyCode", label: "Currency", kind: "text", defaultValue: "INR" },
    { name: "paymentTerms", label: "Payment terms", kind: "text", placeholder: "e.g. Net 30" },
    { name: "deliveryTerms", label: "Delivery terms", kind: "text" },
    { name: "agreementId", label: "Under agreement (optional)", kind: "select", options: "agreements" },
    { name: "requisitionId", label: "From requisition (optional)", kind: "select", options: "requisitions" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ],
  lines: { key: "lines", label: "Items ordered", addLabel: "Add item", fields: lineFields },
  fromSources: {
    requisition: {
    resource: "requisitions",
    map: (r) => ({
      values: { title: String(r.title ?? "Purchase order"), requisitionId: r.id, currencyCode: String(r.currencyCode ?? "INR") },
      lines: (Array.isArray(r.lines) ? r.lines : []).map((line: Record<string, unknown>) => {
        const out: Record<string, FieldValue> = { description: String(line.description ?? "") };
        if (line.itemId) out.itemId = String(line.itemId);
        if (line.quantity !== undefined) out.quantity = Number(line.quantity);
        if (line.unitPrice !== undefined) out.unitPrice = Number(line.unitPrice);
        if (line.warehouseId) out.warehouseId = String(line.warehouseId);
        return out;
      }),
    }),
    },
    agreement: {
      resource: "agreements",
      map: (a) => ({
        values: { title: `Call-off: ${String(a.title ?? "")}`, supplierId: String(a.supplierId ?? ""), agreementId: a.id, currencyCode: String(a.currencyCode ?? "INR"), paymentTerms: String(a.paymentTerms ?? "") },
        lines: (Array.isArray(a.lines) ? a.lines : []).map((line: Record<string, unknown>) => {
          const out: Record<string, FieldValue> = { description: String(line.description ?? "") };
          if (line.itemId) out.itemId = String(line.itemId);
          if (line.quantity !== undefined) out.quantity = Number(line.quantity);
          if (line.unitPrice !== undefined) out.unitPrice = Number(line.unitPrice);
          return out;
        }),
      }),
    },
  },
};

export const orderDetail: DetailConfig = {
  resource: "purchase-orders",
  backHref: "/procurement/orders",
  backLabel: "All purchase orders",
  noun: "purchase order",
  title: (r) => String(r.purchaseOrderNumber ?? r.title ?? "Purchase order"),
  fields: (r, lookup) => [
    { label: "Title", value: String(r.title ?? "—") },
    { label: "Supplier", value: lookup.supplier(r.supplierId) },
    { label: "Expected delivery", value: calendarDate(r.expectedDeliveryDate) },
    { label: "Currency", value: String(r.currencyCode ?? "—") },
    { label: "Payment terms", value: String(r.paymentTerms ?? "—") },
    { label: "Delivery terms", value: String(r.deliveryTerms ?? "—") },
    { label: "Agreement", value: r.agreementId ? "Under an agreement" : "Off contract" },
    { label: "Notes", value: String(r.notes ?? "—") },
  ],
  metrics: (r) => {
    const lines: Array<Record<string, unknown>> = Array.isArray(r.lines) ? r.lines : [];
    const ordered = lines.reduce((sum, line) => sum + Number(line.quantity ?? 0), 0);
    const received = lines.reduce((sum, line) => sum + Number(line.receivedQuantity ?? 0), 0);
    return [
      { label: "Total", value: money(r.currencyCode, r.totals?.grandTotal) },
      { label: "Subtotal", value: money(r.currencyCode, r.totals?.subtotal) },
      { label: "Tax", value: money(r.currencyCode, r.totals?.taxTotal) },
      { label: "Received", value: `${quantity(received)} of ${quantity(ordered)}` },
    ];
  },
  actions: [
    { action: "submit", label: "Submit for approval", from: ["draft", "rejected"], permission: "procurement.po.manage", primary: true },
    { action: "approve", label: "Approve", from: ["submitted", "pending_approval"], permission: "procurement.po.approve", primary: true, hint: "Approval needs someone other than the person who created the order." },
    { action: "reject", label: "Reject", from: ["submitted", "pending_approval"], permission: "procurement.po.approve", reason: "required" },
    { action: "dispatch", label: "Dispatch to supplier", from: ["approved"], permission: "procurement.po.dispatch", primary: true },
    { action: "acknowledge", label: "Mark acknowledged", from: ["dispatched"], permission: "procurement.po.manage" },
    { action: "close", label: "Close", from: ["received", "acknowledged", "partially_received"], permission: "procurement.po.manage", reason: "optional" },
    { action: "cancel", label: "Cancel", from: ["draft", "submitted", "approved", "dispatched"], permission: "procurement.po.cancel", reason: "required" },
    { action: "approve-amendment", label: "Approve amendment", from: ["pending_amendment_approval"], permission: "procurement.po.approve", primary: true, reason: "optional", hint: "The person who requested the amendment cannot approve it." },
    { action: "reject-amendment", label: "Reject amendment", from: ["pending_amendment_approval"], permission: "procurement.po.approve", reason: "required", hint: "The order returns to its previous version." },
  ],
  links: [
    { label: "Amend", href: (r) => `/procurement/orders/${r.id}/amend`, from: ISSUED, permission: "procurement.po.amend" },
    { label: "Receive goods", href: (r) => `/procurement/receipts/new?order=${r.id}`, from: ["approved", "dispatched", "acknowledged", "partially_received"], permission: "procurement.receipts.manage" },
    { label: "Match invoice", href: (r) => `/procurement/invoices/new?order=${r.id}`, from: ["approved", "dispatched", "acknowledged", "partially_received", "received"], permission: "procurement.matching.manage" },
  ],
  editHref: (r) => `/procurement/orders/${r.id}/edit`,
  editPermission: "procurement.po.manage",
  lineGrids: [{ title: "Items ordered", key: "lines", columns: (lookup) => lineColumns(lookup, { received: true }) }],
};
