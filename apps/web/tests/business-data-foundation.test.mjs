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

test("business data import is a real bounded file action", () => {
  const manager = fs.readFileSync(
    path.join(root, "apps/web/src/components/business-data-manager.tsx"),
    "utf8",
  );
  const exportRoute = fs.readFileSync(
    path.join(
      root,
      "apps/web/src/app/api/business-data/[resource]/export/route.ts",
    ),
    "utf8",
  );

  assert.doesNotMatch(manager, /Import API ready/);
  assert.match(manager, /\.csv,\.json,text\/csv,application\/json/);
  assert.match(manager, /parseCsvRows/);
  assert.match(manager, /Import up to 100 rows at a time/);
  assert.match(manager, /\/api\/business-data\/\$\{definition\.key\}\/import/);
  assert.match(manager, /timeoutMs: 60_000/);
  assert.match(
    exportRoute,
    /definition\[resource\]\.fields|businessDataDefinitions\[resource\]\.fields/,
  );
});

test("CRM accounts and contacts use the Leads list presentation", () => {
  const manager = fs.readFileSync(
    path.join(root, "apps/web/src/components/business-data-manager.tsx"),
    "utf8",
  );
  const accounts = fs.readFileSync(
    path.join(root, "apps/web/src/app/(app)/crm/accounts/page.tsx"),
    "utf8",
  );
  const contacts = fs.readFileSync(
    path.join(root, "apps/web/src/app/(app)/crm/contacts/page.tsx"),
    "utf8",
  );

  assert.match(accounts, /presentation="crm"/);
  assert.match(contacts, /presentation="crm"/);
  for (const className of [
    "crm-resource-layout",
    "crm-list-panel",
    "crm-toolbar",
    "crm-toolbar-actions",
    "crm-filter-row",
    "table-scroll",
    "data-table",
    "row-actions",
    "crm-editor",
    "form-stack",
  ]) {
    assert.match(manager, new RegExp(className), className);
  }
  assert.match(manager, /Create the first.*to begin this workflow/);
  assert.match(manager, /Import CSV/);
});
