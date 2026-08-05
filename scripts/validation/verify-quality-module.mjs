import fs from "node:fs";

const required = [
  "database/control-plane/migrations/024_quality_module_release.sql",
  "database/tenant/migrations/049_quality_module.sql",
  "services/api/src/quality/index.js",
  "apps/web/src/app/(app)/quality/page.tsx",
  "apps/web/src/app/api/quality/dashboard/route.ts",
  "apps/web/src/app/api/quality/inspections/[id]/actions/route.ts",
  "packages/permissions/src/quality.js",
  "packages/shared-types/src/quality.js",
  "packages/shared-sdk/src/quality.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/049_quality_module.sql",
  "utf8",
);
for (const marker of [
  "quality_plans",
  "quality_inspection_points",
  "quality_inspections",
  "quality_inspection_results",
  "quality_holds",
  "quality_nonconformances",
  "quality_capa",
  "quality_supplier_records",
  "quality_audits",
  "FORCE ROW LEVEL SECURITY",
]) {
  if (!migration.includes(marker))
    throw new Error(`Migration missing ${marker}`);
}

const service = fs.readFileSync("services/api/src/quality/index.js", "utf8");
for (const marker of [
  "createQualityPlan",
  "createInspection",
  "completeInspection",
  "releaseInspection",
  "createNonconformance",
  "createCapa",
  "SELF_RELEASE_BLOCKED",
]) {
  if (!service.includes(marker)) throw new Error(`Service missing ${marker}`);
}

console.log("Quality module static verification passed.");
