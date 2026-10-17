// Projects (0125, Customer Association 0126): the project master and its lifecycle — identity, scope, an accountable manager and team, typed links to other modules'
// records, derived progress and explainable health, holds, completion checks, cancellation review, archive, notes, files, activity, saved
// views, import/export, overview reports, notifications and automation events. Tasks, milestones, time, budgets and billing are later
// features that plug into it (registerProjectWorkSource).
export { PROJECT as PROJECT_PERMISSION_KEYS, STATUS_LABEL as PROJECT_STATUS_LABEL, ProjectError, projectsContext } from "./project-core.js";
export {
  addProjectMember, addProjectNote, archiveProject, createProjectDraft, createProjectFromSalesOrder,
  deleteDraftProject, editProjectNote, flagProjectRisk, getProjectSettings, importProjects, linkProjectRecord, listProjectFiles, listProjectViews, noteProjectHealth,
  prepareProjectFileUpload, readProjectFile, removeProjectFile, removeProjectMember, removeProjectNote, removeProjectView, restoreProject,
  saveProjectSettings, saveProjectType, saveProjectView, unlinkProjectRecord, updateProject, updateProjectMemberRole, uploadProjectFile,
} from "./project-service.js";
export {
  PROJECT_REPORTS, exportProjects, getProject, getProjectActivity, getProjectLinks, getProjectMembers, getProjectNotes,
  getProjectOptions, getProjectReport, getProjectSummary, getProjectsOverview, listMyProjects, listProjectCustomerContacts, listProjects,
  notifyProjectAlerts, searchLinkableRecords, searchProjectCustomers,
} from "./project-read.js";
export { registerProjectWorkSource } from "./project-summary.js";
export {
  CONTACT_ROLES as PROJECT_CONTACT_ROLES, CUSTOMER_REPORTS as PROJECT_CUSTOMER_REPORTS, addProjectCustomerContact, addProjectSite, applyProjectContactMerge, applyProjectCustomerMerge,
  assignProjectCustomer, clearProjectCustomerReview, decideProjectCustomerChange, exportProjectCustomers, getCustomerAssociationHistory, getCustomerProjects, getProjectCustomer,
  getProjectCustomerReport, listEligibleProjectContacts, listProjectCustomerContactsOnProject, listProjectSites, noteSalesOrderChangeForProjects, previewProjectCustomerChange,
  removeProjectCustomerContact, removeProjectSite, replaceProjectCustomerContact, requestProjectCustomerChange, resolveProjectCustomerMapping, searchProjectEligibleCustomers,
  setProjectPrimaryContact, updateProjectCustomerContact, updateProjectSite, withdrawProjectCustomerChange,
} from "./project-customer.js";
// Milestones (0128): planned checkpoints with deliverables, tasks, prerequisites, blockers, submissions, internal approval and customer
// acceptance evidence, completion, and the billing handoff to Sales.
export {
  MILESTONE_REPORTS, getMilestoneActivity, getMilestoneDetails, getMilestoneReport, getProjectMilestones, exportMilestones, evaluateMilestoneDeadlines,
  listMilestoneQueue, searchMilestoneTasks,
} from "./project-milestone-read.js";
export { MILESTONE_STATUS_LABEL, registerMilestoneTaskSource } from "./project-milestone-rules.js";
export {
  acknowledgeMilestoneBilling, addMilestoneCriterion, addMilestoneDependency, applyProjectMilestonePlan, assignMilestoneOwner, cancelProjectMilestone,
  completeMilestoneCriterion, completeProjectMilestone, createProjectMilestone, linkMilestoneTask, listMilestoneFiles, raiseMilestoneBlocker, readMilestoneFile, recordCustomerAcceptanceEvidence,
  recordMilestoneApproval, removeMilestoneCriterion, removeMilestoneDependency, removeMilestoneFile, reopenMilestoneCriterion, reopenProjectMilestone, reorderMilestoneCriteria,
  requestMilestoneBilling, resolveMilestoneBlocker, setMilestoneBillingStage, startProjectMilestone, submitProjectMilestone, updateMilestoneCriterion, updateMilestoneTaskLink,
  updateProjectMilestone, uploadMilestoneFile, waiveMilestoneCriterion, waiveMilestoneForProjectCompletion, withdrawMilestoneBilling, withdrawMilestoneSubmission,
} from "./project-milestones.js";
// Tasks (0129): the accountable work items of a project — lifecycle, checklist, dependencies, blockers, review, files, queues, board,
// bulk changes, reports — feeding project progress and the milestones' task links.
export {
  TASK_REPORTS, PROJECT_TASK_VIEWS, evaluateTaskDeadlines, exportProjectTasks, getProjectTasks, getTaskActivity, getTaskDetails, getTaskProgressHistory, getTaskReport, listTaskQueue,
  listTaskViews,
} from "./project-task-read.js";
export { TASK_STATUS_LABEL, registerTaskRecordSource } from "./project-task-rules.js";
export {
  approveTaskReview, archiveProjectTask, blockProjectTask, bulkUpdateProjectTasks, cancelProjectTask, completeProjectTask, createProjectTask, decideTaskReview,
  listTaskFiles, manageTaskChecklist, manageTaskDependency, readTaskFile, recordTaskEvidence, removeTaskFile, removeTaskView, reopenProjectTask, requestTaskChanges,
  resolveTaskBlocker, saveTaskView, startProjectTask, submitTaskForReview, transitionProjectTask, updateProjectTask, uploadTaskFile, withdrawTaskReview,
} from "./project-tasks.js";
export {
  ASSIGNMENT_REASONS, assignProjectTask, getEligibleProjectAssignees, getMemberAssignmentImpact, getProjectTeamWorkload, getTaskAssignmentHistory,
} from "./assignees/index.js";
export {
  PRIORITY_DEFAULT, PRIORITY_LABEL, PRIORITY_LEVELS, PRIORITY_RANK, getPriorityReport, updateMilestonePriority, updateProjectPriority, updateTaskPriority, validatePriority,
} from "./priority/index.js";
export {
  CANCEL_REASONS as PROJECT_CANCEL_REASONS, HOLD_REASONS as PROJECT_HOLD_REASONS, HOLD_SEVERITIES as PROJECT_HOLD_SEVERITIES, REOPEN_REASONS as PROJECT_REOPEN_REASONS,
  STATUS_REPORTS as PROJECT_STATUS_REPORTS, activateProject, addProjectHoldReason, cancelProject, completeProject, decideProjectActivation, getAvailableProjectActions,
  getProjectCancellationReview, getProjectCompletionReadiness, getProjectHold, getProjectReopenReview, getProjectResumeReadiness, getProjectStatus, getProjectStatusHistory,
  getProjectStatusReport, getTransitionOutcome, placeProjectOnHold, reopenProject, resolveProjectHoldReason, resumeProject, startProject, validateProjectActivation,
  validateProjectExecutionAllowed,
} from "./status/index.js";
// Timesheets (0134): time entries, weekly submissions and their review, corrections of approved time, labor-cost rates and snapshots, the
// billing handoff to Sales, reminders, reports and export.
export {
  TIME_PERMISSION_KEYS, TIME_REPORTS, approveTimeCorrection, approveTimesheet, calculateTimesheetTotals,
  checkTimeEntry, createProjectTimeEntry, deleteDraftTimeEntry, evaluateTimesheetReminders, exportProjectTime, getApprovedProjectHours,
  getEmployeeWeeklyTimesheet, getProjectTimeReport, getProjectTimeSummary, getProjectTimeTasks, getTeamTimesheets, getTimeEntry, getTimeEntryOptions, getTimesheetApprovalQueue,
  getTimesheetOutcome, getTimesheetSettings, getTimesheetSubmission, listProjectLaborRates, listTimeCorrections, listTimeEntries, recoverTimePosting,
  rejectTimeCorrection, remindTimesheet, requestApprovedTimeCorrection, requestTimesheetChanges, saveTimesheetSettings,
  setProjectLaborRate, submitTimesheet, updateDraftTimeEntry, validateTimeEntryEligibility,
} from "./timesheets/index.js";
// Billable / Non-Billable Time (0135): the billing classification of recorded time, project billing policies, Sales contract lines, billing
// requests and their invoice allocation, credit reconciliation, profitability and the billable-time reports.
export {
  BILLABLE_REPORTS, BILLING_CLASSIFICATIONS, BILLING_METHODS as PROJECT_BILLING_METHOD_LABEL, BILLING_PERMISSION_KEYS, NON_BILLABLE_REASONS, authorizeContractLine, cancelTimeBillingRequest,
  classifyProjectTimeEntry, closeContractLine, confirmTimeBillingAllocation, createTimeBillingRequest, getApprovedBillableTime, getApprovedUnbilledTime, getBillableTimeReport,
  getNonBillableTimeSummary, getProjectTimeBillingPolicy, getProjectTimeBillingSummary, getTimeBillingExceptions, getTimeBillingInvoiceCandidates, getTimeBillingRequest,
  getTimeBillingSettings, listContractLineCandidates, listTimeBillingRequests, reconcileTimeBillingAdjustments, recoverTimeBillingOperation, requestBillabilityCorrection, resolveTimeEligibility,
  saveTimeBillingSettings,
  setProjectTimeBillingPolicy, setTaskBillingRule, submitTimeBillingRequest,
} from "./billable/index.js";
// Comments and Collaboration (0136): contextual discussion on projects, tasks and milestones — replies, mentions, files, edit history,
// follow/mute, read markers, My Work's mentions and unread discussions, search, reports and the project timeline.
export {
  COLLABORATION_REPORTS, COMMENT_MESSAGES, COMMENT_PARENT_LABEL, COMMENT_PARENT_TYPES, COMMENT_PERMISSION_KEYS, attachFileToComment, createComment, editComment, exportCollaboration,
  getCollaborationInbox, getCollaborationReport, getCommentHistory, getCommentSettings, getCommentsForRecord, getDiscussionCounts, getFollowedDiscussions, getMyMentions,
  getProjectCollaborationTimeline, getRecentDiscussions, getReferenceableFiles, getUnreadDiscussions, markDiscussionRead, readCommentAttachment, removeCommentAttachment, replyToComment,
  resolveEligibleMentions, saveCommentSettings, searchAuthorizedComments, softDeleteComment, subscribeToDiscussion, uploadCommentAttachment, validateCommentParentAccess,
} from "./collaboration/index.js";
// Progress Tracking (0137): task completion, required milestones, schedule, health reasons, effort against estimate, the recorded history
// and its explanations, scope baselines, the portfolio, reports and the reconciliation.
export {
  PROGRESS_CALCULATION_VERSION, PROGRESS_MESSAGES, PROGRESS_PERMISSION_KEYS, PROGRESS_REPORTS, SCHEDULE_LABEL, calculateProgressByAssignee, captureProjectProgressBaseline, evaluateProjectProgress,
  explainProgressChange, exportProjectProgress, getBaselineComparison, getPortfolioProgress, getProgressReport, getProgressSettings, getProjectProgressHistory, getProjectProgressSummary,
  rebuildProjectProgressProjection, recordProjectProgressSnapshot, saveProgressSettings, taskPercent,
} from "./progress/index.js";
// Project Expenses (0138): claims, approval, Finance review and cost recognition against one source, reimbursement handoff, supplier bill
// and goods issue links, customer recharge to Sales, corrections, the project's expense summary, queues and reports.
export {
  EXPENSE_BILLING_LABEL, EXPENSE_CLASSIFICATION_LABEL, EXPENSE_MESSAGES, EXPENSE_PERMISSION_KEYS, EXPENSE_REIMBURSEMENT_LABEL, EXPENSE_REPORTS, EXPENSE_STATUS_LABEL, EXPENSE_VIEWS,
  approveProjectExpense, cancelExpenseRechargeRequest, createExpenseRechargeRequest, createProjectExpense, decideExpenseCorrection, exportProjectExpenses, getExpenseOptions, getExpenseReport,
  getExpenseSettings, getProjectExpense, getProjectExpenseSummary, linkGoodsIssueToProject, linkSupplierBillToProject, listExpenseFiles, listExpenseRechargeRequests, listProjectExpenses,
  readExpenseFile, recordExpenseRechargeInvoiced, recordExpenseReimbursement, rejectProjectExpense, removeExpenseFile, requestExpenseChanges, requestExpenseCorrection, reviewExpenseForFinance,
  saveExpenseSettings, searchSupplierBillLines, setExpenseBilling, submitProjectExpense, updateProjectExpense, uploadExpenseReceipt, withdrawProjectExpense,
} from "./expenses/index.js";
// Invoice From Billable Time (0139): approved billable minutes → a Sales Invoice Draft through the Sales engine, read back when issued or
// cancelled; dispositions after a reversal or credit; the project's billing-from-time summary, exceptions and reports.
export {
  TIME_INVOICE_MESSAGES, TIME_INVOICE_REPORTS, createInvoiceFromTime, createSalesInvoiceDraftFromTime, getInvoiceEligibleProjectTime, getProjectTimeInvoiceSummary, getTimeInvoiceExceptions,
  getTimeInvoiceReport, previewInvoiceFromTime, reconcileTimeInvoices, recordTimeBillingDisposition,
} from "./time-invoicing/index.js";
// Project Cost (0140): actual cost from its authoritative sources, budget versions, the estimate to complete and at completion, commitments,
// managerial overhead, profitability against invoiced value, exceptions, reconciliation and reports.
export {
  COST_CATEGORIES, COST_MESSAGES, COST_PERMISSION_KEYS, COST_REPORTS, applyProjectOverhead, decideProjectBudget, endOverheadPolicy, evaluateProjectCostAlerts, exportProjectCost,
  getProjectCostExceptions, getProjectCostReport, getProjectCostSummary, getProjectCostTransactions, listOverheadPolicies, projectCommitments, proposeProjectBudget, reconcileProjectCost,
  reverseOverheadAllocation, saveProjectCostForecast, setOverheadPolicy,
} from "./costing/index.js";
// Project Revenue (0141): contract value, net invoiced, recognized revenue and collections — four separate measures read from Sales and
// Finance, attributed explicitly (order line, invoice line, invoice link, recharge), with allocations, a labelled forecast, exceptions and reports.
export {
  REVENUE_MESSAGES, REVENUE_MODELS, REVENUE_PERMISSION_KEYS, REVENUE_REPORTS, allocateContractLine, allocateInvoiceLine, endContractAllocation, exportProjectRevenue, getProjectRevenueReport,
  getProjectRevenueSummary, getProjectRevenueView, projectRevenueMeasures, reconcileProjectRevenue, reverseInvoiceAllocation, saveRevenueForecast,
} from "./revenue/index.js";
// Project Profitability (0142): actual and forecast contribution and margin above Project Cost and Project Revenue — the basis and how complete
// the data is, warnings, trends, immutable snapshots (on request and at completion), one orchestrated forecast revision, reports.
export {
  PROFITABILITY_CALCULATION_VERSION, PROFITABILITY_MESSAGES, PROFITABILITY_PERMISSION_KEYS, PROFITABILITY_POLICY, PROFITABILITY_REPORTS, exportProjectProfitability, getProjectProfitabilityBreakdown,
  getProjectProfitabilityExceptions, getProjectProfitabilityHistory, getProjectProfitabilityReport, getProjectProfitabilitySummary, getProjectProfitabilityTrend, reconcileProjectProfitability,
  recordProfitabilitySnapshot, saveProfitabilityForecast,
} from "./profitability/index.js";
// Navigation (MVP 8): the central Approvals queue (read through each owning workflow; no approval state of its own) and the Project Financials directory.
export { getProjectApprovals, getProjectFinancialsDirectory } from "./navigation/index.js";
