import type { SessionContext } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";

const RESOURCE_PERMISSIONS: Record<string, readonly string[]> = {
  employees: [PERMISSIONS.hrPayrollEmployeeView, PERMISSIONS.hrPayrollEmployeeManage],
  departments: [PERMISSIONS.hrPayrollView],
  designations: [PERMISSIONS.hrPayrollView],
  shifts: [PERMISSIONS.hrPayrollView, PERMISSIONS.hrPayrollShiftManage],
  attendance: [PERMISSIONS.hrPayrollView, PERMISSIONS.hrPayrollAttendanceManage],
  "leave-types": [PERMISSIONS.hrPayrollView, PERMISSIONS.hrPayrollLeaveManage, PERMISSIONS.hrPayrollLeaveApprove],
  "leave-requests": [PERMISSIONS.hrPayrollView, PERMISSIONS.hrPayrollLeaveManage, PERMISSIONS.hrPayrollLeaveApprove],
  expenses: [PERMISSIONS.hrPayrollView, PERMISSIONS.hrPayrollExpenseManage, PERMISSIONS.hrPayrollExpenseApprove],
  "salary-structures": [PERMISSIONS.hrPayrollSensitiveView, PERMISSIONS.hrPayrollCompensationManage],
  "payroll-runs": [PERMISSIONS.hrPayrollSensitiveView, PERMISSIONS.hrPayrollPrepare, PERMISSIONS.hrPayrollApprove, PERMISSIONS.hrPayrollPost],
  payslips: [PERMISSIONS.hrPayrollPayslipView],
  "statutory-components": [PERMISSIONS.hrPayrollSensitiveView, PERMISSIONS.hrPayrollStatutoryManage],
};

export function canReadHrPayrollResource(session: SessionContext, resource: string) {
  if (!hasPermission(session, PERMISSIONS.hrPayrollView)) return false;
  const permissions = RESOURCE_PERMISSIONS[resource] || [PERMISSIONS.hrPayrollView];
  return permissions.some((permission) => hasPermission(session, permission));
}
