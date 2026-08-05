import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getQualityDashboard,
  listQualityResource,
} from "../../../services/api/src/quality/index.js";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Quality covers plans, inspections, holds, non-conformance and CAPA", () => {
  const migration = read("database/tenant/migrations/049_quality_module.sql");
  const service = read("services/api/src/quality/index.js");
  const modules = read("packages/shared-types/src/modules.js");

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
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /createQualityPlan/);
  assert.match(service, /createInspection/);
  assert.match(service, /completeInspection/);
  assert.match(service, /releaseInspection/);
  assert.match(service, /createNonconformance/);
  assert.match(service, /createCapa/);
  assert.match(service, /SELF_RELEASE_BLOCKED/);
  assert.match(modules, /key: "quality"[\s\S]*availability: "released"/);
});

test("Quality web entry points are permission safe", () => {
  const page = read("apps/web/src/app/(app)/quality/page.tsx");
  const route = read(
    "apps/web/src/app/api/quality/inspections/[id]/actions/route.ts",
  );
  assert.match(page, /PERMISSIONS\.qualityView/);
  assert.match(page, /<AccessDenied/);
  assert.match(route, /qualityInspectionActionSchema/);
  assert.match(route, /tenantTransaction/);
});

test("Quality honors owner access and active-company scoping", async () => {
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

  await getQualityDashboard(client, owner);
  assert.equal(queries.length, 2);

  queries.length = 0;
  await listQualityResource(client, owner, "plans");
  assert.match(
    queries[0].text,
    /record\.organization_id=\$1 AND record\.company_id=\$2/,
  );
  assert.deepEqual(queries[0].values.slice(0, 2), [
    "organization-1",
    "company-1",
  ]);

  queries.length = 0;
  await listQualityResource(client, owner, "inspection-points");
  assert.match(queries[0].text, /JOIN tenant\.quality_plans parent/);
  assert.match(queries[0].text, /parent\.company_id=\$2/);

  await assert.rejects(
    getQualityDashboard(client, { ...owner, roleSlugs: ["employee"] }),
    /Missing permission: quality\.view/,
  );
});
