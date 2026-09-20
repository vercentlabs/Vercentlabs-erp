import { col, statusCol } from "@/features/procurement/configs/common";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { calendarDate, statusLabel } from "@/features/procurement/shared/format";

export const quotationsList: ListConfig = {
  resource: "sourcing-bids",
  title: "Supplier quotations",
  description: "Bids received across all RFQs.",
  searchLabel: "Search quotations",
  statuses: ["active"],
  columns: (lookup) => [col("quote", "Quotation", (r) => String(r.quotationNumber ?? "—")), col("supplier", "Supplier", (r) => lookup.supplier(r.supplierId)), col("currency", "Currency", (r) => String(r.currencyCode ?? "—")), col("lead", "Lead time", (r) => (r.leadTimeDays !== undefined ? `${r.leadTimeDays} days` : "—")), col("valid", "Valid until", (r) => calendarDate(r.validUntil)), statusCol()],
  detailHref: (r) => `/procurement/rfqs/${r.parent_id}`,
  emptyTitle: "No quotations yet",
  emptyDescription: "Quotations are recorded against an RFQ.",
};

export const awardsList: ListConfig = {
  resource: "sourcing-events",
  title: "Awards",
  description: "RFQs that have been awarded, and what they produced.",
  searchLabel: "Search awards",
  statuses: ["closed"],
  baseFilter: (r) => Boolean(r.award),
  columns: (lookup) => [col("rfq", "RFQ", (r) => String(r.eventNumber ?? "—")), col("title", "Title", (r) => String(r.title ?? "—")), col("winner", "Awarded to", (r) => lookup.supplier(r.award?.supplierId)), col("type", "Created", (r) => statusLabel(r.award?.awardType)), statusCol()],
  detailHref: (r) => `/procurement/rfqs/${r.id}`,
  emptyTitle: "Nothing awarded yet",
  emptyDescription: "Awarding an RFQ creates a purchase order or agreement.",
};
