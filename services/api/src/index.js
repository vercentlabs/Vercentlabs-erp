export * from "@vercentlabs/reporting-engine";
export * from "./core/master-data.js";
export * from "./core/document-numbering.js";
export * from "./core/idempotency.js";
export * from "./core/inventory-lock.js";
export * from "./core/references.js";
export * from "./modules/crm/index.js";
export * from "./core/billing.js";
export * from "./modules/sales/index.js";

export * from "./modules/accounting/index.js";

export * from "./modules/procurement/index.js";
export * from "./modules/crm/prospect-and-relationship-master-data/foundation.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-governance.js";

export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-operations.js";

export * from "./modules/crm/prospect-and-relationship-master-data/account-operations.js";

export * from "./modules/crm/prospect-and-relationship-master-data/contact-operations.js";

export * from "./modules/crm/prospect-and-relationship-master-data/lead-source-operations.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-lifecycle.js";
export * from "./modules/crm/prospect-and-relationship-master-data/lead-duplicates.js";
export * from "./modules/crm/prospect-and-relationship-master-data/lead-attribution.js";

export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/sales-stage-operations.js";
export * from "./modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";

export * from "./modules/sales/quotation-governance.js";

export * from "./modules/sales/order-governance.js";

export * from "./modules/accounting/receivables-governance.js";

export * from "./modules/accounting/payables-governance.js";

export * from "./modules/accounting/banking-governance.js";

export * from "./modules/accounting/tax-reporting-governance.js";

export * from "./modules/procurement/governance.js";

export * from "./modules/crm/crm-data-operations-and-customization/core-acceptance.js";

export * from "./modules/crm/prospect-and-relationship-master-data/account-intelligence.js";

export * from "./modules/crm/prospect-and-relationship-master-data/contact-relationships.js";
export * from "./modules/crm/prospect-and-relationship-master-data/duplicate-rules.js";
export {
  findAccountDuplicates,
  findContactDuplicates,
  findLeadContactCrossMatches,
  projectDuplicateMatchesForCaller,
  dismissAccountDuplicateMatch,
  dismissContactDuplicateMatch,
  recordAccountDuplicateOverride,
  recordContactDuplicateOverride,
} from "./modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";
export * from "./modules/crm/prospect-and-relationship-master-data/duplicate-scan.js";

export * from "./core/release/governance.js";

export * from "./modules/crm/seller-activity-and-follow-up-workspace/communications.js";

export * from "./modules/crm/prospect-and-relationship-master-data/lead-acquisition.js";
export * from "./modules/crm/prospect-and-relationship-master-data/lead-export.js";
export * from "./modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js";
export {
  listLeadScoringModels,
  createLeadScoringModel,
  updateLeadScoringModel,
  activateLeadScoringModel,
  createLeadScoringModelRule,
  setLeadScoringModelRuleStatus,
  trainLeadScoringModel,
  enqueueLeadScoreRecalcJob,
  getLeadScoreRecalcJob,
  processLeadScoreRecalcBatch,
  SCORE_RECALC_JOB_TYPE,
  SCORE_RECALC_BATCH_SIZE,
} from "./modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/index.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-revenue-intelligence.js";
export * from "./modules/crm/crm-data-operations-and-customization/offline-sync.js";
export * from "./modules/crm/crm-data-operations-and-customization/notification-visibility.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-commercial.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/opportunity-contacts.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/stage-migration.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/stage-aging.js";
export * from "./modules/crm/opportunity-and-pipeline-governance/pipeline-snapshots.js";
export * from "./modules/stock/index.js";
export * from "./modules/stock/master-operations.js";
export * from "./modules/stock/read-models.js";
export * from "./modules/stock/counts.js";
export * from "./modules/stock/valuation.js";
export * from "./modules/stock/exceptions.js";
export * from "./modules/stock/outbound.js";
export * from "./modules/manufacturing/index.js";
export { MfgError } from "./modules/manufacturing/common.js";
export * from "./modules/manufacturing/engineering.js";
export * from "./modules/manufacturing/options.js";
export * from "./modules/manufacturing/routing.js";
export * from "./modules/manufacturing/shopfloor.js";
export * from "./modules/manufacturing/planning.js";
export * from "./modules/manufacturing/execution.js";
export * from "./modules/manufacturing/costing.js";
export * from "./modules/projects/index.js";
export * from "./modules/projects/desk.js";
export * from "./modules/assets/index.js";
export * from "./modules/assets/desk.js";
export * from "./modules/point-of-sale/index.js";
export * from "./modules/quality/index.js";
export { qualityContext } from "./modules/quality/common.js";
export { getQualitySettings, saveQualitySettings, listSamplingPlans, saveSamplingPlan, listQualityPlans, getQualityPlan, createQualityPlan as defineQualityPlan, approveQualityPlan, reviseQualityPlan, retireQualityPlan, listInspections, getInspection, createInspection as createQualityInspection, recordInspectionResults, completeInspection as completeQualityInspection, releaseInspection as releaseQualityInspection, cancelInspection as cancelQualityInspection } from "./modules/quality/inspections.js";
export { listQualityHolds, getQualityHold, createQualityHold, cancelQualityHold, listNonconformances, getNonconformance, createNonconformance as createQualityNonconformance, transitionNonconformance, setDisposition, approveUseAsIs, closeNonconformance, cancelNonconformance, listCapa, getCapa, createCapa as createQualityCapa, recordRootCause, recordCapaActions, submitCapaForVerification, verifyCapa, closeCapa } from "./modules/quality/nonconformance.js";
export { listSupplierQualityRecords, recomputeSupplierQualityRecord, listAudits, getAudit, saveAudit, startAudit, addAuditFinding, linkFindingCapa, closeAuditFinding, completeAudit, listCalibrationRecords, recordCalibration, markOverdueCalibrations, listCertificates, saveCertificate, issueCertificate, voidCertificate, listQualityDocuments, saveQualityDocument, submitQualityDocument, approveQualityDocument, reviseQualityDocument, obsoleteQualityDocument, listCustomerComplaints, getCustomerComplaint, createCustomerComplaint, investigateComplaint, resolveComplaint, closeComplaint, getBatchTraceability, getQualityCostReport, getQualityKpiDashboard, listQualityOptions } from "./modules/quality/management.js";
export * from "./modules/support/index.js";
export { supportContext } from "./modules/support/common.js";
export { getSupportSettings, saveSupportSettings, listCategories as listSupportCategories, saveCategory as saveSupportCategory, listQueues as listSupportQueues, saveQueue as saveSupportQueue, listQueueMembers, setQueueMember, removeQueueMember, listRoutingRules, saveRoutingRule, deactivateRoutingRule, listSlaPolicies, saveSlaPolicy, deactivateSlaPolicy, listEscalationPolicies, saveEscalationPolicy, createTicket, listTickets, getTicket, updateTicket, assignTicket, transitionTicket, mergeTickets, listCommunications, addCommunication, listAttachments, addAttachment, removeAttachment, listEscalations, escalateTicket, decideEscalation, checkSlaBreaches, getTicketHistory } from "./modules/support/tickets.js";
export { listKnowledgeArticles, getKnowledgeArticle, saveKnowledgeArticle, submitKnowledgeArticle, publishKnowledgeArticle, retireKnowledgeArticle, reviseKnowledgeArticle, rateKnowledgeArticle, linkArticleToTicket, listTicketKnowledgeLinks, listCannedResponses, saveCannedResponse, recordCannedResponseUsage } from "./modules/support/knowledge.js";
export { listPortalUsers, invitePortalUser, setPortalUserStatus, getMyPortalAccess, listMyTickets, getMyTicket, createMyTicket, listMyCommunications, replyToMyTicket, listMyAttachments, addMyAttachment, submitMyCsat, listMyKnowledgeArticles, getMyKnowledgeArticle } from "./modules/support/portal.js";
export { getCustomerOrderHistory, getTicketLinkedRecords, listEntitlements, saveEntitlement, setEntitlementStatus, getCsatReport, getAgentPerformance, getSlaReport, getSupportDeskDashboard, getAuditLog as getSupportAuditLog, listSupportOptions, listCustomerContacts } from "./modules/support/service.js";
export * from "./modules/hr-payroll/index.js";
// task-operations.js is now also re-exported from ./modules/crm/index.js
// (line 6's `export *` already covers it) — the direct re-export here was
// removed rather than kept alongside it to avoid an ambiguous/duplicate
// star-export binding for the same symbols.

export * from "./modules/sales/pass1-operations.js";

export * from "./modules/procurement/pass1-operations.js";
export * from "./orchestration/reorder-purchasing.js";
export * from "./orchestration/procurement-stock-receiving.js";
export * from "./orchestration/procurement-accounting-vendor-bill.js";

export * from "./orchestration/sales-pass1-options.js";

export * from "./orchestration/sales-stock-reservation.js";

export * from "./orchestration/sales-stock-fulfillment.js";

// Platform reactivation port (Prompt 2 of 15) — see
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv for the source mapping.
// Every symbol below is ported from docs/frontend-rebuild/
// recovered-platform-code and re-reviewed for the current security
// standard; none of the ACTIVE code re-exported here reads from that
// parked directory at runtime.
// Shared Access public boundary (see core/access/index.js).
export * from "./core/access/index.js";
export * from "./core/access-control-runtime.js";
export * from "./core/session.js";
export * from "./core/access-administration.js";
export * from "./core/entitlements.js";
export * from "./core/razorpay.js";
export * from "./core/subscription-billing.js";
export * from "./core/module-entitlements.js";
export * from "./core/audit-redaction.js";
export * from "./core/security.js";
export * from "./core/attachment-security.js";
export * from "./core/password-policy.js";
export * from "./core/auth-mailer.js";
export * from "./core/auth-lifecycle.js";
export * from "./core/mfa.js";
export * from "./core/organization-administration.js";
export * from "./core/organization-registration.js";
export * from "./core/api-keys.js";
export * from "./core/oauth.js";
export * from "./core/notification-preferences.js";
export * from "./core/inbound-mail.js";
export * from "./core/tags.js";
export * from "./core/configuration.js";
export * from "./core/privacy.js";
export * from "./core/ai-governance.js";

// Prompt 2B — global shell closure: cross-module approval inbox,
// notification center, and background-job visibility.
export * from "./core/approvals.js";
export * from "./core/notifications.js";
export * from "./core/background-jobs.js";
export * from "./core/platform/module-administration.js";

export * from "./orchestration/sales-crm-opportunity-sync.js";
export { hrContext, HrError } from "./modules/hr-payroll/common.js";
export * from "./modules/hr-payroll/options.js";
export * from "./modules/hr-payroll/workforce.js";
export * from "./modules/hr-payroll/recruitment.js";
export { listShifts, saveShift, listShiftAssignments, assignShift, listHolidayCalendars, saveHolidayCalendar, listHolidays, addHoliday, removeHoliday, assignHolidayCalendar, punch, recordAttendance, listAttendance, getMyPunchState, listRegularizations, requestRegularization, decideRegularization, cancelRegularization, listOvertime, decideOvertime, getLateEarlyReport, getAttendanceSummary, computeAttendanceSummary, recomputeDay } from "./modules/hr-payroll/time.js";
export { listLeaveTypes, saveLeaveType, listLeavePolicies, saveLeavePolicy, setPolicyEntry, removePolicyEntry, assignLeavePolicy, listLeaveBalances, getLeaveLedger, adjustLeaveBalance, runLeaveAccrual, runYearEndCarryForward, applyLeave, decideLeave, cancelLeave, listLeaveRequests, getLeaveCalendar, getLeaveDashboard } from "./modules/hr-payroll/leave.js";
export { listSalaryComponents, saveSalaryComponent, listSalaryStructures, getSalaryStructure, createSalaryStructure, updateDraftStructure, submitSalaryStructure, decideSalaryStructure, reviseSalaryStructure, obsoleteSalaryStructure, previewSalaryStructure, listCompensation, proposeCompensation, decideCompensation, getMyCompensation } from "./modules/hr-payroll/compensation.js";
export { listPayrollPeriods, generatePayrollPeriods, lockPayrollPeriod, unlockPayrollPeriod, closePayrollPeriod, startPayrollRun, runPayrollCalculation, submitPayrollRun, returnPayrollRun, decidePayrollRun, cancelPayroll, listPayrollExceptions, resolvePayrollException, listPayrollRuns, getPayrollRun, listPayslips, getPayslip, listMyPayslips, verifyPayrollDeterminism, holdPayslip, releasePayslipHold, getPayrollDashboard, registerPayrollHook } from "./modules/hr-payroll/payroll.js";
export { listPayrollInputs, createPayrollInput, bulkCreatePayrollInputs, decidePayrollInput, cancelPayrollInput, listExpenseCategories, saveExpenseCategory, listExpenses, saveExpense, decideExpense, buildSchedule, listLoans, getLoan, requestLoan, decideLoan, skipLoanInstallment, prepayLoan, calculateArrears } from "./modules/hr-payroll/payroll-inputs.js";
export { listFinalSettlements, getFinalSettlement, calculateFinalSettlement, submitFinalSettlement, decideFinalSettlement, paySettlement, listBankFiles, getBankFile, generateBankFile, acknowledgeBankFile, postPayrollToAccounting, getPayrollReconciliation } from "./modules/hr-payroll/payroll-close.js";
export { listStatutoryComponents, getStatutoryComponent, saveStatutoryComponent, setStatutorySlab, removeStatutorySlab, deactivateStatutoryComponent, estimateGratuity, listGratuityRecords, gratuitySettlementLine, getStatutoryReport, getComplianceReport } from "./modules/hr-payroll/statutory.js";
export { listGoals, saveGoal, checkInGoal, closeGoal, listReviewCycles, saveReviewCycle, openReviewCycle, closeReviewCycle, listAppraisals, getAppraisal, submitSelfReview, submitPeerFeedback, submitManagerReview, calibrateAppraisal, listSkills, saveSkill, listEmployeeSkills, setEmployeeSkill, listCourses, saveCourse, listTrainingSessions, scheduleTrainingSession, cancelTrainingSession, listTrainingEnrolments, enrollInTraining, recordTrainingCompletion, getPerformanceDashboard } from "./modules/hr-payroll/performance.js";
