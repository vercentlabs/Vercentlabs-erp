import fs from "node:fs";

const required = [
  "database/control-plane/migrations/023_point_of_sale_module_release.sql",
  "database/tenant/migrations/048_point_of_sale_module.sql",
  "services/api/src/point-of-sale/index.js",
  "apps/web/src/app/(app)/point-of-sale/page.tsx",
  "apps/web/src/app/api/point-of-sale/dashboard/route.ts",
  "apps/web/src/app/api/point-of-sale/sales/complete/route.ts",
  "packages/permissions/src/point-of-sale.js",
  "packages/shared-types/src/point-of-sale.js",
  "packages/shared-sdk/src/point-of-sale.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/048_point_of_sale_module.sql",
  "utf8",
);
for (const marker of [
  "pos_stores",
  "pos_terminals",
  "pos_shifts",
  "pos_sales",
  "pos_sale_lines",
  "pos_payments",
  "pos_returns",
  "pos_cash_movements",
  "pos_reconciliations",
  "FORCE ROW LEVEL SECURITY",
]) {
  if (!migration.includes(marker))
    throw new Error(`Migration missing ${marker}`);
}

const service = fs.readFileSync(
  "services/api/src/point-of-sale/index.js",
  "utf8",
);
for (const marker of [
  "createStore",
  "createTerminal",
  "openShift",
  "completePointOfSale",
  "createPointOfSaleReturn",
  "closeShift",
  "tenant.stock_movements",
  "INSUFFICIENT_STOCK",
  "UNDERPAYMENT",
]) {
  if (!service.includes(marker)) throw new Error(`Service missing ${marker}`);
}

console.log("Point of Sale module static verification passed.");
