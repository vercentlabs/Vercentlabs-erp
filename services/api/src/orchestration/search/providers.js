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
import { listCreditNotes, listDeliveries, listQuotations, listSalesInvoices, listSalesOrders, listSalesReturns } from "../../modules/sales/index.js";
import { listCustomerRefunds } from "../../modules/accounting/refunds/index.js";
import { listPurchaseOrders } from "../../modules/procurement/purchase-orders/records.js";
import { listSupplierBills } from "../../modules/procurement/supplier-bills/records.js";
import { listSuppliers } from "../../modules/procurement/suppliers/records.js";
import { listWarehouses } from "../../modules/stock/warehouses.js";
import { listProjects, listTaskQueue } from "../../modules/projects/index.js";
import { getAssetRegister } from "../../modules/assets/asset-register/register-read.js";
import { listPosTransactions } from "../../modules/point-of-sale/index.js";
import { listInspections } from "../../modules/quality/inspections.js";
import { listNonconformances } from "../../modules/quality/nonconformance/nc-read.js";

const CRM_RECORD_PATHS = Object.freeze({ lead: "/crm/leads", party: "/crm/accounts", contact: "/crm/contacts", opportunity: "/crm/opportunities" });
const text = (value) => (value === null || value === undefined || value === "" ? null : String(value).slice(0, 160));
const joined = (...parts) => text(parts.filter(Boolean).join(" ").trim());
// Lists without a search of their own (Quality) are matched here, on the few safe fields shown.
const matches = (term, ...values) => values.some((value) => value && String(value).toLowerCase().includes(term.toLowerCase()));

export const SEARCH_PROVIDERS = Object.freeze([
  {
    key: "crm.leads",
    label: "Leads",
    moduleKey: "crm",
    requiredPermission: "crm.leads.view",
    async execute(client, context, term, limit) {
      const { leads } = await listLeads(client, context, { view: "all", search: term, limit });
      return leads.map((lead) => ({ recordId: lead.id, title: text(lead.fullName) || text(lead.companyName) || "Lead", detail: text(lead.fullName ? lead.companyName : lead.code), href: `/crm/leads/${lead.id}` }));
    },
  },
  {
    key: "crm.accounts",
    label: "Companies",
    moduleKey: "crm",
    requiredPermission: "crm.accounts.view",
    async execute(client, context, term, limit) {
      const { accounts } = await listAccounts(client, context, { search: term, limit });
      return accounts.map((account) => ({ recordId: account.id, title: text(account.displayName) || "Company", detail: joined(account.code, account.city), href: `/crm/accounts/${account.id}` }));
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
    label: "Deals",
    moduleKey: "crm",
    requiredPermission: "crm.view",
    async execute(client, context, term, limit) {
      const { opportunities } = await listOpportunities(client, context, { search: term, limit });
      return opportunities.map((row) => ({ recordId: row.id, title: text(row.name) || "Deal", detail: joined(row.code, row.accountName ? `· ${row.accountName}` : null), href: `/crm/opportunities/${row.id}` }));
    },
  },
  {
    key: "crm.tasks",
    label: "Tasks",
    moduleKey: "crm",
    requiredPermission: "crm.tasks.view",
    async execute(client, context, term, limit) {
      const { tasks } = await listTasks(client, context, { view: "all", search: term, limit });
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
  // Sales documents: each provider is the document list's own search (number,
  // customer, customer PO, and the numbers of related documents), scoped to the
  // documents the caller may see.
  {
    key: "sales.quotations",
    label: "Quotations",
    moduleKey: "sales",
    requiredPermission: "sales.quotation.view",
    async execute(client, context, term, limit) {
      const { rows } = await listQuotations(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.quotation_number) || "Quotation", detail: joined(row.customer_name, row.status_label && `· ${row.status_label}`), href: `/sales/quotations/${row.id}` }));
    },
  },
  {
    key: "sales.orders",
    label: "Sales orders",
    moduleKey: "sales",
    requiredPermission: "sales.order.view",
    async execute(client, context, term, limit) {
      const { rows } = await listSalesOrders(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.sales_order_number) || "Sales order", detail: joined(row.customer_name, row.customer_po_number && `· PO ${row.customer_po_number}`), href: `/sales/orders/${row.id}` }));
    },
  },
  {
    key: "sales.deliveries",
    label: "Deliveries",
    moduleKey: "sales",
    requiredPermission: "sales.delivery.view",
    async execute(client, context, term, limit) {
      const { rows } = await listDeliveries(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.delivery_number) || "Delivery", detail: joined(row.customer_name, row.sales_order_number && `· ${row.sales_order_number}`, row.tracking_number && `· ${row.tracking_number}`), href: `/sales/deliveries/${row.id}` }));
    },
  },
  {
    key: "sales.invoices",
    label: "Invoices",
    moduleKey: "sales",
    requiredPermission: "sales.invoice.view",
    async execute(client, context, term, limit) {
      const { rows } = await listSalesInvoices(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.invoice_number) || "Draft invoice", detail: joined(row.customer_name, row.sales_order_number && `· ${row.sales_order_number}`), href: `/sales/invoices/${row.id}` }));
    },
  },
  {
    key: "sales.returns",
    label: "Sales returns",
    moduleKey: "sales",
    requiredPermission: "sales.return.view",
    async execute(client, context, term, limit) {
      const { rows } = await listSalesReturns(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.return_number) || "Return", detail: joined(row.customer_name, row.delivery_number && `· ${row.delivery_number}`), href: `/sales/returns/${row.id}` }));
    },
  },
  {
    key: "sales.credit-notes",
    label: "Credit notes",
    moduleKey: "sales",
    requiredPermission: "sales.credit_note.view",
    async execute(client, context, term, limit) {
      const { rows } = await listCreditNotes(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.invoice_number) || "Draft credit note", detail: joined(row.customer_name, row.source_invoice_number && `· against ${row.source_invoice_number}`), href: `/sales/credit-notes/${row.id}` }));
    },
  },
  {
    // Finance owns refunds; Sales → Refunds opens the same records.
    key: "sales.refunds",
    label: "Refunds",
    moduleKey: "sales",
    requiredPermission: "accounting.refund.view",
    async execute(client, context, term, limit) {
      const { rows } = await listCustomerRefunds(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.refund_number) || "Draft refund", detail: joined(row.customer_name, row.source_number && `· from ${row.source_number}`), href: `/sales/refunds/${row.id}` }));
    },
  },
  // Shared Platform plan 5: every built app is searchable. Each uses its own list function (and its scope); HR, Support and
  // Manufacturing join when those apps are rebuilt.
  {
    key: "procurement.suppliers",
    label: "Suppliers",
    moduleKey: "procurement",
    requiredPermission: "procurement.suppliers.view",
    async execute(client, context, term, limit) {
      const { rows } = await listSuppliers(client, context, { search: term, limit, sort: "name" });
      return rows.map((row) => ({ recordId: row.id, title: text(row.supplierName) || "Supplier", detail: [row.supplierNumber, row.gstin].filter(Boolean).join(" · "), href: `/procurement/suppliers/${row.id}` }));
    },
  },
  {
    key: "procurement.purchase-orders",
    label: "Purchase orders",
    moduleKey: "procurement",
    requiredPermission: "procurement.po.view",
    async execute(client, context, term, limit) {
      const { rows } = await listPurchaseOrders(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.purchaseOrderNumber) || "Draft purchase order", detail: joined(row.supplierName, row.statusLabel && `· ${row.statusLabel}`), href: `/procurement/purchase-orders/${row.id}` }));
    },
  },
  {
    key: "procurement.supplier-bills",
    label: "Supplier bills",
    moduleKey: "procurement",
    requiredPermission: "procurement.bills.view",
    async execute(client, context, term, limit) {
      const rows = await listSupplierBills(client, context, { search: term });
      return rows.slice(0, limit).map((row) => ({ recordId: row.id, title: text(row.billNumber ?? row.supplierInvoiceNumber) || "Draft bill", detail: joined(row.supplierName, row.supplierInvoiceNumber && `· ${row.supplierInvoiceNumber}`), href: `/procurement/supplier-bills/${row.id}` }));
    },
  },
  {
    key: "stock.warehouses",
    label: "Warehouses",
    moduleKey: "stock",
    requiredPermission: "warehouses.view",
    async execute(client, context, term, limit) {
      const { warehouses } = await listWarehouses(client, context, { search: term });
      return warehouses.slice(0, limit).map((row) => ({ recordId: row.id, title: text(row.name) || "Warehouse", detail: joined(row.code, row.city && `· ${row.city}`), href: `/inventory/warehouses/${row.id}` }));
    },
  },
  {
    key: "projects.projects",
    label: "Projects",
    moduleKey: "projects",
    requiredPermission: "projects.view",
    async execute(client, context, term, limit) {
      const { rows } = await listProjects(client, context, { search: term, pageSize: limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.name) || "Project", detail: joined(row.code, row.customer && `· ${row.customer}`), href: `/projects/${row.id}` }));
    },
  },
  {
    key: "projects.tasks",
    label: "Project tasks",
    moduleKey: "projects",
    requiredPermission: "projects.tasks.view",
    async execute(client, context, term, limit) {
      const { rows } = await listTaskQueue(client, context, { search: term, pageSize: limit, view: "all" });
      return rows.map((row) => ({ recordId: row.id, title: text(row.title) || "Task", detail: joined(row.code, row.projectCode && `· ${row.projectCode}`), href: `/projects/tasks/${row.id}` }));
    },
  },
  {
    key: "assets.register",
    label: "Assets",
    moduleKey: "assets",
    requiredPermission: "assets.view",
    async execute(client, context, term, limit) {
      const { rows } = await getAssetRegister(client, context, { search: term, pageSize: limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.name) || "Asset", detail: joined(row.code, row.location && `· ${row.location}`), href: `/assets/register/${row.id}` }));
    },
  },
  {
    key: "pos.transactions",
    label: "POS sales",
    moduleKey: "point-of-sale",
    requiredPermission: "pos.view",
    // The receipt search: receipt or invoice number, customer name or phone.
    async execute(client, context, term, limit) {
      const { rows } = await listPosTransactions(client, context, { search: term, limit });
      return rows.map((row) => ({ recordId: row.id, title: text(row.invoice_number ?? row.receipt_number) || "POS sale", detail: joined(row.customer_name ?? row.buyer_name_snapshot, row.receipt_number && row.invoice_number && `· ${row.receipt_number}`), href: `/pos/transactions/${row.id}` }));
    },
  },
  {
    key: "quality.inspections",
    label: "Inspections",
    moduleKey: "quality",
    requiredPermission: "quality.view",
    async execute(client, context, term, limit) {
      const rows = (await listInspections(client, context, {})).filter((row) => matches(term, row.inspection_number, row.plan_name, row.plan_code));
      return rows.slice(0, limit).map((row) => ({ recordId: row.id, title: text(row.inspection_number) || "Inspection", detail: joined(row.plan_name, row.overall_result && `· ${row.overall_result}`), href: `/quality/inspection/${row.id}` }));
    },
  },
  {
    key: "quality.nonconformances",
    label: "Nonconformances",
    moduleKey: "quality",
    requiredPermission: "quality.nonconformance.view",
    async execute(client, context, term, limit) {
      const rows = await listNonconformances(client, context, { search: term });
      return rows.slice(0, limit).map((row) => ({ recordId: row.id, title: text(row.number) || "Nonconformance", detail: joined(row.title, row.statusLabel && `· ${row.statusLabel}`), href: `/quality/nonconformances/${row.id}` }));
    },
  },
]);

