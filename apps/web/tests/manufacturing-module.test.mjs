import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("manufacturing owns production and uses the Stock ledger", () => {
  const migration = read(
    "database/tenant/migrations/045_manufacturing_module.sql",
  );
  const service = read("services/api/src/manufacturing/index.js");
  const moduleCatalog = read("packages/shared-types/src/modules.js");

  for (const marker of [
    "manufacturing_boms",
    "manufacturing_routings",
    "manufacturing_work_orders",
    "manufacturing_work_order_operations",
    "manufacturing_production_postings",
    "manufacturing_cost_snapshots",
    "manufacturing_planning_runs",
    "FORCE ROW LEVEL SECURITY",
  ]) {
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /tenant\.stock_movements/);
  assert.match(service, /MATERIAL_SHORTAGE/);
  assert.match(service, /OVERPRODUCTION_BLOCKED/);
  assert.match(service, /OPERATIONS_INCOMPLETE/);
  assert.match(
    moduleCatalog,
    /key: "manufacturing"[\s\S]*availability: "released"/,
  );
});

test("manufacturing has permission-safe web routes and APIs", () => {
  const page = read("apps/web/src/app/(app)/manufacturing/page.tsx");
  const production = read(
    "apps/web/src/app/api/manufacturing/work-orders/[id]/production/route.ts",
  );
  assert.match(page, /PERMISSIONS\.manufacturingView/);
  assert.match(page, /<AccessDenied/);
  assert.match(production, /productionPostSchema/);
  assert.match(production, /tenantTransaction/);
});
