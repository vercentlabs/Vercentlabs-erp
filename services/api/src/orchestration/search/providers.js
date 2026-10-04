// The one global record-search provider registry. Each provider reuses the
// module's own list function, which applies record ownership/team rules and sensitive-field projection; search never bypasses
// that. Providers return a small safe DTO only (no email, phone, bank, cost...).
// Register a provider here only when its domain list function is proven safe.
import { listLeads } from "../../modules/crm/leads/index.js";
import { listAccounts } from "../../modules/crm/accounts/index.js";
import { listContacts } from "../../modules/crm/contacts/index.js";
import { searchCustomers } from "../../modules/sales/customers/index.js";
import { listProducts } from "../../modules/products/index.js";
import { listOpportunities, listTasks, searchAttachments, searchNotes } from "../../modules/crm/index.js";

const CRM_RECORD_PATHS = Object.freeze({ lead: "/crm/leads", party: "/crm/accounts", contact: "/crm/contacts", opportunity: "/crm/opportunities" });
const text = (value) => (value === null || value === undefined || value === "" ? null : String(value).slice(0, 160));
const joined = (...parts) => text(parts.filter(Boolean).join(" ").trim());

export const SEARCH_PROVIDERS = Object.freeze([
  {
    key: "crm.leads",
    label: "Leads",
    moduleKey: "crm",
    requiredPermission: "crm.leads.view",
    async execute(client, context, term, limit) {
      const { leads } = await listLeads(client, context, { search: term, limit });
      return leads.map((lead) => ({ recordId: lead.id, title: text(lead.fullName) || text(lead.companyName) || "Lead", detail: text(lead.fullName ? lead.companyName : lead.code), href: `/crm/leads/${lead.id}` }));
    },
  },
  {
    key: "crm.accounts",
    label: "Accounts",
    moduleKey: "crm",
    requiredPermission: "crm.accounts.view",
    async execute(client, context, term, limit) {
      const { accounts } = await listAccounts(client, context, { search: term, limit });
      return accounts.map((account) => ({ recordId: account.id, title: text(account.displayName) || "Account", detail: joined(account.code, account.city), href: `/crm/accounts/${account.id}` }));
    },
  },
  {
    key: "crm.contacts",
    label: "Contacts",
    moduleKey: "crm",
    requiredPermission: "crm.contacts.view",
    async execute(client, context, term, limit) {
      const { contacts } = await listContacts(client, context, { search: term, limit });
      // "Rahul Sharma — Procurement Head · ABC Manufacturing", not a bare name.
      return contacts.map((contact) => ({ recordId: contact.id, title: text(contact.displayName) || "Contact", detail: joined(contact.jobTitle, contact.accountName ? `· ${contact.accountName}` : null), href: `/crm/contacts/${contact.id}` }));
    },
  },
  {
    key: "crm.opportunities",
    label: "Opportunities",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { opportunities } = await listOpportunities(client, context, { search: term, limit });
      return opportunities.map((row) => ({ recordId: row.id, title: text(row.name) || "Opportunity", detail: joined(row.code, row.accountName ? `· ${row.accountName}` : null), href: `/crm/opportunities/${row.id}` }));
    },
  },
  {
    key: "crm.tasks",
    label: "Tasks",
    moduleKey: "crm",
    requiredPermission: "crm.tasks.view",
    async execute(client, context, term, limit) {
      const { tasks } = await listTasks(client, context, { view: "mine", search: term, limit });
      return tasks.map((task) => ({ recordId: task.id, title: text(task.title) || "Task", detail: joined(task.number, task.relatedName ? `· ${task.relatedName}` : null), href: `/crm/tasks/${task.id}` }));
    },
  },
  {
    key: "crm.notes",
    label: "Notes",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { notes } = await searchNotes(client, context, { search: term, limit });
      return notes.map((note) => ({ recordId: note.id, title: text(note.title) || text(note.bodyText) || "Note", detail: text(note.relatedName), href: `${CRM_RECORD_PATHS[note.relatedType] ?? "/crm"}/${note.relatedId}?tab=notes` }));
    },
  },
  {
    key: "crm.files",
    label: "Files",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { attachments } = await searchAttachments(client, context, { search: term, limit });
      return attachments.map((file) => ({ recordId: file.id, title: text(file.fileName) || "File", detail: text(file.relatedName), href: `${CRM_RECORD_PATHS[file.relatedType] ?? "/crm"}/${file.relatedId}?tab=attachments` }));
    },
  },
  {
    key: "sales.customers",
    label: "Customers",
    moduleKey: "sales",
    requiredPermission: "sales.customers.view",
    // The Customer Master search: number, name, legal name, GSTIN, scoped to
    // the customers the caller can see.
    async execute(client, context, term, limit) {
      const rows = await searchCustomers(client, context, term, { limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.displayName) || "Customer", detail: [row.customerNumber, row.gstin].filter(Boolean).join(" · "), href: `/sales/customers/${row.id}` }));
    },
  },
  {
    key: "sales.products",
    label: "Products and services",
    moduleKey: "sales",
    requiredPermission: "products.view",
    // The shared catalogue: code, name, SKU, barcode, HSN / SAC, category.
    async execute(client, context, term, limit) {
      const { products } = await listProducts(client, context, { search: term, status: "active", limit });
      return products.map((row) => ({ recordId: row.id, title: text(row.name) || "Product", detail: [row.code, row.typeLabel].filter(Boolean).join(" · "), href: `/sales/products/${row.id}` }));
    },
  },
]);
