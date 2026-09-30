import { z } from "zod";

import {
  addLifecycleTask,
  completeJoining,
  completeLifecycleTask,
  saveDepartment,
  saveDesignation,
  saveEmployee,
  saveHrSettings,
  updateEmployee,
  updateMyProfile,
  saveShift,
  assignShift,
  saveHolidayCalendar,
  addHoliday,
  removeHoliday,
  assignHolidayCalendar,
  punch,
  recordAttendance,
  saveSalaryComponent,
  createSalaryStructure,
  updateDraftStructure,
  submitSalaryStructure,
  decideSalaryStructure,
  reviseSalaryStructure,
  obsoleteSalaryStructure,
  proposeCompensation,
  decideCompensation,
  generatePayrollPeriods,
  lockPayrollPeriod,
  unlockPayrollPeriod,
  closePayrollPeriod,
  startPayrollRun,
  runPayrollCalculation,
  submitPayrollRun,
  returnPayrollRun,
  decidePayrollRun,
  cancelPayroll,
  resolvePayrollException,
  holdPayslip,
  releasePayslipHold,
  saveLeaveType,
  saveLeavePolicy,
  setPolicyEntry,
  removePolicyEntry,
  assignLeavePolicy,
  adjustLeaveBalance,
  runLeaveAccrual,
  runYearEndCarryForward,
  applyLeave,
  decideLeave,
  cancelLeave,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { hrMutation } from "@/features/hr/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};
// Employee self-service operations: no HR permission on the route. The domain scopes each one to
// the caller's own employee record.
const SELF_SERVICE = new Set([
  "me-update",
  "punch",
  "leave-apply",
  "leave-decide",
  "leave-cancel",
]);

// One mutation endpoint per HR operation. Each domain function enforces its OWN permission, state
// machine and segregation of duties (a second person approves structures, compensation and payroll).
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return hrMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveHrSettings(client, context, input) };
        case "department-save":
          return { record: await saveDepartment(client, context, input) };
        case "designation-save":
          return { record: await saveDesignation(client, context, input) };
        case "employee-save":
          return { record: await saveEmployee(client, context, input) };
        case "employee-update":
          return {
            record: await updateEmployee(client, context, idOf(input), input),
          };
        case "employee-join":
          return {
            record: await completeJoining(client, context, idOf(input)),
          };
        case "task-add":
          return { record: await addLifecycleTask(client, context, input) };
        case "task-complete":
          return {
            record: await completeLifecycleTask(client, context, idOf(input), {
              note: String(input.note ?? ""),
              waive: input.waive === true,
            }),
          };
        case "me-update":
          return { record: await updateMyProfile(client, context, input) };
        case "shift-save":
          return { record: await saveShift(client, context, input) };
        case "shift-assign":
          return { record: await assignShift(client, context, input) };
        case "holiday-calendar-save":
          return { record: await saveHolidayCalendar(client, context, input) };
        case "holiday-add":
          return { record: await addHoliday(client, context, input) };
        case "holiday-remove":
          return { record: await removeHoliday(client, context, idOf(input)) };
        case "holiday-calendar-assign":
          return {
            record: await assignHolidayCalendar(client, context, input),
          };
        case "punch":
          return { record: await punch(client, context, input) };
        case "attendance-record":
          return { record: await recordAttendance(client, context, input) };
        case "component-save":
          return { record: await saveSalaryComponent(client, context, input) };
        case "structure-create":
          return {
            record: await createSalaryStructure(client, context, input),
          };
        case "structure-update":
          return {
            record: await updateDraftStructure(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "structure-submit":
          return {
            record: await submitSalaryStructure(client, context, idOf(input)),
          };
        case "structure-decide":
          return {
            record: await decideSalaryStructure(client, context, idOf(input), {
              approve: input.approve === true,
              note: String(input.note ?? ""),
            }),
          };
        case "structure-revise":
          return {
            record: await reviseSalaryStructure(client, context, idOf(input)),
          };
        case "structure-obsolete":
          return {
            record: await obsoleteSalaryStructure(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "compensation-propose":
          return { record: await proposeCompensation(client, context, input) };
        case "compensation-decide":
          return {
            record: await decideCompensation(client, context, idOf(input), {
              approve: input.approve === true,
              note: String(input.note ?? ""),
            }),
          };
        case "periods-generate":
          return {
            record: await generatePayrollPeriods(client, context, input),
          };
        case "period-lock":
          return {
            record: await lockPayrollPeriod(client, context, idOf(input), {
              force: input.force === true,
              reason: String(input.reason ?? ""),
            }),
          };
        case "period-unlock":
          return {
            record: await unlockPayrollPeriod(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "period-close":
          return {
            record: await closePayrollPeriod(client, context, idOf(input)),
          };
        case "payroll-start":
          return { record: await startPayrollRun(client, context, input) };
        case "payroll-calculate":
          return {
            record: await runPayrollCalculation(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "payroll-submit":
          return {
            record: await submitPayrollRun(client, context, idOf(input)),
          };
        case "payroll-return":
          return {
            record: await returnPayrollRun(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "payroll-decide":
          return {
            record: await decidePayrollRun(client, context, idOf(input), {
              approve: input.approve === true,
              note: String(input.note ?? ""),
            }),
          };
        case "payroll-cancel":
          return {
            record: await cancelPayroll(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "exception-resolve":
          return {
            record: await resolvePayrollException(
              client,
              context,
              idOf(input),
              String(input.note ?? ""),
            ),
          };
        case "payslip-hold":
          return {
            record: await holdPayslip(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        case "payslip-release-hold":
          return {
            record: await releasePayslipHold(client, context, idOf(input)),
          };
        case "leave-type-save":
          return { record: await saveLeaveType(client, context, input) };
        case "leave-policy-save":
          return { record: await saveLeavePolicy(client, context, input) };
        case "policy-entry-set":
          return { record: await setPolicyEntry(client, context, input) };
        case "policy-entry-remove":
          return {
            record: await removePolicyEntry(client, context, idOf(input)),
          };
        case "policy-assign":
          return { record: await assignLeavePolicy(client, context, input) };
        case "leave-balance-adjust":
          return { record: await adjustLeaveBalance(client, context, input) };
        case "leave-accrual-run":
          return { record: await runLeaveAccrual(client, context, input) };
        case "leave-carry-forward-run":
          return {
            record: await runYearEndCarryForward(client, context, input),
          };
        case "leave-apply":
          return { record: await applyLeave(client, context, input) };
        case "leave-decide":
          return {
            record: await decideLeave(client, context, idOf(input), {
              approve: input.approve === true,
              note: String(input.note ?? ""),
            }),
          };
        case "leave-cancel":
          return {
            record: await cancelLeave(
              client,
              context,
              idOf(input),
              String(input.reason ?? ""),
            ),
          };
        default:
          throw new HttpError(404, "Unknown HR action.");
      }
    },
    200,
    SELF_SERVICE.has(action) ? "" : "hr_payroll.view",
  );
}
