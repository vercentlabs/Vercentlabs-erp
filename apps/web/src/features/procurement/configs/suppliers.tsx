import { boldCol, col, statusCol } from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { ChildConfig } from "@/features/procurement/shared/ChildSection";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { calendarDate, statusLabel } from "@/features/procurement/shared/format";

const STATUSES = ["draft", "submitted", "qualified", "active", "suspended", "blocked", "cancelled"];

export const suppliersList: ListConfig = {
  resource: "suppliers",
  title: "Supplier master",
  description: "Who you buy from — onboarding, qualification and standing.",
  searchLabel: "Search suppliers",
  statuses: STATUSES,
  columns: (lookup) => [
    col("code", "Code", (r) => String(r.supplierCode ?? "—")),
    boldCol("name", "Supplier", (r) => String(r.displayName ?? r.legalName ?? "—")),
    statusCol(),
    col("category", "Category", (r) => (r.categoryId ? lookup.category(r.categoryId) : "—")),
    col("currency", "Currency", (r) => String(r.currencyCode ?? "—")),
    col("terms", "Payment terms", (r) => String(r.paymentTerms ?? "—")),
    col("tax", "Tax ID", (r) => String(r.taxRegistrationNumber ?? "—")),
  ],
  detailHref: (r) => `/procurement/suppliers/${r.id}`,
  newHref: "/procurement/suppliers/new",
  newLabel: "New supplier",
  createPermission: "procurement.suppliers.manage",
  emptyTitle: "No suppliers yet",
  emptyDescription: "Add a supplier, then submit it for qualification.",
};

export const supplierForm: FormConfig = {
  resource: "suppliers",
  noun: "supplier",
  backHref: "/procurement/suppliers",
  detailHref: (id) => `/procurement/suppliers/${id}`,
  fields: [
    { name: "supplierCode", label: "Supplier code", kind: "text", required: true },
    { name: "legalName", label: "Legal name", kind: "text", required: true },
    { name: "displayName", label: "Display name", kind: "text" },
    { name: "categoryId", label: "Category", kind: "select", options: "categories" },
    { name: "currencyCode", label: "Currency", kind: "text", defaultValue: "INR" },
    { name: "taxRegistrationNumber", label: "Tax registration (GSTIN/VAT)", kind: "text" },
    { name: "paymentTerms", label: "Payment terms", kind: "text", placeholder: "e.g. Net 30" },
    { name: "paymentTermDays", label: "Payment due (days)", kind: "number", step: 1 },
    { name: "email", label: "Email", kind: "text" },
    { name: "phone", label: "Phone", kind: "text" },
    { name: "website", label: "Website", kind: "text" },
  ],
};

export const supplierDetail: DetailConfig = {
  resource: "suppliers",
  backHref: "/procurement/suppliers",
  backLabel: "All suppliers",
  noun: "supplier",
  title: (r) => String(r.displayName ?? r.legalName ?? "Supplier"),
  fields: (r, lookup) => [
    { label: "Code", value: String(r.supplierCode ?? "—") },
    { label: "Legal name", value: String(r.legalName ?? "—") },
    { label: "Category", value: r.categoryId ? lookup.category(r.categoryId) : "—" },
    { label: "Currency", value: String(r.currencyCode ?? "—") },
    { label: "Payment terms", value: r.paymentTerms ? `${r.paymentTerms}${r.paymentTermDays ? ` (${r.paymentTermDays} days)` : ""}` : "—" },
    { label: "Tax registration", value: String(r.taxRegistrationNumber ?? "—") },
    { label: "Email", value: String(r.email ?? "—") },
    { label: "Phone", value: String(r.phone ?? "—") },
    { label: "Accounting link", value: r.accountingPartyId ? "Linked to an Accounting party" : "Not linked — vendor bills cannot be created" },
  ],
  actions: [
    { action: "submit", label: "Submit for qualification", from: ["draft"], permission: "procurement.suppliers.manage", primary: true },
    { action: "qualify", label: "Qualify", from: ["submitted"], permission: "procurement.suppliers.qualify", primary: true, hint: "Qualifying needs someone other than the person who created the supplier." },
    { action: "activate", label: "Activate", from: ["qualified", "suspended", "blocked"], permission: "procurement.suppliers.qualify", primary: true },
    { action: "suspend", label: "Suspend", from: ["active", "qualified"], permission: "procurement.suppliers.qualify", reason: "required", hint: "A suspended supplier cannot be ordered from until reactivated." },
    { action: "block", label: "Block", from: ["active", "qualified", "suspended"], permission: "procurement.suppliers.qualify", reason: "required" },
    { action: "cancel", label: "Cancel", from: ["draft", "submitted"], permission: "procurement.suppliers.manage", reason: "required" },
  ],
  editHref: (r) => `/procurement/suppliers/${r.id}/edit`,
  editPermission: "procurement.suppliers.manage",
};

const EDITABLE = ["draft", "submitted", "qualified", "active", "suspended"];
export const supplierChildren: Record<"sites" | "qualifications" | "certifications" | "scorecards", ChildConfig> = {
  sites: {
    resource: "supplier-sites",
    title: "Sites, contacts and addresses",
    description: "Where the supplier ships from, bills from, and who to talk to.",
    noun: "site",
    manage: "procurement.suppliers.manage",
    parentStates: EDITABLE,
    emptyText: "No sites yet.",
    fields: [
      { name: "siteName", label: "Site name", kind: "text", required: true },
      { name: "siteType", label: "Type", kind: "select", options: ["billing", "shipping", "plant", "office", "other"].map((value) => ({ value, label: statusLabel(value) })), defaultValue: "shipping" },
      { name: "addressLine1", label: "Address line 1", kind: "text" },
      { name: "city", label: "City", kind: "text" },
      { name: "state", label: "State", kind: "text" },
      { name: "postalCode", label: "Postal code", kind: "text" },
      { name: "contactName", label: "Contact name", kind: "text" },
      { name: "contactEmail", label: "Contact email", kind: "text" },
      { name: "contactPhone", label: "Contact phone", kind: "text" },
    ],
    columns: [col("site", "Site", (r) => String(r.siteName ?? "—")), col("type", "Type", (r) => statusLabel(r.siteType)), col("addr", "Address", (r) => [r.addressLine1, r.city, r.state, r.postalCode].filter(Boolean).join(", ") || "—"), col("contact", "Contact", (r) => [r.contactName, r.contactEmail].filter(Boolean).join(" · ") || "—")],
  },
  qualifications: {
    resource: "supplier-qualifications",
    title: "Qualification assessments",
    description: "Audits and checks that support qualifying the supplier.",
    noun: "assessment",
    manage: "procurement.suppliers.qualify",
    parentStates: EDITABLE,
    emptyText: "No assessments recorded.",
    fields: [
      { name: "qualificationType", label: "Assessment", kind: "select", required: true, options: ["quality_audit", "financial_review", "compliance_check", "site_visit", "reference_check"].map((value) => ({ value, label: statusLabel(value) })) },
      { name: "result", label: "Result", kind: "select", required: true, options: ["passed", "conditional", "failed"].map((value) => ({ value, label: statusLabel(value) })) },
      { name: "assessedOn", label: "Assessed on", kind: "date" },
      { name: "expiresOn", label: "Expires on", kind: "date" },
      { name: "assessor", label: "Assessor", kind: "text" },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    columns: [col("type", "Assessment", (r) => statusLabel(r.qualificationType)), col("result", "Result", (r) => statusLabel(r.result)), col("on", "Assessed", (r) => calendarDate(r.assessedOn)), col("exp", "Expires", (r) => calendarDate(r.expiresOn)), col("who", "Assessor", (r) => String(r.assessor ?? "—"))],
  },
  certifications: {
    resource: "supplier-certifications",
    title: "Certifications",
    noun: "certification",
    manage: "procurement.suppliers.qualify",
    parentStates: EDITABLE,
    emptyText: "No certifications recorded.",
    fields: [
      { name: "certificateType", label: "Certificate", kind: "text", required: true, placeholder: "e.g. ISO 9001" },
      { name: "certificateNumber", label: "Number", kind: "text" },
      { name: "issuedBy", label: "Issued by", kind: "text" },
      { name: "validFrom", label: "Valid from", kind: "date" },
      { name: "validUntil", label: "Valid until", kind: "date", required: true },
    ],
    columns: [col("type", "Certificate", (r) => String(r.certificateType ?? "—")), col("no", "Number", (r) => String(r.certificateNumber ?? "—")), col("by", "Issued by", (r) => String(r.issuedBy ?? "—")), col("until", "Valid until", (r) => calendarDate(r.validUntil))],
  },
  scorecards: {
    resource: "supplier-scorecards",
    title: "Performance scorecards",
    description: "Period scores out of 100. The overall score weights quality and delivery 30% each, price 25%, service 15%.",
    noun: "scorecard",
    manage: "procurement.suppliers.qualify",
    parentStates: ["qualified", "active", "suspended", "blocked"],
    emptyText: "No scorecards yet.",
    fields: [
      { name: "period", label: "Period", kind: "text", required: true, placeholder: "e.g. 2026-Q3" },
      { name: "qualityScore", label: "Quality (0-100)", kind: "number", step: 1 },
      { name: "deliveryScore", label: "Delivery (0-100)", kind: "number", step: 1 },
      { name: "priceScore", label: "Price (0-100)", kind: "number", step: 1 },
      { name: "serviceScore", label: "Service (0-100)", kind: "number", step: 1 },
      { name: "notes", label: "Notes", kind: "textarea" },
    ],
    transform: (v) => {
      const n = (key: string) => Math.min(100, Math.max(0, Number(v[key] ?? 0)));
      return { overallScore: Number((n("qualityScore") * 0.3 + n("deliveryScore") * 0.3 + n("priceScore") * 0.25 + n("serviceScore") * 0.15).toFixed(2)) };
    },
    columns: [col("period", "Period", (r) => String(r.period ?? "—")), col("q", "Quality", (r) => String(r.qualityScore ?? "—")), col("d", "Delivery", (r) => String(r.deliveryScore ?? "—")), col("p", "Price", (r) => String(r.priceScore ?? "—")), col("s", "Service", (r) => String(r.serviceScore ?? "—")), col("o", "Overall", (r) => String(r.overallScore ?? "—"))],
  },
};
