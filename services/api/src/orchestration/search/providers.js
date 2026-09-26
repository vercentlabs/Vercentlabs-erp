// The one global record-search provider registry. Each provider reuses the
// module's own list function, which applies company/branch scope, record
// ownership/team rules and sensitive-field projection; search never bypasses
// that. Providers return a small safe DTO only (no email, phone, bank, cost...).
// Register a provider here only when its domain list function is proven safe.
import { listBusinessDataRecords } from "../../core/master-data.js";
import { listCrmRecords } from "../../modules/crm/crm-data-operations-and-customization/resource-query-service.js";
import { listCrmAccounts } from "../../modules/crm/prospect-and-relationship-master-data/account-operations.js";
import { listCrmContacts } from "../../modules/crm/prospect-and-relationship-master-data/contact-operations.js";

const SALES_CUSTOMER_TYPES = ["customer", "prospect", "both"];
const text = (value) => (value === null || value === undefined || value === "" ? null : String(value).slice(0, 160));
const joined = (...parts) => text(parts.filter(Boolean).join(" ").trim());

export const SEARCH_PROVIDERS = Object.freeze([
  {
    key: "crm.leads",
    label: "Leads",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { rows } = await listCrmRecords(client, context, "leads", { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.fullName) || joined(row.firstName, row.lastName) || "Lead", detail: text(row.companyName), href: `/crm/leads/${row.id}` }));
    },
  },
  {
    key: "crm.accounts",
    label: "Accounts",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { rows } = await listCrmAccounts(client, context, { search: term, limit, status: "active" });
      return rows.map((row) => ({ recordId: row.id, title: text(row.displayName) || "Account", detail: text(row.code), href: `/crm/accounts/${row.id}` }));
    },
  },
  {
    key: "crm.contacts",
    label: "Contacts",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { rows } = await listCrmContacts(client, context, { search: term, limit, status: "active" });
      return rows.map((row) => ({ recordId: row.id, title: joined(row.firstName, row.lastName) || "Contact", detail: text(row.jobTitle), href: `/crm/contacts/${row.id}` }));
    },
  },
  {
    key: "crm.opportunities",
    label: "Opportunities",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { rows } = await listCrmRecords(client, context, "opportunities", { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.name) || "Opportunity", detail: text(row.code), href: `/crm/opportunities/${row.id}` }));
    },
  },
  {
    key: "sales.customers",
    label: "Customers",
    moduleKey: "sales",
    requiredPermission: "sales.view",
    async execute(client, context, term, limit) {
      const { rows } = await listBusinessDataRecords(client, context, "parties", { search: term, status: "active", limit, offset: 0, partyTypes: SALES_CUSTOMER_TYPES });
      return rows.map((row) => ({ recordId: row.id, title: text(row.displayName) || "Customer", detail: text(row.code), href: `/sales/customers/${row.id}` }));
    },
  },
  {
    key: "sales.products",
    label: "Products and services",
    moduleKey: "sales",
    requiredPermission: "sales.view",
    async execute(client, context, term, limit) {
      const { rows } = await listBusinessDataRecords(client, context, "items", { search: term, status: "active", limit, offset: 0 });
      return rows.map((row) => ({ recordId: row.id, title: text(row.name) || "Item", detail: text(row.code), href: "/sales/products" }));
    },
  },
]);
