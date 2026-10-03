import {
  getHrSettings,
  getMyProfile,
  getOrgChart,
  getEmployee,
  getWorkforceDashboard,
  listDepartments,
  listDesignations,
  listShifts,
  listShiftAssignments,
  listHolidayCalendars,
  listHolidays,
  listAttendance,
  getMyPunchState,
  getAttendanceSummary,
  listLeaveTypes,
  listLeavePolicies,
  listLeaveBalances,
  getLeaveLedger,
  listLeaveRequests,
  getLeaveCalendar,
  getLeaveDashboard,
  listSelfOptions,
  listSalaryComponents,
  listSalaryStructures,
  getSalaryStructure,
  previewSalaryStructure,
  listCompensation,
  getMyCompensation,
  listPayrollPeriods,
  listPayrollRuns,
  getPayrollRun,
  listPayslips,
  getPayslip,
  listMyPayslips,
  listPayrollExceptions,
  verifyPayrollDeterminism,
  getPayrollDashboard,
  listEmployees,
  listHrOptions,
  listLifecycleTasks,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { hrRead } from "@/features/hr/shared/route-helpers";

// One read endpoint per HR screen. Each is gated by hr_payroll.view (module-wide) and the domain
// function re-checks its OWN permission; sensitive employee fields are stripped server-side. The
// "me" views are employee self-service: no HR permission, scoped to the caller's own record.
const SELF_SERVICE = new Set([
  "me",
  "me-tasks",
  "me-options",
  "my-attendance",
  "punch-state",
  "my-summary",
  "my-leave-balances",
  "leave-calendar",
  "my-payslips",
  "payslip",
  "my-compensation",
]);
// these list views serve HR (no scope), the reporting manager (scope=team/toReview) and the employee (scope=mine)
const SCOPED = new Set(["leave-requests"]);

export async function GET(
  request: Request,
  ctx: { params: Promise<{ kind: string }> },
) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return hrRead(
    request,
    async (client, context) => {
      switch (kind) {
        case "options":
          return { options: await listHrOptions(client, context) };
        case "settings":
          return { settings: await getHrSettings(client, context) };
        case "departments":
          return { rows: await listDepartments(client, context) };
        case "designations":
          return { rows: await listDesignations(client, context) };
        case "employees":
          return {
            rows: await listEmployees(client, context, {
              status: get("status"),
              departmentId: get("departmentId"),
              employmentType: get("employmentType"),
              managerId: get("managerId"),
            }),
          };
        case "employee":
          return {
            employee: await getEmployee(client, context, get("id") ?? ""),
          };
        case "org-chart":
          return { rows: await getOrgChart(client, context) };
        case "tasks":
          return {
            rows: await listLifecycleTasks(client, context, {
              employeeId: get("employeeId"),
              kind: get("kind"),
              status: get("status"),
            }),
          };
        case "dashboard":
          return { dashboard: await getWorkforceDashboard(client, context) };
        case "me":
          return { profile: await getMyProfile(client, context) };
        case "me-tasks":
          return {
            rows: await listLifecycleTasks(client, context, {
              status: get("status"),
            }),
          };
        case "me-options":
          return { options: await listSelfOptions(client, context) };
        case "shifts":
          return { rows: await listShifts(client, context) };
        case "shift-assignments":
          return {
            rows: await listShiftAssignments(client, context, {
              employeeId: get("employeeId"),
            }),
          };
        case "holiday-calendars":
          return { rows: await listHolidayCalendars(client, context) };
        case "holidays":
          return {
            rows: await listHolidays(client, context, {
              calendarId: get("calendarId"),
              year: get("year"),
            }),
          };
        case "attendance":
          return {
            rows: await listAttendance(client, context, {
              from: get("from"),
              to: get("to"),
              employeeId: get("employeeId"),
              status: get("status"),
              flag: get("flag"),
            }),
          };
        case "my-attendance":
          return {
            rows: await listAttendance(client, context, {
              mine: true,
              from: get("from"),
              to: get("to"),
            }),
          };
        case "punch-state":
          return { state: await getMyPunchState(client, context) };
        case "attendance-summary":
          return {
            summary: await getAttendanceSummary(client, context, {
              employeeId: get("employeeId"),
              from: get("from"),
              to: get("to"),
            }),
          };
        case "my-summary":
          return {
            summary: await getAttendanceSummary(client, context, {
              from: get("from"),
              to: get("to"),
            }),
          };
        case "leave-types":
          return { rows: await listLeaveTypes(client, context) };
        case "leave-policies":
          return { rows: await listLeavePolicies(client, context) };
        case "leave-balances":
          return {
            rows: await listLeaveBalances(client, context, {
              leaveYear: get("leaveYear"),
              employeeId: get("employeeId"),
            }),
          };
        case "my-leave-balances":
          return {
            rows: await listLeaveBalances(client, context, {
              mine: true,
              leaveYear: get("leaveYear"),
            }),
          };
        case "leave-ledger":
          return {
            rows: await getLeaveLedger(client, context, {
              employeeId: get("employeeId"),
              leaveTypeId: get("leaveTypeId"),
              leaveYear: get("leaveYear"),
            }),
          };
        case "leave-requests":
          return {
            rows: await listLeaveRequests(client, context, {
              scope: get("scope"),
              status: get("status"),
              employeeId: get("employeeId"),
            }),
          };
        case "leave-calendar":
          return {
            rows: await getLeaveCalendar(client, context, {
              from: get("from"),
              to: get("to"),
            }),
          };
        case "leave-dashboard":
          return { dashboard: await getLeaveDashboard(client, context) };
        case "salary-components":
          return {
            rows: await listSalaryComponents(client, context, {
              type: get("type"),
            }),
          };
        case "salary-structures":
          return {
            rows: await listSalaryStructures(client, context, {
              status: get("status"),
            }),
          };
        case "salary-structure":
          return {
            structure: await getSalaryStructure(
              client,
              context,
              get("id") ?? "",
            ),
          };
        case "structure-preview":
          return {
            preview: await previewSalaryStructure(client, context, {
              structureId: get("structureId"),
              annualCtc: get("annualCtc"),
            }),
          };
        case "compensation":
          return {
            rows: await listCompensation(client, context, {
              employeeId: get("employeeId"),
              status: get("status"),
            }),
          };
        case "my-compensation":
          return { compensation: await getMyCompensation(client, context) };
        case "payroll-periods":
          return {
            rows: await listPayrollPeriods(client, context, {
              year: get("year"),
            }),
          };
        case "payroll-runs":
          return {
            rows: await listPayrollRuns(client, context, {
              status: get("status"),
            }),
          };
        case "payroll-run":
          return { run: await getPayrollRun(client, context, get("id") ?? "") };
        case "payslips":
          return {
            rows: await listPayslips(client, context, {
              runId: get("runId"),
              employeeId: get("employeeId"),
              status: get("status"),
            }),
          };
        case "payslip":
          return {
            payslip: await getPayslip(client, context, get("id") ?? ""),
          };
        case "my-payslips":
          return { rows: await listMyPayslips(client, context) };
        case "payroll-exceptions":
          return {
            rows: await listPayrollExceptions(client, context, {
              runId: get("runId"),
              open: get("open") === "true",
            }),
          };
        case "payroll-determinism":
          return {
            result: await verifyPayrollDeterminism(
              client,
              context,
              get("id") ?? "",
            ),
          };
        case "payroll-dashboard":
          return { dashboard: await getPayrollDashboard(client, context) };
        default:
          throw new HttpError(404, "Unknown HR view.");
      }
    },
    SELF_SERVICE.has(kind) ||
      (SCOPED.has(kind) &&
        ["mine", "team", "toReview"].includes(q.get("scope") ?? ""))
      ? ""
      : "hr_payroll.view",
  );
}
