import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const read = (f) =>
  fs.readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
test("stock module has migration, RLS, services and UI", () => {
  const m = read("database/tenant/migrations/044_stock_module.sql");
  assert.match(m, /stock_balances/);
  assert.match(m, /FORCE ROW LEVEL SECURITY/);
  assert.match(read("services/api/src/stock/index.js"), /INSUFFICIENT_STOCK/);
  assert.match(
    read("apps/web/src/app\/(app\)\/stock\/page.tsx"),
    /PERMISSIONS.stockView/,
  );
  assert.match(
    read("packages/shared-types/src/modules.js"),
    /key: "stock"[\s\S]*availability: "released"/,
  );
});
