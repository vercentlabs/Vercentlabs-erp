import { boldCol, col, dateCol, lineColumns, statusCol } from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import type { FieldValue } from "@/features/procurement/shared/FieldInput";
import { calendarDate, statusLabel } from "@/features/procurement/shared/format";

const STATUSES = ["draft", "submitted", "approved", "active", "closed", "cancelled"];
const TYPES = [
  { value: "rfq", label: "RFQ (request for quotation)" },
  { value: "rfp", label: "RFP (request for proposal)" },
  { value: "rfi", label: "RFI (request for information)" },
];

export const rfqsList: ListConfig = {
  resource: "sourcing-events",
  title: "RFQs",
  description: "Request quotations from several suppliers, compare their bids and award.",
  searchLabel: "Search RFQs",
  statuses: STATUSES,
  columns: () => [boldCol("number", "RFQ", (r) => String(r.eventNumber ?? "—")), col("title", "Title", (r) => String(r.title ?? "—")), col("type", "Type", (r) => String(r.eventType ?? "rfq").toUpperCase()), statusCol(), dateCol("close", "Bids close", "bidCloseAt")],
  detailHref: (r) => `/procurement/rfqs/${r.id}`,
  newHref: "/procurement/rfqs/new",
  newLabel: "New RFQ",
  createPermission: "procurement.sourcing.manage",
  emptyTitle: "No RFQs yet",
  emptyDescription: "Create an RFQ and invite suppliers to quote.",
};

export const rfqForm: FormConfig = {
  resource: "sourcing-events",
  noun: "RFQ",
  backHref: "/procurement/rfqs",
  detailHref: (id) => `/procurement/rfqs/${id}`,
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "eventType", label: "Type", kind: "select", options: TYPES, defaultValue: "rfq" },
    { name: "bidCloseAt", label: "Bids close", kind: "date", required: true },
    { name: "currencyCode", label: "Currency", kind: "text", defaultValue: "INR" },
    { name: "requisitionId", label: "From requisition (optional)", kind: "select", options: "requisitions" },
    { name: "description", label: "Scope and instructions", kind: "textarea" },
  ],
  lines: {
    key: "lines",
    label: "Items to quote",
    addLabel: "Add item",
    fields: [
      { name: "itemId", label: "Item", kind: "select", options: "items", placeholder: "Select an item" },
      { name: "description", label: "Description", kind: "text", required: true },
      { name: "quantity", label: "Quantity", kind: "number", defaultValue: 1, step: 1 },
      { name: "warehouseId", label: "Deliver to", kind: "select", options: "warehouses", placeholder: "Warehouse" },
    ],
  },
  fromSources: {
    requisition: {
    resource: "requisitions",
    map: (r) => ({
      values: { title: `RFQ: ${String(r.title ?? "")}`, requisitionId: r.id, currencyCode: String(r.currencyCode ?? "INR") },
      lines: (Array.isArray(r.lines) ? r.lines : []).map((line: Record<string, unknown>) => {
        const out: Record<string, FieldValue> = { description: String(line.description ?? "") };
        if (line.itemId) out.itemId = String(line.itemId);
        if (line.quantity !== undefined) out.quantity = Number(line.quantity);
        if (line.warehouseId) out.warehouseId = String(line.warehouseId);
        return out;
      }),
    }),
    },
  },
};

export const rfqDetail: DetailConfig = {
  resource: "sourcing-events",
  backHref: "/procurement/rfqs",
  backLabel: "All RFQs",
  noun: "RFQ",
  title: (r) => String(r.eventNumber ?? r.title ?? "RFQ"),
  fields: (r) => [
    { label: "Title", value: String(r.title ?? "—") },
    { label: "Type", value: String(r.eventType ?? "rfq").toUpperCase() },
    { label: "Bids close", value: calendarDate(r.bidCloseAt) },
    { label: "Currency", value: String(r.currencyCode ?? "—") },
    { label: "Scope", value: String(r.description ?? "—") },
    { label: "Awarded", value: r.award ? `Yes — ${statusLabel(r.award.awardType)}` : "Not yet" },
  ],
  actions: [
    { action: "submit", label: "Submit for approval", from: ["draft"], permission: "procurement.sourcing.manage", primary: true },
    { action: "approve", label: "Approve", from: ["submitted"], permission: "procurement.sourcing.evaluate", primary: true, hint: "Approval needs someone other than the person who created the RFQ." },
    { action: "activate", label: "Open for bids", from: ["approved"], permission: "procurement.sourcing.manage", primary: true },
    { action: "close", label: "Close bidding", from: ["active"], permission: "procurement.sourcing.manage", reason: "optional" },
    { action: "cancel", label: "Cancel", from: ["draft", "submitted", "approved", "active"], permission: "procurement.sourcing.manage", reason: "required" },
  ],
  editHref: (r) => `/procurement/rfqs/${r.id}/edit`,
  editPermission: "procurement.sourcing.manage",
  lineGrids: [{ title: "Items to quote", key: "lines", columns: (lookup) => lineColumns(lookup) }],
};
