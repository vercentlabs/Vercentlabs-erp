import { z } from "zod";

import {
  addEmployeeDocument, addLifecycleTask, applyDueEmployeeChanges, cancelEmployeeChange, completeJoining, completeLifecycleTask, completeSeparation, decideEmployeeChange, decideProfileChange, decideSeparation,
  initiateSeparation, proposeEmployeeChange, recordExitInterview, removeEmployeeDocument, requestProfileChange, reviewEmployeeDocument, saveDepartment, saveDesignation, saveDocumentType, saveEmployee,
  saveHrSettings, updateEmployee, updateMyProfile, withdrawSeparation,
  applyToOpening, cancelInterview, convertOfferToEmployee, createOffer, decideJobOpening, decideOffer, markInterviewNoShow, moveApplication, recordOfferDecision, saveCandidate, saveJobOpening, scheduleInterview,
  sendOffer, setOpeningStatus, submitInterviewFeedback, submitJobOpening, submitOffer, withdrawOffer,
  saveShift, assignShift, saveHolidayCalendar, addHoliday, removeHoliday, assignHolidayCalendar, punch, recordAttendance, requestRegularization, decideRegularization, cancelRegularization, decideOvertime,
  createPayrollInput, bulkCreatePayrollInputs, decidePayrollInput, cancelPayrollInput, saveExpenseCategory, saveExpense, decideExpense, requestLoan, decideLoan, skipLoanInstallment, prepayLoan, calculateArrears,
  calculateFinalSettlement, submitFinalSettlement, decideFinalSettlement, paySettlement, generateBankFile, acknowledgeBankFile, postPayrollToAccounting,
  saveStatutoryComponent, setStatutorySlab, removeStatutorySlab, deactivateStatutoryComponent, estimateGratuity,
  saveSalaryComponent, createSalaryStructure, updateDraftStructure, submitSalaryStructure, decideSalaryStructure, reviseSalaryStructure, obsoleteSalaryStructure, proposeCompensation, decideCompensation,
  generatePayrollPeriods, lockPayrollPeriod, unlockPayrollPeriod, closePayrollPeriod, startPayrollRun, runPayrollCalculation, submitPayrollRun, returnPayrollRun, decidePayrollRun, cancelPayroll, resolvePayrollException, holdPayslip, releasePayslipHold,
  saveLeaveType, saveLeavePolicy, setPolicyEntry, removePolicyEntry, assignLeavePolicy, adjustLeaveBalance, runLeaveAccrual, runYearEndCarryForward, applyLeave, decideLeave, cancelLeave,
  saveGoal, checkInGoal, closeGoal, saveReviewCycle, openReviewCycle, closeReviewCycle, submitSelfReview, submitPeerFeedback, submitManagerReview, calibrateAppraisal,
  saveSkill, setEmployeeSkill, saveCourse, scheduleTrainingSession, cancelTrainingSession, enrollInTraining, recordTrainingCompletion,
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
// the caller's own employee record (or, for a resignation/withdrawal, to HR).
const SELF_SERVICE = new Set(["me-update", "me-change-request", "separation-initiate", "separation-withdraw", "document-add", "interview-feedback", "punch", "regularization-request", "regularization-decide", "regularization-cancel", "overtime-decide", "leave-apply", "leave-decide", "leave-cancel", "expense-save", "loan-request", "goal-save", "goal-checkin", "goal-close", "appraisal-self-review", "appraisal-manager-review", "appraisal-peer-feedback", "employee-skill-set", "training-enroll"]);

// One mutation endpoint per HR operation. Each domain function enforces its OWN permission, state
// machine and segregation of duties (a second person approves changes, documents, bank details).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return hrMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveHrSettings(client, context, input) };
        case "document-type-save":
          return { record: await saveDocumentType(client, context, input) };
        case "department-save":
          return { record: await saveDepartment(client, context, input) };
        case "designation-save":
          return { record: await saveDesignation(client, context, input) };
        case "employee-save":
          return { record: await saveEmployee(client, context, input) };
        case "employee-update":
          return { record: await updateEmployee(client, context, idOf(input), input) };
        case "employee-join":
          return { record: await completeJoining(client, context, idOf(input)) };
        case "document-add":
          return { record: await addEmployeeDocument(client, context, input) };
        case "document-review":
          return { record: await reviewEmployeeDocument(client, context, idOf(input), { verify: input.verify === true, note: String(input.note ?? "") }) };
        case "document-remove":
          return { record: await removeEmployeeDocument(client, context, idOf(input)) };
        case "change-propose":
          return { record: await proposeEmployeeChange(client, context, input) };
        case "change-decide":
          return { record: await decideEmployeeChange(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "change-cancel":
          return { record: await cancelEmployeeChange(client, context, idOf(input), String(input.reason ?? "")) };
        case "changes-apply-due":
          return { record: await applyDueEmployeeChanges(client, context) };
        case "task-add":
          return { record: await addLifecycleTask(client, context, input) };
        case "task-complete":
          return { record: await completeLifecycleTask(client, context, idOf(input), { note: String(input.note ?? ""), waive: input.waive === true }) };
        case "separation-initiate":
          return { record: await initiateSeparation(client, context, input) };
        case "separation-decide":
          return { record: await decideSeparation(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? ""), lastWorkingDay: input.lastWorkingDay ? String(input.lastWorkingDay) : undefined }) };
        case "separation-withdraw":
          return { record: await withdrawSeparation(client, context, idOf(input), String(input.reason ?? "")) };
        case "separation-exit-interview":
          return { record: await recordExitInterview(client, context, idOf(input), input) };
        case "separation-complete":
          return { record: await completeSeparation(client, context, idOf(input), input) };
        case "me-update":
          return { record: await updateMyProfile(client, context, input) };
        case "me-change-request":
          return { record: await requestProfileChange(client, context, input) };
        case "profile-change-decide":
          return { record: await decideProfileChange(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "opening-save":
          return { record: await saveJobOpening(client, context, input) };
        case "opening-submit":
          return { record: await submitJobOpening(client, context, idOf(input)) };
        case "opening-decide":
          return { record: await decideJobOpening(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "opening-status":
          return { record: await setOpeningStatus(client, context, idOf(input), { action: String(input.action ?? ""), reason: String(input.reason ?? "") }) };
        case "candidate-save":
          return { record: await saveCandidate(client, context, input) };
        case "application-create":
          return { record: await applyToOpening(client, context, input) };
        case "application-move":
          return { record: await moveApplication(client, context, idOf(input), { stage: String(input.stage ?? ""), reason: String(input.reason ?? "") }) };
        case "interview-schedule":
          return { record: await scheduleInterview(client, context, input) };
        case "interview-cancel":
          return { record: await cancelInterview(client, context, idOf(input), String(input.reason ?? "")) };
        case "interview-feedback":
          return { record: await submitInterviewFeedback(client, context, idOf(input), input) };
        case "interview-no-show":
          return { record: await markInterviewNoShow(client, context, idOf(input)) };
        case "offer-create":
          return { record: await createOffer(client, context, input) };
        case "offer-submit":
          return { record: await submitOffer(client, context, idOf(input)) };
        case "offer-decide":
          return { record: await decideOffer(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "offer-send":
          return { record: await sendOffer(client, context, idOf(input)) };
        case "offer-decision":
          return { record: await recordOfferDecision(client, context, idOf(input), { accepted: input.accepted === true, note: String(input.note ?? "") }) };
        case "offer-withdraw":
          return { record: await withdrawOffer(client, context, idOf(input), String(input.reason ?? "")) };
        case "offer-convert":
          return { record: await convertOfferToEmployee(client, context, idOf(input), input) };
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
          return { record: await assignHolidayCalendar(client, context, input) };
        case "punch":
          return { record: await punch(client, context, input) };
        case "attendance-record":
          return { record: await recordAttendance(client, context, input) };
        case "regularization-request":
          return { record: await requestRegularization(client, context, input) };
        case "regularization-decide":
          return { record: await decideRegularization(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "regularization-cancel":
          return { record: await cancelRegularization(client, context, idOf(input)) };
        case "overtime-decide":
          return { record: await decideOvertime(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "component-save":
          return { record: await saveSalaryComponent(client, context, input) };
        case "structure-create":
          return { record: await createSalaryStructure(client, context, input) };
        case "structure-update":
          return { record: await updateDraftStructure(client, context, idOf(input), input) };
        case "structure-submit":
          return { record: await submitSalaryStructure(client, context, idOf(input)) };
        case "structure-decide":
          return { record: await decideSalaryStructure(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "structure-revise":
          return { record: await reviseSalaryStructure(client, context, idOf(input)) };
        case "structure-obsolete":
          return { record: await obsoleteSalaryStructure(client, context, idOf(input), String(input.reason ?? "")) };
        case "compensation-propose":
          return { record: await proposeCompensation(client, context, input) };
        case "compensation-decide":
          return { record: await decideCompensation(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "periods-generate":
          return { record: await generatePayrollPeriods(client, context, input) };
        case "period-lock":
          return { record: await lockPayrollPeriod(client, context, idOf(input), { force: input.force === true, reason: String(input.reason ?? "") }) };
        case "period-unlock":
          return { record: await unlockPayrollPeriod(client, context, idOf(input), String(input.reason ?? "")) };
        case "period-close":
          return { record: await closePayrollPeriod(client, context, idOf(input)) };
        case "payroll-start":
          return { record: await startPayrollRun(client, context, input) };
        case "payroll-calculate":
          return { record: await runPayrollCalculation(client, context, idOf(input), input) };
        case "payroll-submit":
          return { record: await submitPayrollRun(client, context, idOf(input)) };
        case "payroll-return":
          return { record: await returnPayrollRun(client, context, idOf(input), String(input.reason ?? "")) };
        case "payroll-decide":
          return { record: await decidePayrollRun(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "payroll-cancel":
          return { record: await cancelPayroll(client, context, idOf(input), String(input.reason ?? "")) };
        case "exception-resolve":
          return { record: await resolvePayrollException(client, context, idOf(input), String(input.note ?? "")) };
        case "payslip-hold":
          return { record: await holdPayslip(client, context, idOf(input), String(input.reason ?? "")) };
        case "payslip-release-hold":
          return { record: await releasePayslipHold(client, context, idOf(input)) };
        case "leave-type-save":
          return { record: await saveLeaveType(client, context, input) };
        case "leave-policy-save":
          return { record: await saveLeavePolicy(client, context, input) };
        case "policy-entry-set":
          return { record: await setPolicyEntry(client, context, input) };
        case "policy-entry-remove":
          return { record: await removePolicyEntry(client, context, idOf(input)) };
        case "policy-assign":
          return { record: await assignLeavePolicy(client, context, input) };
        case "leave-balance-adjust":
          return { record: await adjustLeaveBalance(client, context, input) };
        case "leave-accrual-run":
          return { record: await runLeaveAccrual(client, context, input) };
        case "leave-carry-forward-run":
          return { record: await runYearEndCarryForward(client, context, input) };
        case "leave-apply":
          return { record: await applyLeave(client, context, input) };
        case "leave-decide":
          return { record: await decideLeave(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "leave-cancel":
          return { record: await cancelLeave(client, context, idOf(input), String(input.reason ?? "")) };
        case "goal-save":
          return { record: await saveGoal(client, context, input) };
        case "goal-checkin":
          return { record: await checkInGoal(client, context, idOf(input), input) };
        case "goal-close":
          return { record: await closeGoal(client, context, idOf(input), { status: String(input.status ?? ""), note: String(input.note ?? "") }) };
        case "review-cycle-save":
          return { record: await saveReviewCycle(client, context, input) };
        case "review-cycle-open":
          return { record: await openReviewCycle(client, context, idOf(input)) };
        case "review-cycle-close":
          return { record: await closeReviewCycle(client, context, idOf(input), String(input.reason ?? "")) };
        case "appraisal-self-review":
          return { record: await submitSelfReview(client, context, idOf(input), input) };
        case "appraisal-manager-review":
          return { record: await submitManagerReview(client, context, idOf(input), input) };
        case "appraisal-peer-feedback":
          return { record: await submitPeerFeedback(client, context, idOf(input), input) };
        case "appraisal-calibrate":
          return { record: await calibrateAppraisal(client, context, idOf(input), input) };
        case "skill-save":
          return { record: await saveSkill(client, context, input) };
        case "employee-skill-set":
          return { record: await setEmployeeSkill(client, context, input) };
        case "course-save":
          return { record: await saveCourse(client, context, input) };
        case "training-session-schedule":
          return { record: await scheduleTrainingSession(client, context, input) };
        case "training-session-cancel":
          return { record: await cancelTrainingSession(client, context, idOf(input), String(input.reason ?? "")) };
        case "training-enroll":
          return { record: await enrollInTraining(client, context, input) };
        case "training-complete":
          return { record: await recordTrainingCompletion(client, context, idOf(input), input) };
        case "input-create":
          return { record: await createPayrollInput(client, context, input) };
        case "input-bulk-create":
          return { record: await bulkCreatePayrollInputs(client, context, input) };
        case "input-decide":
          return { record: await decidePayrollInput(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "input-cancel":
          return { record: await cancelPayrollInput(client, context, idOf(input), String(input.reason ?? "")) };
        case "expense-category-save":
          return { record: await saveExpenseCategory(client, context, input) };
        case "expense-save":
          return { record: await saveExpense(client, context, input) };
        case "expense-decide":
          return { record: await decideExpense(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "loan-request":
          return { record: await requestLoan(client, context, input) };
        case "loan-decide":
          return { record: await decideLoan(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "loan-installment-skip":
          return { record: await skipLoanInstallment(client, context, idOf(input), String(input.reason ?? "")) };
        case "loan-prepay":
          return { record: await prepayLoan(client, context, idOf(input), input) };
        case "arrears-calculate":
          return { record: await calculateArrears(client, context, String(input.employeeId ?? "")) };
        case "settlement-calculate":
          return { record: await calculateFinalSettlement(client, context, String(input.employeeId ?? "")) };
        case "settlement-submit":
          return { record: await submitFinalSettlement(client, context, idOf(input)) };
        case "settlement-decide":
          return { record: await decideFinalSettlement(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
        case "settlement-pay":
          return { record: await paySettlement(client, context, idOf(input)) };
        case "bank-file-generate":
          return { record: await generateBankFile(client, context, String(input.runId ?? "")) };
        case "bank-file-acknowledge":
          return { record: await acknowledgeBankFile(client, context, idOf(input), String(input.utrReference ?? "")) };
        case "payroll-post-accounting":
          return { record: await postPayrollToAccounting(client, context, String(input.runId ?? "")) };
        case "statutory-component-save":
          return { record: await saveStatutoryComponent(client, context, input) };
        case "statutory-slab-set":
          return { record: await setStatutorySlab(client, context, input) };
        case "statutory-slab-remove":
          return { record: await removeStatutorySlab(client, context, idOf(input)) };
        case "statutory-component-deactivate":
          return { record: await deactivateStatutoryComponent(client, context, idOf(input), String(input.reason ?? "")) };
        case "gratuity-estimate":
          return { record: await estimateGratuity(client, context, String(input.employeeId ?? "")) };
        default:
          throw new HttpError(404, "Unknown HR action.");
      }
    },
    200,
    SELF_SERVICE.has(action) ? "" : "hr_payroll.view",
  );
}
