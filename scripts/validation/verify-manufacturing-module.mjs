import fs from "node:fs";

const required = [
  "database/control-plane/migrations/020_manufacturing_module_release.sql",
  "database/tenant/migrations/044_stock_module.sql",
  "database/tenant/migrations/045_manufacturing_module.sql",
  "services/api/src/manufacturing/index.js",
  "apps/web/src/app/(app)/manufacturing/page.tsx",
  "apps/web/src/app/api/manufacturing/dashboard/route.ts",
  "apps/web/src/app/api/manufacturing/work-orders/[id]/production/route.ts",
  "packages/permissions/src/manufacturing.js",
  "packages/shared-types/src/manufacturing.js",
  "packages/shared-sdk/src/manufacturing.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/045_manufacturing_module.sql",
  "utf8",
);
for (const marker of [
  "manufacturing_boms",
  "manufacturing_bom_components",
  "manufacturing_routings",
  "manufacturing_routing_operations",
  "manufacturing_work_orders",
  "manufacturing_work_order_materials",
  "manufacturing_work_order_operations",
  "manufacturing_production_postings",
  "manufacturing_cost_snapshots",
  "manufacturing_planning_runs",
  "manufacturing_material_requirements",
  "FORCE ROW LEVEL SECURITY",
]) {
  if (!migration.includes(marker)) {
    throw new Error(`Manufacturing migration missing ${marker}`);
  }
}

const service = fs.readFileSync(
  "services/api/src/manufacturing/index.js",
  "utf8",
);
for (const marker of [
  "createBillOfMaterial",
  "activateBillOfMaterial",
  "createWorkOrder",
  "releaseWorkOrder",
  "startWorkOrder",
  "postProduction",
  "tenant.stock_movements",
  "MATERIAL_SHORTAGE",
  "OVERPRODUCTION_BLOCKED",
  "OPERATIONS_INCOMPLETE",
]) {
  if (!service.includes(marker)) {
    throw new Error(`Manufacturing service missing ${marker}`);
  }
}

console.log("Manufacturing module static verification passed.");
