// Registered report datasets. A dataset exists only when it can be served by
// the owning module's authoritative, scoped read - the same list function the
// module's screens use - so a report never sees more than the screen does
// (record scope, ownership rules, margin redaction). Columns
// are an explicit allow-list: contact PII (email, phone) is not exportable
// through shared reports at all.
import { listAccounts } from "../../modules/crm/accounts/index.js";
import { listContacts } from "../../modules/crm/contacts/index.js";
import { getLeadsByStatusReport, listLeads } from "../../modules/crm/leads/index.js";
import { listSalesOrders } from "../../modules/sales/index.js";
import { BREAKDOWN_DIMENSIONS, getMetricDrilldown, getMetricRollup, PIPELINE_METRICS } from "../../modules/crm/index.js";
import { listSalesInvoices } from "../../modules/sales/index.js";
import { listPurchaseOrders } from "../../modules/procurement/purchase-orders/records.js";
import { listSupplierBills } from "../../modules/procurement/supplier-bills/records.js";
import { getStockBalance } from "../../modules/stock/balances.js";
import { listPosTransactions } from "../../modules/point-of-sale/index.js";
import { listTimeEntries } from "../../modules/projects/timesheets/time-read.js";
import { getAssetRegister } from "../../modules/assets/asset-register/register-read.js";

// CRM analytical datasets (F030) are computed by the canonical CRM metric
// layer (metric-definitions.js), so a saved or scheduled report shows the
// same figures as the pipeline dashboard and its drill-downs.
const CRM_ANALYTICS_FILTERS = Object.freeze([
  { key: "from", label: "From (YYYY-MM-DD)" },
  { key: "to", label: "To (YYYY-MM-DD)" },
  { key: "pipelineId", label: "Pipeline" },
  { key: "stageId", label: "Stage" },
  { key: "teamId", label: "Sales team (includes sub-teams)" },
  { key: "ownerId", label: "Owner" },
  { key: "sourceId", label: "Source" },
  { key: "forecastCategory", label: "Forecast category" },
]);
const ROLLUP_METRICS = Object.freeze(["open_opportunities", "open_pipeline", "weighted_pipeline", "closing_in_period", "commit", "best_case", "won_amount", "won_count", "lost_amount", "lost_count", "win_rate", "stalled_opportunities"]);
const analyticsFilters = (filters) => Object.fromEntries(CRM_ANALYTICS_FILTERS.map(({ key }) => [key, filters[key]]).filter(([, value]) => value));


export const REPORT_DATASETS = Object.freeze([
  Object.freeze({
    key: "crm.contacts",
    moduleKey: "crm",
    schedulePermission: "crm.reports.schedule",
    label: "CRM contacts",
    description: "Contacts you can see in CRM, with company, job title, role, owner and activity.",
    requiredPermissions: Object.freeze(["crm.contacts.view", "crm.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "contactNumber", label: "Contact number" },
      { key: "displayName", label: "Name" },
      { key: "accountName", label: "Company" },
      { key: "jobTitle", label: "Job title" },
      { key: "department", label: "Department" },
      { key: "roleLabel", label: "Role" },
      { key: "isDecisionMaker", label: "Decision maker" },
      { key: "status", label: "Status" },
      { key: "ownerName", label: "Owner" },
      { key: "sourceName", label: "Source" },
      { key: "openOpportunities", label: "Open opportunities" },
      { key: "lastActivityAt", label: "Last activity" },
      { key: "createdAt", label: "Created" },
    ]),
    filters: Object.freeze([
      { key: "status", label: "Status" },
      { key: "ownerId", label: "Owner" },
      { key: "accountId", label: "Account" },
      { key: "department", label: "Department" },
      { key: "role", label: "Role" },
      { key: "createdFrom", label: "Created from (YYYY-MM-DD)" },
      { key: "createdTo", label: "Created to (YYYY-MM-DD)" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += 200) {
        const page = await listContacts(client, context, { ...filters, sortBy: "createdAt", limit: 200, offset });
        rows.push(...page.contacts);
        if (page.contacts.length < 200 || offset + 200 >= page.total) break;
      }
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.accounts",
    moduleKey: "crm",
    schedulePermission: "crm.reports.schedule",
    label: "CRM accounts",
    description: "Accounts you can see in CRM, with type, status, owner, location and open pipeline.",
    requiredPermissions: Object.freeze(["crm.accounts.view", "crm.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "code", label: "Account number" },
      { key: "displayName", label: "Account name" },
      { key: "accountType", label: "Type" },
      { key: "status", label: "Status" },
      { key: "customerNumber", label: "Customer number" },
      { key: "industry", label: "Industry" },
      { key: "ownerName", label: "Owner" },
      { key: "teamName", label: "Team" },
      { key: "sourceName", label: "Source" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "countryCode", label: "Country" },
      { key: "contactCount", label: "Contacts" },
      { key: "openOpportunities", label: "Open opportunities" },
      { key: "openPipelineValue", label: "Open pipeline" },
      { key: "lastActivityAt", label: "Last activity" },
      { key: "createdAt", label: "Created" },
    ]),
    filters: Object.freeze([
      { key: "accountType", label: "Type" },
      { key: "status", label: "Status" },
      { key: "ownerId", label: "Owner" },
      { key: "industry", label: "Industry" },
      { key: "sourceId", label: "Source" },
      { key: "createdFrom", label: "Created from (YYYY-MM-DD)" },
      { key: "createdTo", label: "Created to (YYYY-MM-DD)" },
      { key: "lastActivityBefore", label: "No activity since (YYYY-MM-DD)" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += 200) {
        const page = await listAccounts(client, context, { ...filters, sortBy: "createdAt", limit: 200, offset });
        rows.push(...page.accounts);
        if (page.accounts.length < 200 || offset + 200 >= page.total) break;
      }
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.leads",
    moduleKey: "crm",
    schedulePermission: "crm.reports.schedule",
    label: "CRM leads",
    description: "Leads you can see in CRM, with stage, status, owner, source and value.",
    requiredPermissions: Object.freeze(["crm.leads.view", "crm.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "code", label: "Lead number" },
      { key: "fullName", label: "Name" },
      { key: "companyName", label: "Company" },
      { key: "stage", label: "Stage" },
      { key: "status", label: "Status" },
      { key: "ownerName", label: "Owner" },
      { key: "sourceName", label: "Source" },
      { key: "priority", label: "Priority" },
      { key: "rating", label: "Rating" },
      { key: "estimatedValue", label: "Estimated value" },
      { key: "currencyCode", label: "Currency" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "countryCode", label: "Country" },
      { key: "createdAt", label: "Created" },
      { key: "convertedAt", label: "Converted" },
    ]),
    filters: Object.freeze([
      { key: "status", label: "Status" },
      { key: "stage", label: "Stage" },
      { key: "ownerId", label: "Owner" },
      { key: "sourceId", label: "Source" },
      { key: "createdFrom", label: "Created from (YYYY-MM-DD)" },
      { key: "createdTo", label: "Created to (YYYY-MM-DD)" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += 200) {
        const page = await listLeads(client, context, { ...filters, sortBy: "createdAt", limit: 200, offset });
        rows.push(...page.leads);
        if (page.leads.length < 200 || offset + 200 >= page.total) break;
      }
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.leads_by_status",
    moduleKey: "crm",
    schedulePermission: "crm.reports.schedule",
    label: "CRM leads by status",
    description: "Lead counts and estimated value by status, stage, owner, source or created month.",
    requiredPermissions: Object.freeze(["crm.leads.view", "crm.reports.view"]),
    maxRows: 1_000,
    columns: Object.freeze([
      { key: "group", label: "Group" },
      { key: "total", label: "Leads" },
      { key: "open", label: "Open" },
      { key: "qualified", label: "Qualified" },
      { key: "disqualified", label: "Disqualified" },
      { key: "converted", label: "Converted" },
      { key: "conversionRate", label: "Conversion %" },
      { key: "estimatedValue", label: "Estimated value" },
    ]),
    filters: Object.freeze([
      { key: "groupBy", label: "Group by (status, stage, owner, source, month)" },
      { key: "ownerId", label: "Owner" },
      { key: "sourceId", label: "Source" },
      { key: "status", label: "Status" },
      { key: "stage", label: "Stage" },
      { key: "converted", label: "Converted (yes / no)" },
      { key: "createdFrom", label: "Created from (YYYY-MM-DD)" },
      { key: "createdTo", label: "Created to (YYYY-MM-DD)" },
    ]),
    async execute(client, context, filters, maxRows) {
      return (await getLeadsByStatusReport(client, context, filters)).rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.pipeline_analysis",
    moduleKey: "crm",
    label: "CRM pipeline analysis",
    description: "Pipeline, forecast and win/loss measures grouped by stage, owner, team, source, category, pipeline or close month.",
    requiredPermissions: Object.freeze(["crm.view", "crm.reports.view"]),
    schedulePermission: "crm.reports.schedule",
    maxRows: 5_000,
    columns: Object.freeze([
      { key: "group", label: "Group" },
      ...ROLLUP_METRICS.map((key) => ({ key, label: PIPELINE_METRICS[key].label })),
    ]),
    filters: Object.freeze([
      { key: "groupBy", label: "Group by" },
      { key: "sortBy", label: "Sort by" },
      { key: "sortDirection", label: "Sort direction" },
      ...CRM_ANALYTICS_FILTERS,
    ]),
    async execute(client, context, filters, maxRows) {
      const dimension = filters.groupBy && BREAKDOWN_DIMENSIONS[filters.groupBy] ? filters.groupBy : "stage";
      const rollup = await getMetricRollup(client, context, { dimension, metrics: ROLLUP_METRICS, filters: analyticsFilters(filters) });
      const rows = rollup.rows.map((row) => ({ group: row.label, ...row.values }));
      const sortBy = ROLLUP_METRICS.includes(filters.sortBy) ? filters.sortBy : null;
      if (sortBy) {
        const direction = filters.sortDirection === "asc" ? 1 : -1;
        rows.sort((a, b) => ((a[sortBy] ?? -Infinity) - (b[sortBy] ?? -Infinity)) * direction || String(a.group).localeCompare(String(b.group)));
      }
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.opportunity_records",
    moduleKey: "crm",
    label: "CRM opportunities behind a measure",
    description: "The exact opportunities behind a pipeline measure (for example Commit or Won), with converted amounts.",
    requiredPermissions: Object.freeze(["crm.view", "crm.reports.view"]),
    schedulePermission: "crm.reports.schedule",
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "code", label: "Code" },
      { key: "name", label: "Opportunity" },
      { key: "status", label: "Status" },
      { key: "stageName", label: "Stage" },
      { key: "ownerName", label: "Owner" },
      { key: "teamName", label: "Sales team" },
      { key: "forecastCategory", label: "Forecast category" },
      { key: "probability", label: "Probability" },
      { key: "amount", label: "Amount" },
      { key: "currencyCode", label: "Currency" },
      { key: "amountReporting", label: "Amount (reporting currency)" },
      { key: "weightedReporting", label: "Weighted (reporting currency)" },
      { key: "expectedCloseDate", label: "Expected close" },
      { key: "actualCloseDate", label: "Closed on" },
    ]),
    filters: Object.freeze([{ key: "metric", label: "Measure" }, ...CRM_ANALYTICS_FILTERS]),
    async execute(client, context, filters, maxRows) {
      const metric = PIPELINE_METRICS[filters.metric] ? filters.metric : "open_pipeline";
      const rows = [];
      let cursor = null;
      do {
        const page = await getMetricDrilldown(client, context, { metric, filters: analyticsFilters(filters), cursor, limit: 200 });
        rows.push(...page.records);
        cursor = page.nextCursor;
      } while (cursor && rows.length < maxRows);
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "sales.orders",
    moduleKey: "sales",
    label: "Sales orders",
    description: "Sales orders you can see in Sales, with status and totals.",
    requiredPermissions: Object.freeze(["sales.view", "sales.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "sales_order_number", label: "Order number" },
      { key: "customer_name", label: "Customer" },
      { key: "order_date", label: "Order date" },
      { key: "lifecycle_status", label: "Status" },
      { key: "approval_status", label: "Approval" },
      { key: "fulfillment_status", label: "Fulfilment" },
      { key: "billing_status", label: "Billing" },
      { key: "currency_code", label: "Currency" },
      { key: "grand_total", label: "Total" },
    ]),
    filters: Object.freeze([
      { key: "status", label: "Status" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      return collectByOffset((offset) => listSalesOrders(client, context, { ...filters, limit: LIST_PAGE, offset }).then((page) => page.rows), maxRows);
    },
  }),
  // Shared Platform plan 5: each app's key lists, served by the app's own scoped list (so a report sees what the screen does).
  Object.freeze({
    key: "sales.invoices",
    moduleKey: "sales",
    label: "Sales invoices",
    description: "Invoices you can see in Sales: number, customer, dates, total, what is still due and whether it is overdue.",
    requiredPermissions: Object.freeze(["sales.invoice.view", "sales.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "invoice_number", label: "Invoice number" },
      { key: "customer_name", label: "Customer" },
      { key: "customer_number", label: "Customer number" },
      { key: "invoice_date", label: "Invoice date" },
      { key: "due_date", label: "Due date" },
      { key: "sales_order_number", label: "Sales order" },
      { key: "statusLabel", label: "Status" },
      { key: "paymentStatusLabel", label: "Payment" },
      { key: "grand_total", label: "Total" },
      { key: "balance_due", label: "Balance due" },
      { key: "overdue", label: "Overdue" },
    ]),
    filters: Object.freeze([{ key: "status", label: "Status (draft, posted, reversed)" }, { key: "search", label: "Search" }]),
    async execute(client, context, filters, maxRows) {
      return collectByOffset((offset) => listSalesInvoices(client, context, { ...filters, limit: LIST_PAGE, offset }).then((page) => page.rows), maxRows);
    },
  }),
  Object.freeze({
    key: "sales.receivables_ageing",
    moduleKey: "sales",
    label: "Receivables ageing",
    description: "Posted invoices with money still due, by how long past the due date: not due, 1-30, 31-60, 61-90 and over 90 days.",
    requiredPermissions: Object.freeze(["sales.invoice.view", "sales.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "customer_name", label: "Customer" },
      { key: "invoice_number", label: "Invoice number" },
      { key: "invoice_date", label: "Invoice date" },
      { key: "due_date", label: "Due date" },
      { key: "days_overdue", label: "Days overdue" },
      { key: "bucket", label: "Ageing" },
      { key: "balance_due", label: "Balance due" },
    ]),
    filters: Object.freeze([{ key: "asOf", label: "As of (YYYY-MM-DD)" }, { key: "search", label: "Customer or invoice" }]),
    async execute(client, context, filters, maxRows) {
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(filters.asOf ?? "")) ? String(filters.asOf)
        : (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'Asia/Kolkata'))::date, 'YYYY-MM-DD') AS d`, [context.organizationId])).rows[0].d;
      const invoices = await collectByOffset((offset) => listSalesInvoices(client, context, { status: "posted", search: filters.search, limit: LIST_PAGE, offset }).then((page) => page.rows), 50_000);
      return invoices.filter((row) => Number(row.balance_due) > 0.005).map((row) => {
        const due = dayText(row.due_date ?? row.invoice_date);
        const days = due ? Math.max(0, Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 864e5)) : 0;
        return { ...row, days_overdue: days, bucket: ageingBucket(days) };
      }).sort((a, b) => String(a.customer_name ?? "").localeCompare(String(b.customer_name ?? "")) || b.days_overdue - a.days_overdue).slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "stock.on_hand",
    moduleKey: "stock",
    label: "Stock on hand",
    description: "What is in each warehouse, item by item: on hand, reserved, available, on hold and (if you may see it) the value.",
    requiredPermissions: Object.freeze(["stock.view", "stock.reports.view"]),
    maxRows: 20_000,
    columns: Object.freeze([
      { key: "sku", label: "SKU" },
      { key: "itemName", label: "Item" },
      { key: "category", label: "Category" },
      { key: "warehouseName", label: "Warehouse" },
      { key: "baseUom", label: "Unit" },
      { key: "onHand", label: "On hand" },
      { key: "reserved", label: "Reserved" },
      { key: "available", label: "Available" },
      { key: "qualityHold", label: "Quality hold" },
      { key: "inTransit", label: "In transit" },
      { key: "value", label: "Value" },
    ]),
    filters: Object.freeze([{ key: "warehouseId", label: "Warehouse" }, { key: "search", label: "Item" }]),
    async execute(client, context, filters, maxRows) {
      return collectByOffset((offset) => getStockBalance(client, context, { ...filters, view: "warehouse", limit: 1000, offset }).then((page) => page.rows), maxRows, 1000);
    },
  }),
  Object.freeze({
    key: "procurement.purchase_orders",
    moduleKey: "procurement",
    label: "Purchase orders",
    description: "Purchase orders you can see: supplier, dates, status, receipt and billing progress, total.",
    requiredPermissions: Object.freeze(["procurement.po.view", "procurement.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "purchaseOrderNumber", label: "PO number" },
      { key: "supplierName", label: "Supplier" },
      { key: "orderDate", label: "Order date" },
      { key: "expectedDeliveryDate", label: "Expected" },
      { key: "statusLabel", label: "Status" },
      { key: "receiptLabel", label: "Received" },
      { key: "billingLabel", label: "Billed" },
      { key: "buyerName", label: "Buyer" },
      { key: "currencyCode", label: "Currency" },
      { key: "grandTotal", label: "Total" },
    ]),
    filters: Object.freeze([{ key: "status", label: "Status" }, { key: "search", label: "Search" }]),
    async execute(client, context, filters, maxRows) {
      return collectByOffset((offset) => listPurchaseOrders(client, context, { ...filters, limit: LIST_PAGE, offset }).then((page) => page.rows), maxRows);
    },
  }),
  Object.freeze({
    key: "procurement.supplier_bills",
    moduleKey: "procurement",
    label: "Supplier bills",
    description: "Supplier bills: supplier invoice number and date, due date, net payable, paid and balance due (the latest 300 for the filter).",
    requiredPermissions: Object.freeze(["procurement.bills.view", "procurement.reports.view"]),
    maxRows: 300,
    columns: Object.freeze([
      { key: "billNumber", label: "Bill number" },
      { key: "supplierName", label: "Supplier" },
      { key: "supplierInvoiceNumber", label: "Supplier invoice" },
      { key: "supplierInvoiceDate", label: "Invoice date" },
      { key: "dueDate", label: "Due date" },
      { key: "purchaseOrderNumber", label: "PO" },
      { key: "status", label: "Status" },
      { key: "netPayable", label: "Net payable" },
      { key: "paid", label: "Paid" },
      { key: "balanceDue", label: "Balance due" },
    ]),
    filters: Object.freeze([{ key: "status", label: "Status" }, { key: "search", label: "Search" }]),
    async execute(client, context, filters, maxRows) {
      return (await listSupplierBills(client, context, filters)).slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "pos.sales",
    moduleKey: "point-of-sale",
    label: "POS sales",
    description: "Point of Sale sales: receipt and invoice number, store, terminal, cashier, customer, payment methods and totals.",
    requiredPermissions: Object.freeze(["pos.view", "pos.reports.view"]),
    maxRows: 20_000,
    columns: Object.freeze([
      { key: "receipt_number", label: "Receipt" },
      { key: "invoice_number", label: "Invoice" },
      { key: "sale_date", label: "Date" },
      { key: "store_name", label: "Store" },
      { key: "terminal_name", label: "Terminal" },
      { key: "cashier_name", label: "Cashier" },
      { key: "customer_display", label: "Customer" },
      { key: "payment_methods", label: "Paid by" },
      { key: "status", label: "Status" },
      { key: "discount_total", label: "Discount" },
      { key: "tax_total", label: "Tax" },
      { key: "grand_total", label: "Total" },
    ]),
    filters: Object.freeze([{ key: "dateFrom", label: "From (YYYY-MM-DD)" }, { key: "dateTo", label: "To (YYYY-MM-DD)" }, { key: "storeId", label: "Store" }, { key: "status", label: "Status" }]),
    async execute(client, context, filters, maxRows) {
      return collectByOffset((offset) => listPosTransactions(client, context, { ...filters, limit: 100, offset }).then((page) => page.rows), maxRows, 100);
    },
  }),
  Object.freeze({
    key: "projects.timesheets",
    moduleKey: "projects",
    label: "Timesheets",
    description: "Time entries you can see: person, project, task, date, hours, billable and status.",
    requiredPermissions: Object.freeze(["projects.time.view_own", "projects.reports.view"]),
    maxRows: 20_000,
    columns: Object.freeze([
      { key: "number", label: "Entry" },
      { key: "employee", label: "Person" },
      { key: "projectCode", label: "Project" },
      { key: "task", label: "Task" },
      { key: "workDate", label: "Date" },
      { key: "durationMinutes", label: "Minutes" },
      { key: "duration", label: "Hours" },
      { key: "billable", label: "Billable" },
      { key: "statusLabel", label: "Status" },
      { key: "description", label: "Description" },
    ]),
    filters: Object.freeze([{ key: "from", label: "From (YYYY-MM-DD)" }, { key: "to", label: "To (YYYY-MM-DD)" }, { key: "projectId", label: "Project" }, { key: "status", label: "Status" }]),
    async execute(client, context, filters, maxRows) {
      return collectByPage((page) => listTimeEntries(client, context, { ...filters, page, pageSize: LIST_PAGE }), maxRows);
    },
  }),
  Object.freeze({
    key: "assets.register",
    moduleKey: "assets",
    label: "Asset register",
    description: "Every asset you can see: code, category, location, custodian, lifecycle and condition.",
    requiredPermissions: Object.freeze(["assets.view", "assets.reports.view"]),
    maxRows: 20_000,
    columns: Object.freeze([
      { key: "code", label: "Asset code" },
      { key: "name", label: "Name" },
      { key: "category", label: "Category" },
      { key: "serialNumber", label: "Serial number" },
      { key: "location", label: "Location" },
      { key: "department", label: "Department" },
      { key: "custodian", label: "Custodian" },
      { key: "lifecycleLabel", label: "Lifecycle" },
      { key: "condition", label: "Condition" },
    ]),
    filters: Object.freeze([{ key: "categoryId", label: "Category" }, { key: "locationId", label: "Location" }, { key: "search", label: "Search" }]),
    async execute(client, context, filters, maxRows) {
      return collectByPage((page) => getAssetRegister(client, context, { ...filters, page, pageSize: 500 }), maxRows);
    },
  }),  // Shared Platform plan 7: GST returns support.
  Object.freeze({
    key: "tax.gstr1_documents",
    moduleKey: "sales",
    label: "GSTR-1 documents issued",
    description: "Table 13 of GSTR-1: for each document series (invoices, credit and debit notes, POS invoices), the first and last number, how many and how many were cancelled.",
    requiredPermissions: Object.freeze(["tax.view", "sales.reports.view"]),
    maxRows: 2_000,
    columns: Object.freeze([
      { key: "nature", label: "Nature of document" },
      { key: "series", label: "Series" },
      { key: "fromNumber", label: "From" },
      { key: "toNumber", label: "To" },
      { key: "total", label: "Total number" },
      { key: "cancelled", label: "Cancelled" },
      { key: "netIssued", label: "Net issued" },
    ]),
    filters: Object.freeze([{ key: "from", label: "From (YYYY-MM-DD)" }, { key: "to", label: "To (YYYY-MM-DD)" }]),
    async execute(client, context, filters, maxRows) {
      const { from, to } = await returnPeriod(client, context, filters);
      const rows = (await client.query(
        `WITH documents AS (
           SELECT CASE invoice.invoice_type WHEN 'credit_note' THEN 'Credit note' WHEN 'debit_note' THEN 'Debit note' ELSE 'Invoice for outward supply' END AS nature,
                  invoice.invoice_number AS number, invoice.status IN ('cancelled', 'reversed') AS cancelled
             FROM tenant.accounting_customer_invoices invoice
            WHERE invoice.organization_id = $1 AND invoice.invoice_type <> 'opening' AND invoice.status NOT IN ('draft', 'pending_approval')
              AND invoice.invoice_date BETWEEN $2::date AND $3::date
           UNION ALL
           SELECT 'Invoice for outward supply (POS)', sale.invoice_number, sale.status = 'voided'
             FROM tenant.pos_sales sale
            WHERE sale.organization_id = $1 AND sale.invoice_number IS NOT NULL AND COALESCE(sale.tax_date, sale.sale_date::date) BETWEEN $2::date AND $3::date)
         SELECT nature, regexp_replace(number, '[0-9]+$', '') AS series,
                (array_agg(number ORDER BY substring(number from '([0-9]+)$')::bigint))[1] AS from_number,
                (array_agg(number ORDER BY substring(number from '([0-9]+)$')::bigint DESC))[1] AS to_number,
                count(*)::int AS total, count(*) FILTER (WHERE cancelled)::int AS cancelled
           FROM documents WHERE number ~ '[0-9]+$' GROUP BY nature, regexp_replace(number, '[0-9]+$', '') ORDER BY nature, series`,
        [context.organizationId, from, to])).rows;
      return rows.slice(0, maxRows).map((row) => ({ nature: row.nature, series: row.series, fromNumber: row.from_number, toNumber: row.to_number, total: row.total,
        cancelled: row.cancelled, netIssued: row.total - row.cancelled }));
    },
  }),
  Object.freeze({
    key: "tax.cmp08",
    moduleKey: "sales",
    label: "Composition quarterly figures (CMP-08)",
    description: "For a registration under the composition scheme: each quarter's outward turnover (sales less credit notes) and the tax it pays at the composition rate, split CGST and SGST.",
    requiredPermissions: Object.freeze(["tax.view", "sales.reports.view"]),
    maxRows: 100,
    columns: Object.freeze([
      { key: "registration", label: "Registration" },
      { key: "gstin", label: "GSTIN" },
      { key: "quarter", label: "Quarter" },
      { key: "turnover", label: "Outward turnover" },
      { key: "rate", label: "Composition rate %" },
      { key: "cgst", label: "CGST" },
      { key: "sgst", label: "SGST" },
      { key: "total", label: "Tax payable" },
    ]),
    filters: Object.freeze([{ key: "financialYear", label: "Financial year (for example 2026-27)" }]),
    async execute(client, context, filters, maxRows) {
      const start = /^(\d{4})-\d{2}$/.exec(String(filters.financialYear ?? ""))?.[1]
        ?? (await client.query(`SELECT CASE WHEN extract(month FROM now()) >= 4 THEN extract(year FROM now()) ELSE extract(year FROM now()) - 1 END::int AS y`)).rows[0].y;
      const rows = (await client.query(
        `WITH quarters AS (
           SELECT q, make_date($2::int, 4, 1) + ((q - 1) * interval '3 months') AS from_day FROM generate_series(1, 4) q),
         registrations AS (
           SELECT id, name, registration_number, COALESCE(composition_rate, 1) AS rate FROM tenant.tax_registrations
            WHERE organization_id = $1 AND registration_type = 'composition')
         SELECT registration.name, registration.registration_number, registration.rate, quarters.q,
                COALESCE((SELECT sum(CASE WHEN invoice.invoice_type = 'credit_note' THEN -invoice.grand_total ELSE invoice.grand_total END)
                            FROM tenant.accounting_customer_invoices invoice
                            LEFT JOIN tenant.sales_invoices sales_invoice ON sales_invoice.organization_id = invoice.organization_id AND sales_invoice.customer_invoice_id = invoice.id
                           WHERE invoice.organization_id = $1 AND invoice.invoice_type <> 'opening' AND invoice.status NOT IN ('draft', 'pending_approval', 'cancelled', 'reversed')
                             AND COALESCE(sales_invoice.seller_registration_id, registration.id) = registration.id
                             AND invoice.invoice_date >= quarters.from_day AND invoice.invoice_date < quarters.from_day + interval '3 months'), 0)
              + COALESCE((SELECT sum(sale.grand_total) FROM tenant.pos_sales sale
                           WHERE sale.organization_id = $1 AND sale.status <> 'voided' AND COALESCE(sale.seller_tax_registration_id, registration.id) = registration.id
                             AND sale.sale_date >= quarters.from_day AND sale.sale_date < quarters.from_day + interval '3 months'), 0) AS turnover
           FROM registrations registration CROSS JOIN quarters ORDER BY registration.name, quarters.q`,
        [context.organizationId, Number(start)])).rows;
      const label = ["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"];
      return rows.slice(0, maxRows).map((row) => {
        const turnover = Number(row.turnover);
        const half = Math.round(turnover * Number(row.rate) / 2) / 100;
        return { registration: row.name, gstin: row.registration_number, quarter: `Q${row.q} ${label[row.q - 1]} ${start}-${String(Number(start) + 1).slice(2)}`,
          turnover: turnover.toFixed(2), rate: String(Number(row.rate)), cgst: half.toFixed(2), sgst: half.toFixed(2), total: (half * 2).toFixed(2) };
      });
    },
  }),
]);

// The module lists cap a page (200 rows, mostly); reports read page after page up to their limit.
const LIST_PAGE = 200;
async function collectByOffset(fetchPage, maxRows, pageSize = LIST_PAGE) {
  const rows = [];
  for (let offset = 0; rows.length < maxRows; offset += pageSize) {
    const page = await fetchPage(offset);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.slice(0, maxRows);
}
async function collectByPage(fetchPage, maxRows) {
  const rows = [];
  for (let page = 1; rows.length < maxRows; page += 1) {
    const result = await fetchPage(page);
    rows.push(...result.rows);
    if (page >= result.pages || !result.rows.length) break;
  }
  return rows.slice(0, maxRows);
}
// A GST return's period: ?from=&to= (dates), else this month in the company's time zone.
async function returnPeriod(client, context, filters) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
  if (valid(filters.from) && valid(filters.to)) return { from: filters.from, to: filters.to };
  const row = (await client.query(
    `SELECT to_char(date_trunc('month', day), 'YYYY-MM-DD') AS f, to_char((date_trunc('month', day) + interval '1 month - 1 day')::date, 'YYYY-MM-DD') AS t
       FROM (SELECT (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'Asia/Kolkata'))::date AS day) today`, [context.organizationId])).rows[0];
  return { from: valid(filters.from) ? filters.from : row.f, to: valid(filters.to) ? filters.to : row.t };
}
const dayText = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null);
const ageingBucket = (days) => (days <= 0 ? "Not due" : days <= 30 ? "1-30 days" : days <= 60 ? "31-60 days" : days <= 90 ? "61-90 days" : "Over 90 days");


export function getReportDataset(key) {
  return REPORT_DATASETS.find((dataset) => dataset.key === key) ?? null;
}
