import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getPointOfSaleDashboard,
  listPointOfSaleResource,
} from "../../../services/api/src/point-of-sale/index.js";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Point of Sale integrates retail sales with Stock and cash control", () => {
  const migration = read(
    "database/tenant/migrations/048_point_of_sale_module.sql",
  );
  const service = read("services/api/src/point-of-sale/index.js");
  const modules = read("packages/shared-types/src/modules.js");

  for (const marker of [
    "pos_stores",
    "pos_terminals",
    "pos_shifts",
    "pos_sales",
    "pos_sale_lines",
    "pos_payments",
    "pos_returns",
    "pos_return_lines",
    "pos_cash_movements",
    "pos_reconciliations",
    "FORCE ROW LEVEL SECURITY",
  ]) {
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /tenant\.stock_movements/);
  assert.match(service, /INSUFFICIENT_STOCK/);
  assert.match(service, /UNDERPAYMENT/);
  assert.match(service, /completePointOfSale/);
  assert.match(service, /closeShift/);
  assert.match(service, /sale\.status='completed'/);
  assert.match(service, /shift\.status='open'/);
  assert.match(modules, /key: "point-of-sale"[\s\S]*availability: "released"/);
});

test("Point of Sale web entry points are permission safe", () => {
  const page = read("apps/web/src/app/(app)/point-of-sale/page.tsx");
  const route = read(
    "apps/web/src/app/api/point-of-sale/sales/complete/route.ts",
  );
  assert.match(page, /PERMISSIONS\.posView/);
  assert.match(page, /<AccessDenied/);
  assert.match(route, /posSaleCompleteSchema/);
  assert.match(route, /tenantTransaction/);
});

test("Point of Sale honors owner access and active-company scoping", async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [{}] };
    },
  };
  const owner = {
    organizationId: "organization-1",
    companyId: "company-1",
    userId: "user-1",
    permissions: [],
    roleSlugs: ["organization_owner"],
  };

  await getPointOfSaleDashboard(client, owner);
  assert.equal(queries.length, 2);

  queries.length = 0;
  await listPointOfSaleResource(client, owner, "sales");
  assert.match(queries[0].text, /organization_id=\$1 AND company_id=\$2/);
  assert.deepEqual(queries[0].values.slice(0, 2), [
    "organization-1",
    "company-1",
  ]);

  await assert.rejects(
    getPointOfSaleDashboard(client, {
      ...owner,
      roleSlugs: ["employee"],
    }),
    /Missing permission: pos\.view/,
  );
});
