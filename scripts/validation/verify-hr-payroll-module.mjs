import fs from "node:fs";

const required = [
  "database/control-plane/migrations/026_hr_payroll_module_release.sql",
  "database/tenant/migrations/051_hr_payroll_module.sql",
  "services/api/src/hr-payroll/index.js",
  "apps/web/src/app/(app)/hr-payroll/page.tsx",
  "apps/web/src/app/api/hr-payroll/dashboard/route.ts",
  "apps/web/src/app/api/hr-payroll/payroll-runs/[id]/actions/route.ts",
  "packages/permissions/src/hr-payroll.js",
  "packages/shared-types/src/hr-payroll.js",
  "packages/shared-sdk/src/hr-payroll.js",
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const migration = fs.readFileSync(
  "database/tenant/migrations/051_hr_payroll_module.sql",
  "utf8",
);
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
  if (!migration.includes(marker))
    throw new Error(`Migration missing ${marker}`);
}

const service = fs.readFileSync("services/api/src/hr-payroll/index.js", "utf8");
for (const marker of [
  "createEmployee",
  "createLeaveRequest",
  "reviewLeaveRequest",
  "createPayrollRun",
  "calculatePayrollRun",
  "transitionPayrollRun",
  "SELF_APPROVAL_BLOCKED",
]) {
  if (!service.includes(marker)) throw new Error(`Service missing ${marker}`);
}

console.log("HR & Payroll module static verification passed.");
