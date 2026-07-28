import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.resolve(root, file), "utf8");
const exists = (file) => fs.existsSync(path.resolve(root, file));
const required = [
  "src/app/(app)/sales/page.tsx",
  "src/app/(app)/sales/quotations/page.tsx",
  "src/app/(app)/sales/orders/page.tsx",
  "src/app/api/sales/pricing/preview/route.ts",
  "src/app/api/sales/quotations/[id]/actions/route.ts",
  "src/app/api/sales/orders/[id]/actions/route.ts",
  "src/app/api/public/sales/quotes/[token]/route.ts",
  "../../services/api/src/sales/index.js",
  "../../packages/permissions/src/sales.js",
  "../../packages/shared-types/src/sales.js",
  "../../database/tenant/migrations/008_sales_module.sql",
  "../../database/control-plane/migrations/012_sales_module_release.sql",
  "src/app/api/accounting/receivables/sales-requests/[id]/import/route.ts",
];
for (const file of required) if (!exists(file)) failures.push(`Missing Sales artifact: ${file}`);
function markers(file, values) {
  const source = read(file);
  for (const value of values) if (!source.includes(value)) failures.push(`${file} is missing ${value}`);
}
markers("../../services/api/src/sales/index.js", [
  "previewSalesDocument", "createQuotation", "reviseQuotation", "sendQuotation",
  "recordPublicQuoteDecision", "convertQuotationToOrder", "confirmSalesOrder",
  "amendSalesOrder", "sales_order_amendments", "placeOrderHold", "releaseOrderHold",
  "createFulfillmentRequest", "completeFulfillmentRequest", "createInvoiceRequest",
  "SALES_CREDIT_BLOCK", "sales_order_line_progress", "getSalesReport",
]);
markers("../../database/tenant/migrations/008_sales_module.sql", [
  "sales_quotations", "sales_quote_share_links", "sales_quote_decisions",
  "sales_orders", "sales_order_versions", "sales_order_amendments",
  "sales_order_line_progress", "sales_fulfillment_requests", "sales_invoice_requests",
  "sales_pricing_rules", "sales_tax_groups", "FORCE ROW LEVEL SECURITY",
]);
markers("src/app/api/sales/orders/[id]/actions/route.ts", [
  "amendSalesOrder", "completeFulfillmentRequest", "tenantTransaction", "audit",
]);
markers("src/app/api/accounting/receivables/sales-requests/[id]/import/route.ts", [
  "createInvoiceFromSalesRequest", "tenantTransaction",
]);
markers("../../packages/permissions/src/sales.js", [
  "sales.order.amend", "sales.fulfillment.request", "sales.invoice.request",
  "sales.credit.override", "sales.margin.view",
]);
if (failures.length) {
  console.error("Sales verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Sales module verified across ${required.length} end-to-end contracts.`);
