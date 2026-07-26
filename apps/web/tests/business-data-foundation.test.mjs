import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");

const tenantMigration = fs.readFileSync(
  path.join(
    root,
    "database/tenant/migrations/001_business_data_foundation.sql",
  ),
  "utf8",
);

const permissionsMigration = fs.readFileSync(
  path.join(
    root,
    "database/control-plane/migrations/003_business_data_permissions.sql",
  ),
  "utf8",
);

test("tenant migration includes the shared business masters", () => {
  for (const table of [
    "business_parties",
    "contacts",
    "addresses",
    "units_of_measure",
    "items",
    "tax_categories",
    "tax_rates",
    "warehouses",
    "warehouse_locations",
    "payment_terms",
    "price_lists",
    "fiscal_periods",
    "currencies",
    "exchange_rates",
  ]) {
    assert.match(
      tenantMigration,
      new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
    );
  }
});

test("every tenant table is protected by forced row-level security", () => {
  assert.match(tenantMigration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(tenantMigration, /FORCE ROW LEVEL SECURITY/);
  assert.match(tenantMigration, /tenant_organization_isolation/);
  assert.match(tenantMigration, /app\.current_organization_id/);
});

test("business data uses governed permissions and imports", () => {
  for (const permission of [
    "business_data.view",
    "parties.manage",
    "items.manage",
    "inventory_setup.manage",
    "finance_setup.manage",
    "business_data.import",
  ]) {
    assert.match(permissionsMigration, new RegExp(permission));
  }

  assert.match(tenantMigration, /master_data_import_jobs/);
  assert.match(tenantMigration, /master_data_external_ids/);
});

test("business APIs remain in the service boundary", () => {
  const service = fs.readFileSync(
    path.join(root, "services/api/src/index.js"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(root, "apps/web/src/app/api/business-data/[resource]/route.ts"),
    "utf8",
  );

  assert.match(service, /createBusinessDataRecord/);
  assert.match(service, /organization_id/);
  assert.match(route, /@vercentlabs\/api/);
  assert.match(route, /requirePermissionFromSession/);
  assert.match(route, /tenantTransaction/);
});
