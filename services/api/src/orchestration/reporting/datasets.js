// Registered report datasets. A dataset exists only when it can be served by
// the owning module's authoritative, scoped read - the same list function the
// module's screens use - so a report never sees more than the screen does
// (company/branch/record scope, ownership rules, margin redaction). Columns
// are an explicit allow-list: contact PII (email, phone) is not exportable
// through shared reports at all.
import { listCrmRecords } from "../../modules/crm/crm-data-operations-and-customization/resource-query-service.js";
import { listSalesOrders } from "../../modules/sales/index.js";

const PAGE = 500;

export const REPORT_DATASETS = Object.freeze([
  Object.freeze({
    key: "crm.leads",
    moduleKey: "crm",
    label: "CRM leads",
    description: "Leads you can see in CRM, with status, rating and value.",
    requiredPermissions: Object.freeze(["crm.view", "crm.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "code", label: "Code" },
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "companyName", label: "Company" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
      { key: "rating", label: "Rating" },
      { key: "estimatedValue", label: "Estimated value" },
      { key: "currencyCode", label: "Currency" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "countryCode", label: "Country" },
      { key: "createdAt", label: "Created" },
    ]),
    filters: Object.freeze([
      { key: "status", label: "Status" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += PAGE) {
        const page = await listCrmRecords(client, context, "leads", { ...filters, limit: PAGE, offset });
        rows.push(...page.rows);
        if (page.rows.length < PAGE || offset + PAGE >= page.total) break;
      }
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
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += PAGE) {
        const page = await listSalesOrders(client, context, { ...filters, limit: PAGE, offset });
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      return rows.slice(0, maxRows);
    },
  }),
]);

export function getReportDataset(key) {
  return REPORT_DATASETS.find((dataset) => dataset.key === key) ?? null;
}
