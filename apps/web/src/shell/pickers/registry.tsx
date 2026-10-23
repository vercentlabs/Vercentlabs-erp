"use client";

// Which records a form can find and create in place (Create-Where-You-Are plan): per kind, how it is searched on the server, what its
// quick-create form is, who may create one and which app it belongs to (a kind whose app is off is neither searched nor created).
import type { ComponentType } from "react";

import { listAccounts } from "@/features/crm/accounts/api/accounts-api";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { listLeads } from "@/features/crm/leads/api/leads-api";
import { listItems } from "@/features/items/api/items-api";

import { CompanyQuickCreate, ContactQuickCreate, CustomerContactQuickCreate, CustomerQuickCreate, ItemQuickCreate, LeadQuickCreate, SupplierQuickCreate } from "./QuickCreateForms";
import { LedgerQuickCreate, searchLedgers } from "./LedgerQuickCreate";
import { SimpleMasterQuickCreate, SIMPLE_MASTERS, searchSimpleMaster, type SimpleMasterKind } from "./SimpleMasters";
import type { PickedRecord, PickerKind, QuickCreateProps } from "./types";

export type PickerDefinition = {
  /** "customer", "contact"… in the create row and the drawer's title. */
  noun: string;
  app: string;
  /** Any of these lets the person create one here. */
  createPermissions: string[];
  search: (text: string, filters: Record<string, unknown>) => Promise<PickedRecord[]>;
  Create: ComponentType<QuickCreateProps>;
};

const getJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? payload?.message ?? "The search failed.");
  return (payload?.data ?? payload) as T;
};
const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ");

// A simple master: a name (and a code or a number) is enough to create one.
function simple(kind: SimpleMasterKind): PickerDefinition {
  const master = SIMPLE_MASTERS[kind];
  function Create(props: QuickCreateProps) {
    return <SimpleMasterQuickCreate kind={kind} {...props} />;
  }
  return { noun: master.noun, app: master.app, createPermissions: master.createPermissions, Create, search: (text) => searchSimpleMaster(kind, text) };
}

export const PICKERS: Record<PickerKind, PickerDefinition> = {
  contact: {
    noun: "contact", app: "crm", createPermissions: ["crm.contacts.create"], Create: ContactQuickCreate,
    search: async (text, filters) => (await listContacts({ search: text || undefined, limit: 20, sortBy: "displayName", sortDirection: "asc",
      ...(typeof filters.accountId === "string" ? { accountId: filters.accountId } : {}) })).rows
      .map((row) => ({ id: row.id, label: row.displayName, description: join(row.accountName, row.mobile, row.email), raw: row as unknown as Record<string, unknown> })),
  },
  company: {
    noun: "company", app: "crm", createPermissions: ["crm.accounts.create"], Create: CompanyQuickCreate,
    search: async (text) => (await listAccounts({ search: text || undefined, limit: 20, sortBy: "displayName", sortDirection: "asc" })).rows
      .map((row) => ({ id: row.id, label: row.displayName, description: row.code, raw: row as unknown as Record<string, unknown> })),
  },
  lead: {
    noun: "lead", app: "crm", createPermissions: ["crm.leads.create"], Create: LeadQuickCreate,
    search: async (text) => (await listLeads({ search: text || undefined, limit: 20 })).rows
      .map((row) => ({ id: row.id, label: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.companyName || row.code, description: join(row.code, row.companyName) })),
  },
  customer: {
    noun: "customer", app: "sales", createPermissions: ["sales.customers.create"], Create: CustomerQuickCreate,
    search: async (text) => (await getJson<{ customers: Array<{ id: string; customerNumber: string; displayName: string; gstin: string | null; status: string }> }>(
      `/api/sales/customers/search?search=${encodeURIComponent(text)}`)).customers
      .map((row) => ({ id: row.id, label: row.displayName, description: join(row.customerNumber, row.gstin), raw: row })),
  },
  customerContact: {
    noun: "contact", app: "sales", createPermissions: ["sales.customers.manage_contacts"], Create: CustomerContactQuickCreate,
    search: async (text, filters) => typeof filters.partyId !== "string" || !filters.partyId ? [] : (await getJson<{ contacts: Array<{ id: string; name: string; email: string | null; phone: string | null; jobTitle: string | null }> }>(
      `/api/sales/customers/${filters.partyId}/contacts?search=${encodeURIComponent(text)}`)).contacts
      .map((row) => ({ id: row.id, label: row.name, description: join(row.jobTitle, row.phone, row.email), raw: row })),
  },
  supplier: {
    noun: "supplier", app: "procurement", createPermissions: ["procurement.suppliers.create"], Create: SupplierQuickCreate,
    search: async (text) => (await getJson<{ suppliers: Array<{ id: string; supplierNumber: string; supplierName: string; gstin: string | null; city: string | null; selectable: boolean; unavailableReason: string | null }> }>(
      `/api/procurement/suppliers/search?search=${encodeURIComponent(text)}&limit=20`)).suppliers
      .map((row) => ({ id: row.id, label: row.supplierName, description: row.selectable ? join(row.supplierNumber, row.gstin, row.city) : row.unavailableReason ?? undefined, raw: row })),
  },
  item: {
    noun: "item", app: "products", createPermissions: ["products.create"], Create: ItemQuickCreate,
    search: async (text, filters) => (await listItems({ search: text || undefined, limit: 20, status: "active",
      ...(filters.sellable ? { sellable: "true" } : {}), ...(filters.purchasable ? { purchasable: "true" } : {}) })).products
      .map((row) => ({ id: row.id, label: row.name, description: join(row.code, row.hsnSacCode), raw: row as unknown as Record<string, unknown> })),
  },
  uom: simple("uom"),
  itemCategory: simple("itemCategory"),
  paymentTerm: simple("paymentTerm"),
  expenseCategory: simple("expenseCategory"),
  assetLocation: simple("assetLocation"),
  department: simple("department"),
  designation: simple("designation"),
  ledger: { noun: "ledger", app: "accounting", createPermissions: ["accounting.chart.manage", "accounting.settings.manage"], Create: LedgerQuickCreate, search: (text) => searchLedgers(text) },
};
