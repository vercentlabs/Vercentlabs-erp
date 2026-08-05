export const HR_PAYROLL_RESOURCE_KEYS = Object.freeze([
  "employees",
  "departments",
  "designations",
  "shifts",
  "attendance",
  "leave-types",
  "leave-requests",
  "expenses",
  "salary-structures",
  "payroll-runs",
  "payslips",
  "statutory-components",
]);

export const EMPLOYEE_STATUSES = Object.freeze([
  "draft",
  "active",
  "on_leave",
  "suspended",
  "separated",
]);

export const LEAVE_REQUEST_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "approved",
  "rejected",
  "cancelled",
]);

export const PAYROLL_RUN_STATUSES = Object.freeze([
  "draft",
  "calculated",
  "pending_approval",
  "approved",
  "posted",
  "cancelled",
]);
