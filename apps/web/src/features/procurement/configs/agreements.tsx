import { boldCol, col, dateCol, lineColumns, statusCol, total } from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { calendarDate, money, statusLabel } from "@/features/procurement/shared/format";

const STATUSES = ["draft", "submitted", "approved", "active", "closed", "cancelled"];
const TYPES = ["blanket", "contract", "framework"].map((value) => ({ value, label: statusLabel(value) }));

export const agreementsList: ListConfig = {
  resource: "agreements",
  title: "Agreements",
  description: "Blanket orders and contracts with agreed prices and validity.",
  searchLabel: "Search agreements",
  statuses: STATUSES,
  columns: (lookup) => [boldCol("number", "Agreement", (r) => String(r.agreementNumber ?? "—")), col("title", "Title", (r) => String(r.title ?? "—")), col("supplier", "Supplier", (r) => lookup.supplier(r.supplierId)), col("type", "Type", (r) => statusLabel(r.agreementType ?? "contract")), statusCol(), dateCol("from", "Valid from", "validFrom"), dateCol("to", "Valid until", "validUntil"), col("total", "Committed value", total)],
  detailHref: (r) => `/procurement/agreements/${r.id}`,
  newHref: "/procurement/agreements/new",
  newLabel: "New agreement",
  createPermission: "procurement.contracts.manage",
  emptyTitle: "No agreements yet",
  emptyDescription: "Create a blanket order or contract to fix prices with a supplier.",
};

export const agreementForm: FormConfig = {
  resource: "agreements",
  noun: "agreement",
  backHref: "/procurement/agreements",
  detailHref: (id) => `/procurement/agreements/${id}`,
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "supplierId", label: "Supplier", kind: "select", options: "suppliers", required: true },
    { name: "agreementType", label: "Type", kind: "select", options: TYPES, defaultValue: "blanket" },
    { name: "validFrom", label: "Valid from", kind: "date", required: true },
    { name: "validUntil", label: "Valid until", kind: "date", required: true },
    { name: "currencyCode", label: "Currency", kind: "text", defaultValue: "INR" },
    { name: "paymentTerms", label: "Payment terms", kind: "text" },
    { name: "terms", label: "Terms and conditions", kind: "textarea" },
  ],
  lines: {
    key: "lines",
    label: "Agreed items and prices",
    addLabel: "Add item",
    fields: [
      { name: "itemId", label: "Item", kind: "select", options: "items", placeholder: "Select an item" },
      { name: "description", label: "Description", kind: "text", required: true },
      { name: "quantity", label: "Committed quantity", kind: "number", defaultValue: 1, step: 1 },
      { name: "unitPrice", label: "Agreed price", kind: "number" },
    ],
  },
};

export const agreementDetail: DetailConfig = {
  resource: "agreements",
  backHref: "/procurement/agreements",
  backLabel: "All agreements",
  noun: "agreement",
  title: (r) => String(r.agreementNumber ?? r.title ?? "Agreement"),
  fields: (r, lookup) => [
    { label: "Title", value: String(r.title ?? "—") },
    { label: "Supplier", value: lookup.supplier(r.supplierId) },
    { label: "Type", value: statusLabel(r.agreementType ?? "contract") },
    { label: "Valid", value: `${calendarDate(r.validFrom)} → ${calendarDate(r.validUntil)}` },
    { label: "Currency", value: String(r.currencyCode ?? "—") },
    { label: "Payment terms", value: String(r.paymentTerms ?? "—") },
    { label: "Terms", value: String(r.terms ?? "—") },
  ],
  metrics: (r) => [
    { label: "Committed value", value: money(r.currencyCode, r.totals?.grandTotal) },
    { label: "Lines", value: String(Array.isArray(r.lines) ? r.lines.length : 0) },
  ],
  actions: [
    { action: "submit", label: "Submit for approval", from: ["draft"], permission: "procurement.contracts.manage", primary: true },
    { action: "approve", label: "Approve", from: ["submitted"], permission: "procurement.contracts.approve", primary: true },
    { action: "activate", label: "Activate", from: ["approved"], permission: "procurement.contracts.manage", primary: true },
    { action: "close", label: "Close", from: ["active"], permission: "procurement.contracts.manage", reason: "optional" },
    { action: "cancel", label: "Cancel", from: ["draft", "submitted", "approved"], permission: "procurement.contracts.manage", reason: "required" },
  ],
  links: [{ label: "Create call-off order", href: (r) => `/procurement/orders/new?agreement=${r.id}`, from: ["active"], permission: "procurement.po.create" }],
  editHref: (r) => `/procurement/agreements/${r.id}/edit`,
  editPermission: "procurement.contracts.manage",
  lineGrids: [{ title: "Agreed items and prices", key: "lines", columns: (lookup) => lineColumns(lookup) }],
};
