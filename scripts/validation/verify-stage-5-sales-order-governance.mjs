import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/sales/order-governance.js",
  "services/api/src/sales/order-governance.d.ts",
  "services/api/tests/sales-order-governance-stage5.test.mjs",
  "database/tenant/migrations/021_sales_order_governance.sql",
  "apps/web/src/app/api/sales/orders/operations/route.ts",
  "apps/web/src/app/(app)/sales/orders/page.tsx",
  "apps/web/src/app/(app)/sales/orders/[id]/page.tsx",
  "apps/web/scripts/verify-sales-order-governance-live.mjs",
  "docs/implementation/stages/STAGE_5_SALES_ORDER_GOVERNANCE.md",
];

for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is missing`);

const service = fs.readFileSync(
  "services/api/src/sales/order-governance.js",
  "utf8",
);
for (const symbol of [
  "evaluateSalesOrderHealth",
  "buildSalesOrderGovernanceSummary",
  "getSalesOrderGovernanceDashboard",
  "assessSalesOrderReadiness",
  "captureSalesOrderGovernanceSnapshot",
  "getSalesOrderGovernanceTimeline",
  "compareSalesOrderVersions",
  "bulkUpdateSalesOrders",
  "reserveSalesOrderLines",
  "createSalesReturnRequest",
  "listSalesOrderSavedViews",
  "saveSalesOrderView",
  "deleteSalesOrderSavedView",
])
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));

const declarations = fs.readFileSync(
  "services/api/src/sales/order-governance.d.ts",
  "utf8",
);
for (const symbol of [
  "getSalesOrderGovernanceDashboard",
  "assessSalesOrderReadiness",
  "captureSalesOrderGovernanceSnapshot",
  "reserveSalesOrderLines",
  "createSalesReturnRequest",
])
  assert.match(declarations, new RegExp(`export function ${symbol}`));

const migration = fs.readFileSync(
  "database/tenant/migrations/021_sales_order_governance.sql",
  "utf8",
);
for (const table of [
  "sales_order_governance_policies",
  "sales_order_saved_views",
  "sales_order_governance_snapshots",
  "sales_return_requests",
])
  assert.match(migration, new RegExp(`tenant\\.${table}`));
assert.match(migration, /FORCE ROW LEVEL SECURITY/);

const salesEngine = fs.readFileSync("services/api/src/sales/index.js", "utf8");
assert.match(
  salesEngine,
  /totals\?\.complete\s*\?\s*"fulfilled"/,
  "Completed fulfilment must use the database-supported fulfilled status.",
);
assert.doesNotMatch(
  salesEngine,
  /totals\?\.complete\s*\?\s*"completed"/,
  "The unsupported completed fulfilment status must not return.",
);

const actions = fs.readFileSync(
  "apps/web/src/app/api/sales/orders/[id]/actions/route.ts",
  "utf8",
);
assert.match(actions, /captureSalesOrderGovernanceSnapshot/);

const ordersPage = fs.readFileSync(
  "apps/web/src/app/(app)/sales/orders/page.tsx",
  "utf8",
);
assert.match(ordersPage, /getSalesOrderGovernanceDashboard/);

const detailPage = fs.readFileSync(
  "apps/web/src/app/(app)/sales/orders/[id]/page.tsx",
  "utf8",
);
assert.match(detailPage, /assessSalesOrderReadiness/);

const mobileParity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobileParity, /web: "\/sales\/orders"/);
assert.match(mobileParity, /web: "\/sales\/orders\/\[id\]"/);
assert.match(mobileParity, /web: "\/sales\/orders\/new"/);

console.log("Stage 5 Sales order governance contract verified.");
