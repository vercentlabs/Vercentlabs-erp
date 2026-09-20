import { boldCol, col, dateCol, lineColumns, statusCol, total } from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { calendarDate, money } from "@/features/procurement/shared/format";

const STATUSES = ["draft", "submitted", "pending_approval", "approved", "rejected", "closed", "cancelled"];

export const requisitionsList: ListConfig = {
  resource: "requisitions",
  title: "Purchase requisitions",
  description: "Internal requests to buy — submitted for approval, then turned into orders.",
  searchLabel: "Search requisitions",
  statuses: STATUSES,
  columns: () => [boldCol("number", "Requisition", (r) => String(r.requisitionNumber ?? "—")), col("title", "Title", (r) => String(r.title ?? "—")), statusCol(), col("dept", "Department", (r) => String(r.requesterDepartment ?? "—")), dateCol("need", "Need by", "needByDate"), col("total", "Estimated total", total)],
  detailHref: (r) => `/procurement/requisitions/${r.id}`,
  newHref: "/procurement/requisitions/new",
  newLabel: "New requisition",
  createPermission: "procurement.requisition.create",
  emptyTitle: "No requisitions yet",
  emptyDescription: "Raise a requisition to request goods or services.",
};

export const requisitionForm: FormConfig = {
  resource: "requisitions",
  noun: "requisition",
  backHref: "/procurement/requisitions",
  detailHref: (id) => `/procurement/requisitions/${id}`,
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "needByDate", label: "Need by", kind: "date", required: true },
    { name: "currencyCode", label: "Currency", kind: "text", defaultValue: "INR" },
    { name: "requesterDepartment", label: "Department", kind: "text" },
    { name: "justification", label: "Business justification", kind: "textarea" },
  ],
  lines: {
    key: "lines",
    label: "Items requested",
    addLabel: "Add item",
    fields: [
      { name: "itemId", label: "Item", kind: "select", options: "items", placeholder: "Select an item" },
      { name: "description", label: "Description", kind: "text", required: true },
      { name: "quantity", label: "Quantity", kind: "number", defaultValue: 1, step: 1 },
      { name: "unitPrice", label: "Estimated price", kind: "number" },
      { name: "warehouseId", label: "Deliver to", kind: "select", options: "warehouses", placeholder: "Warehouse" },
    ],
  },
};

export const requisitionDetail: DetailConfig = {
  resource: "requisitions",
  backHref: "/procurement/requisitions",
  backLabel: "All requisitions",
  noun: "requisition",
  title: (r) => String(r.requisitionNumber ?? r.title ?? "Requisition"),
  fields: (r) => [
    { label: "Title", value: String(r.title ?? "—") },
    { label: "Need by", value: calendarDate(r.needByDate) },
    { label: "Department", value: String(r.requesterDepartment ?? "—") },
    { label: "Currency", value: String(r.currencyCode ?? "—") },
    { label: "Justification", value: String(r.justification ?? "—") },
  ],
  metrics: (r) => [
    { label: "Estimated total", value: money(r.currencyCode, r.totals?.grandTotal) },
    { label: "Subtotal", value: money(r.currencyCode, r.totals?.subtotal) },
    { label: "Lines", value: String(Array.isArray(r.lines) ? r.lines.length : 0) },
  ],
  actions: [
    { action: "submit", label: "Submit for approval", from: ["draft", "rejected"], permission: "procurement.requisition.manage", primary: true },
    { action: "approve", label: "Approve", from: ["submitted", "pending_approval"], permission: "procurement.requisition.approve", primary: true, hint: "Approval needs someone other than the requester." },
    { action: "reject", label: "Reject", from: ["submitted", "pending_approval"], permission: "procurement.requisition.approve", reason: "required" },
    { action: "close", label: "Close", from: ["approved"], permission: "procurement.requisition.manage", reason: "optional" },
    { action: "cancel", label: "Cancel", from: ["draft", "submitted", "rejected"], permission: "procurement.requisition.manage", reason: "required" },
  ],
  links: [{ label: "Create purchase order", href: (r) => `/procurement/orders/new?requisition=${r.id}`, from: ["approved"], permission: "procurement.po.create" }],
  editHref: (r) => `/procurement/requisitions/${r.id}/edit`,
  editPermission: "procurement.requisition.manage",
  lineGrids: [{ title: "Items requested", key: "lines", columns: (lookup) => lineColumns(lookup) }],
};
