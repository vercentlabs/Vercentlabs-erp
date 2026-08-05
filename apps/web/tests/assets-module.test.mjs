import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { getAssetsDashboard } from "../../../services/api/src/assets/index.js";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Assets covers lifecycle, maintenance and Accounting handoff", () => {
  const migration = read("database/tenant/migrations/047_assets_module.sql");
  const service = read("services/api/src/assets/index.js");
  const modules = read("packages/shared-types/src/modules.js");

  for (const marker of [
    "asset_categories",
    "asset_assignments",
    "asset_transfers",
    "asset_maintenance_plans",
    "asset_maintenance_orders",
    "asset_maintenance_parts",
    "asset_inspections",
    "asset_depreciation_schedules",
    "asset_depreciation_runs",
    "asset_disposals",
    "FORCE ROW LEVEL SECURITY",
  ]) {
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /capitalizeManagedAsset/);
  assert.match(service, /assignAsset/);
  assert.match(service, /createMaintenanceOrder/);
  assert.match(service, /disposeManagedAsset/);
  assert.match(service, /SELF_APPROVAL_BLOCKED/);
  assert.match(service, /ASSET_CHILD_TABLES/);
  assert.match(service, /asset\.company_id=\$2/);
  assert.match(service, /record\.company_id=\$2/);
  assert.match(service, /target === "asset_events" \? "occurred_at"/);
  assert.match(modules, /key: "assets"[\s\S]*availability: "released"/);
});

test("Assets web entry points are permission safe", () => {
  const page = read("apps/web/src/app/(app)/assets/page.tsx");
  const route = read(
    "apps/web/src/app/api/assets/assets/[id]/actions/route.ts",
  );
  assert.match(page, /PERMISSIONS\.assetsView/);
  assert.match(page, /<AccessDenied/);
  assert.match(route, /assetActionSchema/);
  assert.match(route, /tenantTransaction/);
});

test("organization owners retain Assets service access", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("maintenance_due"))
        return { rows: [{ maintenance_due: 0 }] };
      return {
        rows: [
          {
            total_assets: 0,
            assigned_assets: 0,
            assets_in_maintenance: 0,
            warranties_expiring: 0,
            total_net_book_value: "0",
          },
        ],
      };
    },
  };
  await assert.doesNotReject(() =>
    getAssetsDashboard(client, {
      organizationId: "organization-id",
      companyId: "company-id",
      userId: "user-id",
      permissions: [],
      roleSlugs: ["organization_owner"],
    }),
  );
  await assert.rejects(
    () =>
      getAssetsDashboard(client, {
        organizationId: "organization-id",
        companyId: "company-id",
        userId: "user-id",
        permissions: [],
        roleSlugs: ["employee"],
      }),
    /Missing permission: assets\.view/,
  );
});
