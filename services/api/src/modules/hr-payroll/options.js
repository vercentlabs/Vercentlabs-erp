// Pickers for the HR screens: small lists, each behind the module view permission.
import { hasAny, needAny, ownEmployee, qx, seq } from "./common.js";

const NAME = `trim(e.first_name || ' ' || e.last_name)`;
export async function listHrOptions(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const p = [c.organizationId, c.companyId];
  const none = async () => ({ rows: [] });
  const [employees, departments, designations, branches, leaveTypes, shifts, holidayCalendars, salaryStructures, payrollPeriods, salaryComponents] = await seq([
    () => qx(client, `SELECT e.id, e.employee_number AS code, ${NAME} AS name FROM tenant.hr_employees e WHERE e.organization_id=$1 AND e.company_id=$2 AND e.status IN ('draft','active','on_leave','suspended','on_notice') ORDER BY e.employee_number LIMIT 2000`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_departments WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_designations WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_shifts WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_holiday_calendars WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => (!hasAny(c, ["hr_payroll.compensation.manage", "hr_payroll.sensitive.view"]) ? none() : qx(client, `SELECT id, code || ' v' || version AS code, name FROM tenant.hr_salary_structures WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY code`, p)),
    () => qx(client, `SELECT id, period_code AS code, period_code || ' (' || status || ')' AS name FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND status <> 'closed' ORDER BY period_start DESC LIMIT 60`, p),
    () => (!hasAny(c, ["hr_payroll.compensation.manage", "hr_payroll.sensitive.view"]) ? none() : qx(client, `SELECT id, code, name FROM tenant.hr_salary_components WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY component_type, code`, p)),
  ]);
  return { employees: employees.rows, departments: departments.rows, designations: designations.rows, branches: branches.rows, leaveTypes: leaveTypes.rows, shifts: shifts.rows, holidayCalendars: holidayCalendars.rows, salaryStructures: salaryStructures.rows, payrollPeriods: payrollPeriods.rows, salaryComponents: salaryComponents.rows };
}

// What an ordinary employee needs to fill in their own forms (leave types, and -- for a reporting
// manager, who has no access to the full employee picker -- their own direct reports), with no HR
// permission.
export async function listSelfOptions(client, c) {
  const own = await ownEmployee(client, c);
  const [leaveTypes, reports] = await seq([
    () => qx(client, `SELECT id, code, name FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, [c.organizationId, c.companyId]),
    () => (!own ? Promise.resolve({ rows: [] }) : qx(client, `SELECT id, employee_number AS code, ${NAME} AS name FROM tenant.hr_employees e WHERE e.organization_id=$1 AND e.company_id=$2 AND e.manager_employee_id=$3 AND e.status IN ('active','on_leave','on_notice') ORDER BY e.employee_number`, [c.organizationId, c.companyId, own.id])),
  ]);
  return { leaveTypes: leaveTypes.rows, employees: reports.rows };
}
