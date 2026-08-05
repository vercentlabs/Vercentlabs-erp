import fs from "node:fs";

const required = [
  "database/control-plane/migrations/021_projects_module_release.sql",
  "database/tenant/migrations/046_projects_module.sql",
  "services/api/src/projects/index.js",
  "apps/web/src/app/(app)/projects/page.tsx",
  "apps/web/src/app/api/projects/dashboard/route.ts",
  "apps/web/src/app/api/projects/projects/[id]/profitability/route.ts",
  "packages/permissions/src/projects.js",
  "packages/shared-types/src/projects.js",
  "packages/shared-sdk/src/projects.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/046_projects_module.sql",
  "utf8",
);
for (const marker of [
  "project_milestones",
  "project_tasks",
  "project_time_entries",
  "project_expenses",
  "project_budgets",
  "project_billing_milestones",
  "project_procurement_links",
  "project_profitability_snapshots",
  "FORCE ROW LEVEL SECURITY",
]) {
  if (!migration.includes(marker))
    throw new Error(`Migration missing ${marker}`);
}

const service = fs.readFileSync("services/api/src/projects/index.js", "utf8");
for (const marker of [
  "createProject",
  "createProjectTask",
  "createTimeEntry",
  "transitionProject",
  "approveTimeEntry",
  "getProjectProfitability",
  "SELF_APPROVAL_BLOCKED",
  "INCOMPLETE_TASKS",
]) {
  if (!service.includes(marker)) throw new Error(`Service missing ${marker}`);
}

console.log("Projects module static verification passed.");
