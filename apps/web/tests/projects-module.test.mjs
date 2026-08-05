import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { getProjectsDashboard } from "../../../services/api/src/projects/index.js";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("Projects covers delivery and governed financial links", () => {
  const migration = read("database/tenant/migrations/046_projects_module.sql");
  const service = read("services/api/src/projects/index.js");
  const modules = read("packages/shared-types/src/modules.js");

  for (const marker of [
    "project_milestones",
    "project_tasks",
    "project_task_dependencies",
    "project_members",
    "project_time_entries",
    "project_expenses",
    "project_budgets",
    "project_billing_milestones",
    "project_procurement_links",
    "project_profitability_snapshots",
    "FORCE ROW LEVEL SECURITY",
  ]) {
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /getProjectProfitability/);
  assert.match(service, /SELF_APPROVAL_BLOCKED/);
  assert.match(service, /INCOMPLETE_TASKS/);
  assert.match(service, /PROJECT_CHILD_TABLES/);
  assert.match(service, /project\.company_id=\$2/);
  assert.match(service, /record\.company_id=\$2/);
  assert.match(service, /task\.status NOT IN/);
  assert.match(service, /task\.planned_end_date < current_date/);
  assert.match(service, /sum\(task\.estimated_hours\)/);
  assert.match(modules, /key: "projects"[\s\S]*availability: "released"/);
});

test("Projects web entry points are permission safe", () => {
  const page = read("apps/web/src/app/(app)/projects/page.tsx");
  const action = read(
    "apps/web/src/app/api/projects/projects/[id]/actions/route.ts",
  );
  assert.match(page, /PERMISSIONS\.projectsView/);
  assert.match(page, /<AccessDenied/);
  assert.match(action, /projectActionSchema/);
  assert.match(action, /tenantTransaction/);
});

test("organization owners retain Projects service access", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.project_tasks")) {
        return { rows: [{ overdue_tasks: 0, remaining_estimated_hours: "0" }] };
      }
      return {
        rows: [
          {
            total_projects: 0,
            active_projects: 0,
            overdue_projects: 0,
            contracted_revenue: "0",
            approved_budget: "0",
          },
        ],
      };
    },
  };
  await assert.doesNotReject(() =>
    getProjectsDashboard(client, {
      organizationId: "organization-id",
      companyId: "company-id",
      userId: "user-id",
      permissions: [],
      roleSlugs: ["organization_owner"],
    }),
  );
  await assert.rejects(
    () =>
      getProjectsDashboard(client, {
        organizationId: "organization-id",
        companyId: "company-id",
        userId: "user-id",
        permissions: [],
        roleSlugs: ["employee"],
      }),
    /Missing permission: projects\.view/,
  );
});
