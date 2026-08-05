import fs from "node:fs";
const required = [
  "database/control-plane/migrations/019_stock_module_release.sql",
  "database/tenant/migrations/044_stock_module.sql",
  "services/api/src/stock/index.js",
  "apps/web/src/app/(app)/stock/page.tsx",
  "apps/web/src/app/api/stock/dashboard/route.ts",
  "packages/permissions/src/stock.js",
  "packages/shared-types/src/stock.js",
  "packages/shared-sdk/src/stock.js",
];
for (const f of required)
  if (!fs.existsSync(f)) throw new Error(`Missing ${f}`);
const migration = fs.readFileSync(required[1], "utf8");
for (const marker of [
  "stock_balances",
  "stock_movements",
  "stock_transfers",
  "stock_reservations",
  "stock_reorder_rules",
  "stock_valuation_layers",
  "FORCE ROW LEVEL SECURITY",
])
  if (!migration.includes(marker))
    throw new Error(`Stock migration missing ${marker}`);
console.log("Stock module static verification passed.");
