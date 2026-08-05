import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getHrPayrollDashboard,
  listHrPayrollResource,
} from "../../../services/api/src/hr-payroll/index.js";

const read = (file) =>
  fs.readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");

test("HR & Payroll covers employees, attendance, leave, compensation and payroll", () => {
  const migration = read(
    "database/tenant/migrations/051_hr_payroll_module.sql",
  );
  const service = read("services/api/src/hr-payroll/index.js");
  const modules = read("packages/shared-types/src/modules.js");

  for (const marker of [
    "hr_employees",
    "hr_departments",
    "hr_shifts",
    "hr_attendance",
    "hr_leave_types",
    "hr_leave_requests",
    "hr_employee_expenses",
    "hr_salary_components",
    "hr_salary_structures",
    "hr_employee_compensation",
    "hr_statutory_components",
    "hr_payroll_runs",
    "hr_payslips",
    "FORCE ROW LEVEL SECURITY",
  ]) {
    assert.match(migration, new RegExp(marker));
  }

  assert.match(service, /createEmployee/);
  assert.match(service, /createLeaveRequest/);
  assert.match(service, /reviewLeaveRequest/);
  assert.match(service, /createPayrollRun/);
  assert.match(service, /calculatePayrollRun/);
  assert.match(service, /transitionPayrollRun/);
  assert.match(service, /SELF_APPROVAL_BLOCKED/);
  assert.match(modules, /key: "hr-payroll"[\s\S]*availability: "released"/);
});

test("HR & Payroll web entry points are permission safe", () => {
  const page = read("apps/web/src/app/(app)/hr-payroll/page.tsx");
  const route = read(
    "apps/web/src/app/api/hr-payroll/payroll-runs/[id]/actions/route.ts",
  );
  assert.match(page, /PERMISSIONS\.hrPayrollView/);
  assert.match(page, /<AccessDenied/);
  assert.match(route, /payrollActionSchema/);
  assert.match(route, /tenantTransaction/);
});

test("HR & Payroll honors owner access and active-company scoping", async () => {
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

  await getHrPayrollDashboard(client, owner);
  assert.equal(queries.length, 2);

  queries.length = 0;
  await listHrPayrollResource(client, owner, "employees");
  assert.match(
    queries[0].text,
    /record\.organization_id=\$1 AND record\.company_id=\$2/,
  );
  assert.deepEqual(queries[0].values.slice(0, 2), [
    "organization-1",
    "company-1",
  ]);

  await assert.rejects(
    getHrPayrollDashboard(client, { ...owner, roleSlugs: ["employee"] }),
    /Missing permission: hr_payroll\.view/,
  );
});
