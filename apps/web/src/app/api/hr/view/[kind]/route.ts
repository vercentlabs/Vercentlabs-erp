import {
  getAttritionReport, getHrSettings, getMyProfile, getOrgChart, getEmployee, getWorkforceDashboard, listDepartments, listDesignations, listDocumentTypes, listEmployeeChanges, listEmployeeDocuments,
  listApplications, listCandidates, listInterviews, listJobOpenings, listOffers, getRecruitmentPipeline,
  listShifts, listShiftAssignments, listHolidayCalendars, listHolidays, listAttendance, getMyPunchState, listRegularizations, listOvertime, getLateEarlyReport, getAttendanceSummary,
  listLeaveTypes, listLeavePolicies, listLeaveBalances, getLeaveLedger, listLeaveRequests, getLeaveCalendar, getLeaveDashboard, listSelfOptions,
  listSalaryComponents, listSalaryStructures, getSalaryStructure, previewSalaryStructure, listCompensation, getMyCompensation, listPayrollPeriods, listPayrollRuns, getPayrollRun, listPayslips, getPayslip, listMyPayslips, listPayrollExceptions, verifyPayrollDeterminism, getPayrollDashboard,
  listPayrollInputs, listExpenseCategories, listExpenses, listLoans, getLoan,
  listFinalSettlements, getFinalSettlement, listBankFiles, getBankFile, getPayrollReconciliation,
  listStatutoryComponents, getStatutoryComponent, listGratuityRecords, getStatutoryReport, getComplianceReport,
  listEmployees, listHrOptions, listLifecycleTasks, listProbation, listProfileChangeRequests, listSeparations,
  listGoals, listReviewCycles, listAppraisals, getAppraisal, listSkills, listEmployeeSkills, listCourses, listTrainingSessions, listTrainingEnrolments, getPerformanceDashboard,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { hrRead } from "@/features/hr/shared/route-helpers";

// One read endpoint per HR screen. Each is gated by hr_payroll.view (module-wide) and the domain
// function re-checks its OWN permission; sensitive employee fields are stripped server-side. The
// "me" views are employee self-service: no HR permission, scoped to the caller's own record.
const SELF_SERVICE = new Set(["me", "me-tasks", "me-interviews", "me-options", "my-attendance", "punch-state", "my-summary", "my-leave-balances", "leave-calendar", "my-payslips", "payslip", "my-compensation"]);
// these list views serve HR (no scope), the reporting manager (scope=team/toReview) and the employee (scope=mine)
const SCOPED = new Set(["regularizations", "overtime", "leave-requests", "expenses", "loans", "goals", "appraisals", "employee-skills", "training-enrolments"]);

export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return hrRead(request, async (client, context) => {
    switch (kind) {
      case "options":
        return { options: await listHrOptions(client, context) };
      case "settings":
        return { settings: await getHrSettings(client, context) };
      case "document-types":
        return { rows: await listDocumentTypes(client, context) };
      case "departments":
        return { rows: await listDepartments(client, context) };
      case "designations":
        return { rows: await listDesignations(client, context) };
      case "employees":
        return { rows: await listEmployees(client, context, { status: get("status"), departmentId: get("departmentId"), employmentType: get("employmentType"), managerId: get("managerId"), branchId: get("branchId") }) };
      case "employee":
        return { employee: await getEmployee(client, context, get("id") ?? "") };
      case "org-chart":
        return { rows: await getOrgChart(client, context) };
      case "documents":
        return { rows: await listEmployeeDocuments(client, context, { employeeId: get("employeeId"), status: get("status"), expiringInDays: get("expiringInDays") }) };
      case "changes":
        return { rows: await listEmployeeChanges(client, context, { type: get("type"), status: get("status") }) };
      case "probation":
        return { rows: await listProbation(client, context) };
      case "tasks":
        return { rows: await listLifecycleTasks(client, context, { employeeId: get("employeeId"), kind: get("kind"), status: get("status") }) };
      case "separations":
        return { rows: await listSeparations(client, context, { status: get("status") }) };
      case "profile-requests":
        return { rows: await listProfileChangeRequests(client, context, { status: get("status") }) };
      case "dashboard":
        return { dashboard: await getWorkforceDashboard(client, context) };
      case "attrition":
        return { report: await getAttritionReport(client, context, { months: Number(get("months") ?? 12) }) };
      case "me":
        return { profile: await getMyProfile(client, context) };
      case "me-tasks":
        return { rows: await listLifecycleTasks(client, context, { status: get("status") }) };
      case "openings":
        return { rows: await listJobOpenings(client, context, { status: get("status") }) };
      case "candidates":
        return { rows: await listCandidates(client, context, { status: get("status"), source: get("source") }) };
      case "applications":
        return { rows: await listApplications(client, context, { openingId: get("openingId"), stage: get("stage") }) };
      case "pipeline":
        return { pipeline: await getRecruitmentPipeline(client, context, { openingId: get("openingId") }) };
      case "interviews":
        return { rows: await listInterviews(client, context, { applicationId: get("applicationId"), status: get("status") }) };
      case "me-interviews":
        return { rows: await listInterviews(client, context, { mine: true, status: get("status") }) };
      case "offers":
        return { rows: await listOffers(client, context, { status: get("status") }) };
      case "me-options":
        return { options: await listSelfOptions(client, context) };
      case "shifts":
        return { rows: await listShifts(client, context) };
      case "shift-assignments":
        return { rows: await listShiftAssignments(client, context, { employeeId: get("employeeId") }) };
      case "holiday-calendars":
        return { rows: await listHolidayCalendars(client, context) };
      case "holidays":
        return { rows: await listHolidays(client, context, { calendarId: get("calendarId"), year: get("year") }) };
      case "attendance":
        return { rows: await listAttendance(client, context, { from: get("from"), to: get("to"), employeeId: get("employeeId"), status: get("status"), flag: get("flag") }) };
      case "my-attendance":
        return { rows: await listAttendance(client, context, { mine: true, from: get("from"), to: get("to") }) };
      case "punch-state":
        return { state: await getMyPunchState(client, context) };
      case "regularizations":
        return { rows: await listRegularizations(client, context, { scope: get("scope"), status: get("status") }) };
      case "overtime":
        return { rows: await listOvertime(client, context, { scope: get("scope"), status: get("status") }) };
      case "late-early":
        return { rows: (await getLateEarlyReport(client, context, { from: get("from"), to: get("to") })).rows };
      case "attendance-summary":
        return { summary: await getAttendanceSummary(client, context, { employeeId: get("employeeId"), from: get("from"), to: get("to") }) };
      case "my-summary":
        return { summary: await getAttendanceSummary(client, context, { from: get("from"), to: get("to") }) };
      case "leave-types":
        return { rows: await listLeaveTypes(client, context) };
      case "leave-policies":
        return { rows: await listLeavePolicies(client, context) };
      case "leave-balances":
        return { rows: await listLeaveBalances(client, context, { leaveYear: get("leaveYear"), employeeId: get("employeeId") }) };
      case "my-leave-balances":
        return { rows: await listLeaveBalances(client, context, { mine: true, leaveYear: get("leaveYear") }) };
      case "leave-ledger":
        return { rows: await getLeaveLedger(client, context, { employeeId: get("employeeId"), leaveTypeId: get("leaveTypeId"), leaveYear: get("leaveYear") }) };
      case "leave-requests":
        return { rows: await listLeaveRequests(client, context, { scope: get("scope"), status: get("status"), employeeId: get("employeeId") }) };
      case "leave-calendar":
        return { rows: await getLeaveCalendar(client, context, { from: get("from"), to: get("to") }) };
      case "leave-dashboard":
        return { dashboard: await getLeaveDashboard(client, context) };
      case "salary-components":
        return { rows: await listSalaryComponents(client, context, { type: get("type") }) };
      case "salary-structures":
        return { rows: await listSalaryStructures(client, context, { status: get("status") }) };
      case "salary-structure":
        return { structure: await getSalaryStructure(client, context, get("id") ?? "") };
      case "structure-preview":
        return { preview: await previewSalaryStructure(client, context, { structureId: get("structureId"), annualCtc: get("annualCtc") }) };
      case "compensation":
        return { rows: await listCompensation(client, context, { employeeId: get("employeeId"), status: get("status") }) };
      case "my-compensation":
        return { compensation: await getMyCompensation(client, context) };
      case "payroll-periods":
        return { rows: await listPayrollPeriods(client, context, { year: get("year") }) };
      case "payroll-runs":
        return { rows: await listPayrollRuns(client, context, { status: get("status") }) };
      case "payroll-run":
        return { run: await getPayrollRun(client, context, get("id") ?? "") };
      case "payslips":
        return { rows: await listPayslips(client, context, { runId: get("runId"), employeeId: get("employeeId"), status: get("status") }) };
      case "payslip":
        return { payslip: await getPayslip(client, context, get("id") ?? "") };
      case "my-payslips":
        return { rows: await listMyPayslips(client, context) };
      case "payroll-exceptions":
        return { rows: await listPayrollExceptions(client, context, { runId: get("runId"), open: get("open") === "true" }) };
      case "payroll-determinism":
        return { result: await verifyPayrollDeterminism(client, context, get("id") ?? "") };
      case "payroll-dashboard":
        return { dashboard: await getPayrollDashboard(client, context) };
      case "payroll-inputs":
        return { rows: await listPayrollInputs(client, context, { type: get("type"), status: get("status"), employeeId: get("employeeId") }) };
      case "expense-categories":
        return { rows: await listExpenseCategories(client, context) };
      case "expenses":
        return { rows: await listExpenses(client, context, { status: get("status") }) };
      case "my-expenses":
        return { rows: await listExpenses(client, context, { scope: "mine", status: get("status") }) };
      case "team-expenses":
        return { rows: await listExpenses(client, context, { scope: "team", status: get("status") }) };
      case "loans":
        return { rows: await listLoans(client, context, { status: get("status") }) };
      case "my-loans":
        return { rows: await listLoans(client, context, { scope: "mine", status: get("status") }) };
      case "loan":
        return { loan: await getLoan(client, context, get("id") ?? "") };
      case "final-settlements":
        return { rows: await listFinalSettlements(client, context, { status: get("status") }) };
      case "final-settlement":
        return { settlement: await getFinalSettlement(client, context, get("id") ?? "") };
      case "bank-files":
        return { rows: await listBankFiles(client, context, { runId: get("runId") }) };
      case "bank-file":
        return { file: await getBankFile(client, context, get("id") ?? "") };
      case "payroll-reconciliation":
        return { reconciliation: await getPayrollReconciliation(client, context, get("runId") ?? "") };
      case "statutory-components":
        return { rows: await listStatutoryComponents(client, context, { type: get("type") }) };
      case "statutory-component":
        return { component: await getStatutoryComponent(client, context, get("id") ?? "") };
      case "gratuity-records":
        return { rows: await listGratuityRecords(client, context, { employeeId: get("employeeId") }) };
      case "statutory-report":
        return { report: await getStatutoryReport(client, context, get("runId") ?? "") };
      case "compliance-report":
        return { report: await getComplianceReport(client, context, { year: Number(get("year") ?? new Date().getFullYear()), month: Number(get("month") ?? new Date().getMonth() + 1) }) };
      case "goals":
        return { rows: await listGoals(client, context, { status: get("status"), scope: get("scope"), employeeId: get("employeeId") }) };
      case "review-cycles":
        return { rows: await listReviewCycles(client, context) };
      case "appraisals":
        return { rows: await listAppraisals(client, context, { status: get("status"), scope: get("scope") }) };
      case "appraisal":
        return { appraisal: await getAppraisal(client, context, get("id") ?? "") };
      case "skills":
        return { rows: await listSkills(client, context) };
      case "employee-skills":
        return { rows: await listEmployeeSkills(client, context, { scope: get("scope"), employeeId: get("employeeId") }) };
      case "courses":
        return { rows: await listCourses(client, context) };
      case "training-sessions":
        return { rows: await listTrainingSessions(client, context, { courseId: get("courseId") }) };
      case "training-enrolments":
        return { rows: await listTrainingEnrolments(client, context, { scope: get("scope"), sessionId: get("sessionId") }) };
      case "performance-dashboard":
        return { dashboard: await getPerformanceDashboard(client, context) };
      default:
        throw new HttpError(404, "Unknown HR view.");
    }
  }, SELF_SERVICE.has(kind) || (SCOPED.has(kind) && ["mine", "team", "toReview"].includes(q.get("scope") ?? "")) ? "" : "hr_payroll.view");
}
