// The public surface of the Projects desk, every operation under a name that cannot collide with another module's
// (Assets, Quality and Manufacturing also have work orders, issues, risks and reports). The original thin
// `index.js` is left as it was.
export {
  getProjectSettings, saveProjectSettings, listProjectTemplates, getProjectTemplate, saveProjectTemplate, listProjectsDesk, getProjectDesk, createProjectRecord, updateProjectRecord,
  getCloseBlockers, approveProjectRecord, changeProjectStatus, listProjectTeams, saveProjectMember, removeProjectMember, getResourceAvailability, listProjectOptions,
} from "./setup.js";
export {
  listProjectTasks, getProjectTask, createProjectTaskRecord, updateProjectTaskRecord, changeTaskStatus, setTaskProgress, deleteProjectTask, addTaskDependency as addProjectTaskDependency, removeTaskDependency as removeProjectTaskDependency,
  listProjectMilestones, saveProjectMilestone, setMilestoneStatus, computeSchedule, scheduleProject, getScheduleConflicts, getProjectWbs, getGanttData, getKanbanBoard, getProjectCalendar,
  getProjectProgress, saveStatusReport, listProjectBaselines, createProjectBaseline, approveProjectBaseline, rejectProjectBaseline, getScheduleVariance,
} from "./planning.js";
export {
  listTimeEntries as listProjectTimeEntries, logProjectTime, updateTimeEntryRecord, deleteTimeEntryRecord, listTimesheets, submitTimesheet, recallTimesheet, reviewTimesheet, reopenApprovedTime,
  listProjectExpenses, createProjectExpense, updateProjectExpense, submitProjectExpense, reviewProjectExpense, reimburseProjectExpense, deleteProjectExpense,
  listProjectMaterials, issueProjectMaterial, returnProjectMaterial, listProcurementLinks, linkProcurementDocument, unlinkProcurementDocument,
} from "./time.js";
export {
  listProjectBudgets, createProjectBudget, submitProjectBudget, approveProjectBudget, rejectProjectBudget, getCostVariance, getCostBreakdown, getProjectProfitabilityDesk,
  captureProfitabilitySnapshot, listBillingLines, createFixedPriceBilling, createMilestoneBilling, createTimeMaterialBilling, approveBillingLine, invoiceBillingLine, cancelBillingLine,
} from "./finance.js";
export {
  listProjectIssues, createProjectIssue, updateProjectIssue, listProjectRisks, createProjectRisk, updateProjectRisk, realizeProjectRisk, listProjectDocuments, addProjectDocument,
  removeProjectDocument, listProjectComments, addProjectComment, deleteProjectComment, listMyMentions,
} from "./control.js";
export { getProjectsDeskDashboard, getProjectReport } from "./reports.js";
export { projectsContext, ProjectError } from "./common.js";
