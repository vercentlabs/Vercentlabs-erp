import fs from "node:fs";

const required = [
  "database/control-plane/migrations/022_assets_module_release.sql",
  "database/tenant/migrations/047_assets_module.sql",
  "services/api/src/assets/index.js",
  "apps/web/src/app/(app)/assets/page.tsx",
  "apps/web/src/app/api/assets/dashboard/route.ts",
  "apps/web/src/app/api/assets/assets/[id]/actions/route.ts",
  "packages/permissions/src/assets.js",
  "packages/shared-types/src/assets.js",
  "packages/shared-sdk/src/assets.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/047_assets_module.sql",
  "utf8",
);
for (const marker of [
  "asset_categories",
  "asset_assignments",
  "asset_transfers",
  "asset_maintenance_plans",
  "asset_maintenance_orders",
  "asset_inspections",
  "asset_depreciation_schedules",
  "asset_depreciation_runs",
  "asset_disposals",
  "FORCE ROW LEVEL SECURITY",
]) {
  if (!migration.includes(marker))
    throw new Error(`Migration missing ${marker}`);
}

const service = fs.readFileSync("services/api/src/assets/index.js", "utf8");
for (const marker of [
  "createManagedAssetCategory",
  "createManagedAsset",
  "capitalizeManagedAsset",
  "assignAsset",
  "createMaintenanceOrder",
  "completeMaintenanceOrder",
  "disposeManagedAsset",
  "SELF_APPROVAL_BLOCKED",
]) {
  if (!service.includes(marker)) throw new Error(`Service missing ${marker}`);
}

console.log("Assets module static verification passed.");
