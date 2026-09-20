// Pickers for the HR screens: small lists, each behind the module view permission.
import { hasAny, needAny, ownEmployee, qx, seq } from "./common.js";

const NAME = `trim(e.first_name || ' ' || e.last_name)`;
export async function listHrOptions(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const p = [c.organizationId, c.companyId];
  // candidates and applications are recruiting data: only for people who may see it
  const people = hasAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const none = async () => ({ rows: [] });
  const [employees, departments, designations, branches, documentTypes, openOpenings, candidatesList, offerApplications, interviewApplications, leaveTypes, shifts, holidayCalendars, salaryStructures, payrollPeriods, salaryComponents, expenseCategories, skills, goals, reviewCycles, courses, trainingSessions] = await seq([
    () => qx(client, `SELECT e.id, e.employee_number AS code, ${NAME} AS name FROM tenant.hr_employees e WHERE e.organization_id=$1 AND e.company_id=$2 AND e.status IN ('draft','active','on_leave','suspended','on_notice') ORDER BY e.employee_number LIMIT 2000`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_departments WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_designations WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_document_types WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY name`, p),
    () => !people ? none() : qx(client, `SELECT id, opening_number AS code, title AS name FROM tenant.hr_job_openings WHERE organization_id=$1 AND company_id=$2 AND status='open' ORDER BY opening_number`, p),
    () => !people ? none() : qx(client, `SELECT id, candidate_number AS code, trim(first_name || ' ' || last_name) AS name FROM tenant.hr_candidates WHERE organization_id=$1 AND company_id=$2 AND status IN ('active','rejected') ORDER BY candidate_number LIMIT 2000`, p),
    () => !people ? none() : qx(client, `SELECT a.id, s.candidate_number AS code, trim(s.first_name || ' ' || s.last_name) || ' — ' || o.title AS name FROM tenant.hr_applications a JOIN tenant.hr_candidates s ON s.id=a.candidate_id JOIN tenant.hr_job_openings o ON o.id=a.opening_id WHERE a.organization_id=$1 AND a.company_id=$2 AND a.stage='offer' ORDER BY a.created_at DESC LIMIT 500`, p),
    () => !people ? none() : qx(client, `SELECT a.id, s.candidate_number AS code, trim(s.first_name || ' ' || s.last_name) || ' — ' || o.title AS name FROM tenant.hr_applications a JOIN tenant.hr_candidates s ON s.id=a.candidate_id JOIN tenant.hr_job_openings o ON o.id=a.opening_id WHERE a.organization_id=$1 AND a.company_id=$2 AND a.stage IN ('screening','interview') ORDER BY a.created_at DESC LIMIT 500`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_shifts WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_holiday_calendars WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => (!hasAny(c, ["hr_payroll.compensation.manage", "hr_payroll.sensitive.view"]) ? none() : qx(client, `SELECT id, code || ' v' || version AS code, name FROM tenant.hr_salary_structures WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY code`, p)),
    () => qx(client, `SELECT id, period_code AS code, period_code || ' (' || status || ')' AS name FROM tenant.hr_payroll_periods WHERE organization_id=$1 AND company_id=$2 AND status <> 'closed' ORDER BY period_start DESC LIMIT 60`, p),
    () => (!hasAny(c, ["hr_payroll.compensation.manage", "hr_payroll.sensitive.view"]) ? none() : qx(client, `SELECT id, code, name FROM tenant.hr_salary_components WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY component_type, code`, p)),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_expense_categories WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_skills WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY name LIMIT 500`, p),
    () => qx(client, `SELECT id, title AS code, title AS name FROM tenant.hr_goals WHERE organization_id=$1 AND company_id=$2 AND status='active' ORDER BY due_date LIMIT 500`, p),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_review_cycles WHERE organization_id=$1 AND company_id=$2 AND status='open' ORDER BY period_start DESC LIMIT 50`, p),
    () => qx(client, `SELECT id, code, title AS name FROM tenant.hr_courses WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY title LIMIT 500`, p),
    () => qx(client, `SELECT s.id, s.session_code AS code, co.title || ' — ' || s.session_code AS name FROM tenant.hr_training_sessions s JOIN tenant.hr_courses co ON co.id=s.course_id WHERE s.organization_id=$1 AND s.company_id=$2 AND s.status='scheduled' ORDER BY s.starts_at LIMIT 200`, p),
  ]);
  return { employees: employees.rows, departments: departments.rows, designations: designations.rows, branches: branches.rows, documentTypes: documentTypes.rows, openOpenings: openOpenings.rows, candidatesList: candidatesList.rows, offerApplications: offerApplications.rows, interviewApplications: interviewApplications.rows, leaveTypes: leaveTypes.rows, shifts: shifts.rows, holidayCalendars: holidayCalendars.rows, salaryStructures: salaryStructures.rows, payrollPeriods: payrollPeriods.rows, salaryComponents: salaryComponents.rows, expenseCategories: expenseCategories.rows, skills: skills.rows, goals: goals.rows, reviewCycles: reviewCycles.rows, courses: courses.rows, trainingSessions: trainingSessions.rows };
}

// What an ordinary employee needs to fill in their own forms (leave types, and -- for a reporting
// manager, who has no access to the full employee picker -- their own direct reports, so they can
// set a goal or rate a skill for someone on their team), with no HR permission.
export async function listSelfOptions(client, c) {
  const own = await ownEmployee(client, c);
  const [leaveTypes, skills, trainingSessions, reports] = await seq([
    () => qx(client, `SELECT id, code, name FROM tenant.hr_leave_types WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY code`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT id, code, name FROM tenant.hr_skills WHERE organization_id=$1 AND company_id=$2 AND active ORDER BY name LIMIT 500`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT s.id, s.session_code AS code, co.title || ' — ' || s.session_code AS name FROM tenant.hr_training_sessions s JOIN tenant.hr_courses co ON co.id=s.course_id WHERE s.organization_id=$1 AND s.company_id=$2 AND s.status='scheduled' ORDER BY s.starts_at LIMIT 200`, [c.organizationId, c.companyId]),
    () => (!own ? Promise.resolve({ rows: [] }) : qx(client, `SELECT id, employee_number AS code, ${NAME} AS name FROM tenant.hr_employees e WHERE e.organization_id=$1 AND e.company_id=$2 AND e.manager_employee_id=$3 AND e.status IN ('active','on_leave','on_notice') ORDER BY e.employee_number`, [c.organizationId, c.companyId, own.id])),
  ]);
  return { leaveTypes: leaveTypes.rows, skills: skills.rows, trainingSessions: trainingSessions.rows, employees: reports.rows };
}
