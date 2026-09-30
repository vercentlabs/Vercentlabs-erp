import { boldCol, col, statusCol } from "@/features/procurement/configs/common";
import type { DetailConfig } from "@/features/procurement/shared/DocumentDetail";
import type { ChildConfig } from "@/features/procurement/shared/ChildSection";
import type { FormConfig } from "@/features/procurement/shared/DocumentForm";
import type { ListConfig } from "@/features/procurement/shared/ResourceListPage";
import { statusLabel } from "@/features/procurement/shared/format";

const STATUSES = [
  "draft",
  "submitted",
  "qualified",
  "active",
  "suspended",
  "blocked",
  "cancelled",
];

export const suppliersList: ListConfig = {
  resource: "suppliers",
  title: "Supplier master",
  description: "Who you buy from — onboarding, qualification and standing.",
  searchLabel: "Search suppliers",
  statuses: STATUSES,
  columns: (lookup) => [
    col("code", "Code", (r) => String(r.supplierCode ?? "—")),
    boldCol("name", "Supplier", (r) =>
      String(r.displayName ?? r.legalName ?? "—"),
    ),
    statusCol(),
    col("category", "Category", (r) =>
      r.categoryId ? lookup.category(r.categoryId) : "—",
    ),
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
    {
      name: "supplierCode",
      label: "Supplier code",
      kind: "text",
      required: true,
    },
    { name: "legalName", label: "Legal name", kind: "text", required: true },
    { name: "displayName", label: "Display name", kind: "text" },
    {
      name: "categoryId",
      label: "Category",
      kind: "select",
      options: "categories",
    },
    {
      name: "currencyCode",
      label: "Currency",
      kind: "text",
      defaultValue: "INR",
    },
    {
      name: "taxRegistrationNumber",
      label: "Tax registration (GSTIN/VAT)",
      kind: "text",
    },
    {
      name: "paymentTerms",
      label: "Payment terms",
      kind: "text",
      placeholder: "e.g. Net 30",
    },
    {
      name: "paymentTermDays",
      label: "Payment due (days)",
      kind: "number",
      step: 1,
    },
    { name: "email", label: "Email", kind: "text" },
    { name: "phone", label: "Phone", kind: "text" },
    { name: "website", label: "Website", kind: "text" },
    {
      name: "accountingPartyId",
      label: "Accounting party (for vendor bills)",
      kind: "select",
      options: "accountingParties",
      placeholder: "Not linked",
    },
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
    {
      label: "Category",
      value: r.categoryId ? lookup.category(r.categoryId) : "—",
    },
    { label: "Currency", value: String(r.currencyCode ?? "—") },
    {
      label: "Payment terms",
      value: r.paymentTerms
        ? `${r.paymentTerms}${r.paymentTermDays ? ` (${r.paymentTermDays} days)` : ""}`
        : "—",
    },
    {
      label: "Tax registration",
      value: String(r.taxRegistrationNumber ?? "—"),
    },
    { label: "Email", value: String(r.email ?? "—") },
    { label: "Phone", value: String(r.phone ?? "—") },
    {
      label: "Accounting link",
      value: r.accountingPartyId
        ? "Linked to an Accounting party"
        : "Not linked — edit the supplier to link one, or vendor bills will not be created",
    },
  ],
  actions: [
    {
      action: "submit",
      label: "Submit for qualification",
      from: ["draft"],
      permission: "procurement.suppliers.manage",
      primary: true,
    },
    {
      action: "qualify",
      label: "Qualify",
      from: ["submitted"],
      permission: "procurement.suppliers.qualify",
      primary: true,
      hint: "Qualifying needs someone other than the person who created the supplier.",
    },
    {
      action: "activate",
      label: "Activate",
      from: ["qualified", "suspended", "blocked"],
      permission: "procurement.suppliers.qualify",
      primary: true,
    },
    {
      action: "suspend",
      label: "Suspend",
      from: ["active", "qualified"],
      permission: "procurement.suppliers.qualify",
      reason: "required",
      hint: "A suspended supplier cannot be ordered from until reactivated.",
    },
    {
      action: "block",
      label: "Block",
      from: ["active", "qualified", "suspended"],
      permission: "procurement.suppliers.qualify",
      reason: "required",
    },
    {
      action: "cancel",
      label: "Cancel",
      from: ["draft", "submitted"],
      permission: "procurement.suppliers.manage",
      reason: "required",
    },
  ],
  editHref: (r) => `/procurement/suppliers/${r.id}/edit`,
  editPermission: "procurement.suppliers.manage",
};

const EDITABLE = ["draft", "submitted", "qualified", "active", "suspended"];
export const supplierChildren: Record<"sites", ChildConfig> = {
  sites: {
    resource: "supplier-sites",
    title: "Sites, contacts and addresses",
    description:
      "Where the supplier ships from, bills from, and who to talk to.",
    noun: "site",
    manage: "procurement.suppliers.manage",
    parentStates: EDITABLE,
    emptyText: "No sites yet.",
    fields: [
      { name: "siteName", label: "Site name", kind: "text", required: true },
      {
        name: "siteType",
        label: "Type",
        kind: "select",
        options: ["billing", "shipping", "plant", "office", "other"].map(
          (value) => ({ value, label: statusLabel(value) }),
        ),
        defaultValue: "shipping",
      },
      { name: "addressLine1", label: "Address line 1", kind: "text" },
      { name: "city", label: "City", kind: "text" },
      { name: "state", label: "State", kind: "text" },
      { name: "postalCode", label: "Postal code", kind: "text" },
      { name: "contactName", label: "Contact name", kind: "text" },
      { name: "contactEmail", label: "Contact email", kind: "text" },
      { name: "contactPhone", label: "Contact phone", kind: "text" },
    ],
    columns: [
      col("site", "Site", (r) => String(r.siteName ?? "—")),
      col("type", "Type", (r) => statusLabel(r.siteType)),
      col(
        "addr",
        "Address",
        (r) =>
          [r.addressLine1, r.city, r.state, r.postalCode]
            .filter(Boolean)
            .join(", ") || "—",
      ),
      col(
        "contact",
        "Contact",
        (r) =>
          [r.contactName, r.contactEmail].filter(Boolean).join(" · ") || "—",
      ),
    ],
  },
};
