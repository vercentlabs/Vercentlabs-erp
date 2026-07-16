import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "../..");

const requiredPaths = [
  "database/control-plane/migrations/003_business_data_permissions.sql",
  "database/tenant/migrations/001_business_data_foundation.sql",
  "services/api/package.json",
  "services/api/src/index.js",
  "services/api/src/index.d.ts",
  "packages/database/package.json",
  "packages/database/src/index.js",
  "packages/permissions/package.json",
  "packages/permissions/src/index.js",
  "packages/shared-types/package.json",
  "packages/shared-types/src/index.d.ts",
  "packages/shared-sdk/package.json",
  "packages/shared-sdk/src/index.js",
  "apps/web/scripts/migrate-tenant.mjs",
  "apps/web/scripts/verify-tenant-database.mjs",
  "apps/web/src/lib/business-data.ts",
  "apps/web/src/lib/business-data-validation.ts",
  "apps/web/src/components/business-data-manager.tsx",
  "apps/web/src/app/(app)/master-data/page.tsx",
  "apps/web/src/app/(app)/master-data/[resource]/page.tsx",
  "apps/web/src/app/api/business-data/[resource]/route.ts",
  "apps/web/src/app/api/business-data/[resource]/[id]/route.ts",
  "apps/web/src/app/api/business-data/[resource]/export/route.ts",
  "apps/web/src/app/api/business-data/[resource]/import/route.ts",
  "docs/architecture/business-data-foundation.md",
  "docs/database/tenant-isolation.md",
];

const missing = requiredPaths.filter(
  (relative) => !fs.existsSync(path.join(root, relative)),
);

if (missing.length) {
  console.error("Missing Business Data Foundation paths:");
  missing.forEach((entry) => console.error(` - ${entry}`));
  process.exit(1);
}

const migration = fs.readFileSync(
  path.join(
    root,
    "database/tenant/migrations/001_business_data_foundation.sql",
  ),
  "utf8",
);

for (const table of [
  "business_parties",
  "contacts",
  "addresses",
  "items",
  "units_of_measure",
  "tax_rates",
  "warehouses",
  "fiscal_periods",
  "currencies",
  "master_data_import_jobs",
]) {
  if (!migration.includes(`tenant.${table}`)) {
    throw new Error(`Tenant migration is missing ${table}.`);
  }
}

for (const marker of [
  "ENABLE ROW LEVEL SECURITY",
  "FORCE ROW LEVEL SECURITY",
  "tenant_organization_isolation",
  "current_organization_id",
]) {
  if (!migration.includes(marker)) {
    throw new Error(`Tenant isolation is missing ${marker}.`);
  }
}

const apiSource = fs.readFileSync(
  path.join(root, "services/api/src/index.js"),
  "utf8",
);

for (const marker of [
  "listBusinessDataRecords",
  "createBusinessDataRecord",
  "updateBusinessDataRecord",
  "archiveBusinessDataRecord",
  "getBusinessDataOptions",
]) {
  if (!apiSource.includes(marker)) {
    throw new Error(`Business service is missing ${marker}.`);
  }
}

const appShell = fs.readFileSync(
  path.join(root, "apps/web/src/components/app-shell.tsx"),
  "utf8",
);

if (!appShell.includes('href: "/master-data"')) {
  throw new Error("Master data is missing from workspace navigation.");
}

const authorization = fs.readFileSync(
  path.join(root, "apps/web/src/lib/authorization.ts"),
  "utf8",
);

for (const permission of [
  "business_data.view",
  "parties.manage",
  "items.manage",
  "inventory_setup.manage",
  "finance_setup.manage",
  "business_data.import",
]) {
  if (!authorization.includes(permission)) {
    throw new Error(`Authorization is missing ${permission}.`);
  }
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

for (const command of [
  "db:migrate:tenant",
  "db:verify:tenant",
  "verify:business-data",
]) {
  if (!packageJson.scripts?.[command]) {
    throw new Error(`Root package is missing ${command}.`);
  }
}

for (const file of requiredPaths) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/Phase\s*[0-9]/i.test(source)) {
    throw new Error(`Temporary milestone naming remains in ${file}.`);
  }
}

console.log(
  `Business Data Foundation verified across ${requiredPaths.length} permanent paths.`,
);
